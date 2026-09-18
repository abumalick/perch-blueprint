import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

// A 1×1 transparent PNG, served over the agent's HTTP /file endpoint (image bytes never ride
// the WebSocket). Faithful to the real agent's bearer-guarded GET /file.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// A minimal PDF byte blob served over /file for .pdf paths. The e2e only asserts the PWA
// fetches it and mounts an iframe with a blob URL — it needn't be a fully renderable PDF.
const TINY_PDF = Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8');

// A minimal audio byte blob served over /file for audio paths. The e2e only asserts the PWA
// fetches it and mounts an <audio> with a blob URL — it needn't be a playable clip.
const TINY_AUDIO = Buffer.from('ID3\x03\x00\x00\x00', 'binary');

// An 8×8 solid-color JPEG served as the browser stream's canned frame. The frame's
// metadata (not the JPEG's own size) drives the PWA's coordinate mapping, so it carries
// a realistic 1280×720 device size.
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ALQBCZX/2Q==';
const BROWSER_FRAME_METADATA = { deviceWidth: 1280, deviceHeight: 720 };

export interface FakeAgent {
  port: number;
  // Records each `create` the agent received, so a spec can assert the command that was sent.
  created: Array<{ projectPath: string; command: string }>;
  // Every message received on the terminal socket, so specs can assert fire-and-forget
  // client messages that the agent answers with nothing.
  received: Array<Record<string, unknown>>;
  // Every message received on a /browser stream socket, so specs can assert input/navigate.
  browserReceived: Array<{ session: string; message: Record<string, unknown> }>;
  // The live browser-session set the fake reports (mutable): `list` replies with it.
  browserSessions: Array<{ name: string }>;
  // Closes every live /browser socket, simulating the upstream browser session ending.
  closeBrowserSockets: () => void;
  close: () => Promise<void>;
}

type FakeWorkspace = {
  machineId: string;
  id: string;
  name: string;
  projectPath: string;
  command: string;
  createdAt: number;
  lastActivityAt: number;
  status: string;
  agentAddress?: string;
  urgent?: boolean;
  github?: { owner: string; repo: string; ownerType?: 'user' | 'org' };
};

// The default two-workspace set most specs rely on. Pass `workspacesOverride` to exercise a
// different shape (e.g. a long-named session for the list-overflow guard) without disturbing it.
const DEFAULT_WORKSPACES: FakeWorkspace[] = [
  { machineId: 'agent-machine-id', id: 'perch-demo', name: 'demo', projectPath: '/home/u/workspace/demo', command: 'bash', createdAt: 1, lastActivityAt: 1, status: 'needs-feedback', agentAddress: 'demo-7f', github: { owner: 'Acme-Org', repo: 'acme-app', ownerType: 'org' } },
  { machineId: 'agent-machine-id', id: 'perch-other', name: 'other', projectPath: '/home/u/workspace/other', command: 'bash', createdAt: 2, lastActivityAt: 2, status: 'idle' },
];

export function startFakeAgent(
  workspacesOverride?: FakeWorkspace[],
  browserSessionsOverride?: Array<{ name: string }>,
): Promise<FakeAgent> {
  return new Promise((resolve) => {
    const httpServer = createServer((req, res) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      // The PWA fetches images cross-origin (different port), so /file needs CORS + preflight.
      if (url.pathname === '/file') {
        res.setHeader('access-control-allow-origin', '*');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'authorization' }).end();
          return;
        }
        if (req.headers.authorization !== 'Bearer secret') {
          res.writeHead(401).end();
          return;
        }
        const path = url.searchParams.get('path') ?? '';
        if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(path)) {
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': TINY_PNG.byteLength });
          res.end(TINY_PNG);
          return;
        }
        if (/\.pdf$/i.test(path)) {
          res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': TINY_PDF.byteLength });
          res.end(TINY_PDF);
          return;
        }
        if (/\.(mp3|m4a|aac|wav|flac|ogg|oga|opus)$/i.test(path)) {
          res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': TINY_AUDIO.byteLength });
          res.end(TINY_AUDIO);
          return;
        }
        res.writeHead(404).end();
        return;
      }
      res.writeHead(404).end();
    });
    // Faithful to the real agent's upgrade routing: /browser goes to a dedicated stream
    // socket, everything else to the terminal socket.
    const wss = new WebSocketServer({ noServer: true });
    const browserWss = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (req, socket, head) => {
      const target = new URL(req.url ?? '', 'http://localhost').pathname === '/browser' ? browserWss : wss;
      target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
    });
    const browserReceived: Array<{ session: string; message: Record<string, unknown> }> = [];
    const browserSockets = new Set<WebSocket>();
    // Faithful to the real relay's single-viewer registry (keyed by session name): a new
    // authed viewer of the same session evicts the prior one with ended{opened-elsewhere}.
    const browserHolders = new Map<string, WebSocket>();
    browserWss.on('connection', (socket: WebSocket, req) => {
      const session = new URL(req.url ?? '', 'http://localhost').searchParams.get('session') ?? '';
      browserSockets.add(socket);
      socket.on('close', () => {
        browserSockets.delete(socket);
        if (browserHolders.get(session) === socket) browserHolders.delete(session);
      });
      socket.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        browserReceived.push({ session, message: msg });
        const send = (m: unknown) => socket.send(JSON.stringify(m));
        switch (msg.type) {
          case 'auth': {
            // Faithful to the real relay: bad token closes; ok answers authResult then
            // starts piping — one `url` and one canned `frame` stand in for the stream.
            if (msg.token !== 'secret') {
              socket.close();
              break;
            }
            const prior = browserHolders.get(session);
            if (prior && prior !== socket) {
              prior.send(JSON.stringify({ type: 'ended', reason: 'opened-elsewhere' }));
              prior.close();
            }
            browserHolders.set(session, socket);
            send({ type: 'authResult', ok: true });
            send({ type: 'url', url: 'https://example.com/' });
            send({ type: 'frame', data: TINY_JPEG_B64, metadata: BROWSER_FRAME_METADATA });
            break;
          }
          case 'ping':
            send({ type: 'pong' });
            break;
          default:
            break;
        }
      });
    });
    // Faithful to the real agent's ViewerRegistry: one viewer per workspace. A new attach
    // evicts the prior holder with `detached: opened-elsewhere`, which is what drives the
    // "Opened on another device" overlay in the PWA.
    const holders = new Map<string, WebSocket>();
    // Shared workspace state so a setStatus flips the status and the change is broadcast to
    // every connection — faithful to the real agent's synced, last-writer-wins status store.
    const workspaces = workspacesOverride ?? DEFAULT_WORKSPACES.map((w) => ({ ...w }));
    const created: Array<{ projectPath: string; command: string }> = [];
    const received: Array<Record<string, unknown>> = [];
    // One live agent-browser session named after the demo workspace (attached by the
    // name === workspace.id rule) when that workspace exists.
    const browserSessions: Array<{ name: string }> =
      browserSessionsOverride ??
      (workspaces.some((w) => w.id === 'perch-demo') ? [{ name: 'perch-demo' }] : []);
    wss.on('connection', (socket: WebSocket) => {
      let attached = '';
      socket.on('close', () => {
        if (attached && holders.get(attached) === socket) holders.delete(attached);
      });
      socket.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        received.push(msg);
        const send = (m: unknown) => socket.send(JSON.stringify(m));
        switch (msg.type) {
          case 'auth':
            // Faithful to the real agent: auth returns ONLY authResult. Workspaces are
            // sent in response to an explicit `list` — so the E2E exercises the client
            // actually requesting the list on connect.
            send({ type: 'authResult', ok: true });
            break;
          case 'list':
            // machineId here is the AGENT's PERCH_MACHINE_ID, deliberately DIFFERENT from the
            // PWA's machine config id (seeded as 'test' in the E2E). The client must route
            // attach/input by the connection id, not this value — so the E2E covers that.
            send({ type: 'workspaces', workspaces });
            // Faithful to the real agent: browserSessions follows every workspaces reply;
            // sending the (possibly empty) list also marks the agent as browser-capable.
            send({ type: 'browserSessions', sessions: browserSessions });
            break;
          case 'setStatus': {
            const ws = workspaces.find((w) => w.id === String(msg.workspaceId));
            if (ws) {
              ws.status = String(msg.status);
              for (const client of wss.clients) {
                client.send(JSON.stringify({ type: 'workspaceUpdated', workspace: ws }));
              }
            }
            break;
          }
          case 'setUrgent': {
            // Faithful to the real agent: the pin is orthogonal to status and broadcast to
            // every device via workspaceUpdated.
            const ws = workspaces.find((w) => w.id === String(msg.workspaceId));
            if (ws) {
              ws.urgent = Boolean(msg.urgent);
              for (const client of wss.clients) {
                client.send(JSON.stringify({ type: 'workspaceUpdated', workspace: ws }));
              }
            }
            break;
          }
          case 'attach': {
            attached = String(msg.workspaceId);
            const prior = holders.get(attached);
            if (prior && prior !== socket) {
              prior.send(JSON.stringify({ type: 'detached', workspaceId: attached, reason: 'opened-elsewhere' }));
            }
            holders.set(attached, socket);
            send({ type: 'attached', workspaceId: attached });
            // Note: the UTF-8 output-decoding regression is guarded by the store unit test
            // (`hi─é` roundtrip); headless xterm doesn't reliably expose non-ASCII glyph
            // text to Playwright, so this E2E keeps the rendering assertion ASCII.
            // The id is echoed in the banner so a switch between workspaces is observable
            // in the rendered terminal (each session shows distinct content).
            // Include an OSC 8 hyperlink (a label carrying a hidden URL, like Claude Code's
            // file/doc links) so the E2E can assert it is clickable. Plain-text URLs are
            // covered by the WebLinksAddon; OSC 8 links need the terminal's linkHandler.
            const osc8 = '\x1b]8;;https://example.com/osc8\x1b\\OSC8LINK\x1b]8;;\x1b\\\r\n';
            send({ type: 'output', workspaceId: attached, data: Buffer.from(`PERCH_READY ${attached}\r\n${osc8}`, 'utf8').toString('base64') });
            break;
          }
          case 'input':
            send({ type: 'output', workspaceId: attached, data: Buffer.from('echoed\r\n').toString('base64') });
            break;
          case 'putFile':
            // Faithful to the real agent: resolve by the message's workspaceId (NOT attach
            // state — a putFile can arrive before attach, e.g. a shared image flushed on open),
            // persist under <cwd>/.tmp/files, and reply with the relative path. (No real disk
            // write needed in the fake.)
            send({ type: 'fileStored', workspaceId: String(msg.workspaceId), path: `.tmp/files/${String(msg.name)}` });
            break;
          case 'create': {
            const projectPath = String(msg.projectPath);
            const command = String(msg.command);
            created.push({ projectPath, command });
            const ws: FakeWorkspace = {
              machineId: 'agent-machine-id',
              id: `perch-created-${created.length}`,
              name: projectPath.split('/').pop() || 'created',
              projectPath,
              command,
              createdAt: 100 + created.length,
              lastActivityAt: 100 + created.length,
              status: 'idle',
            };
            workspaces.push(ws);
            for (const client of wss.clients) {
              client.send(JSON.stringify({ type: 'workspaceUpdated', workspace: ws }));
            }
            break;
          }
          case 'close':
            send({ type: 'closed', workspaceId: String(msg.workspaceId) });
            break;
          case 'browseDir': {
            const path = String(msg.path);
            send({ type: 'dirEntries', path, subdirs: [`${path}/src`], files: [`${path}/README.md`, `${path}/logo.png`, `${path}/photo.png`, `${path}/report.pdf`, `${path}/clip.mp3`, `${path}/song-a.mp3`, `${path}/song-b.mp3`] });
            break;
          }
          case 'makeDir': {
            // Faithful to the real agent: create the folder, then reply with a dirEntries for
            // the new (empty) folder so the picker browses into it.
            const created = `${String(msg.parent)}/${String(msg.name)}`;
            send({ type: 'dirEntries', path: created, subdirs: [], files: [] });
            break;
          }
          case 'listRoots':
            send({ type: 'roots', roots: ['/home/u/workspace'] });
            break;
          // Mirrors a machine with a ~/.perch/commands.json: one command that takes an
          // argument and one that submits on the spot.
          case 'listCommands':
            send({
              type: 'commands',
              commands: [
                { command: '/myplugin:task', submit: false },
                { command: '/rename', submit: true },
              ],
            });
            break;
          case 'readFile': {
            // Text only — images are fetched over HTTP (GET /file above), not the WS.
            const path = String(msg.path);
            // Markdown gets a heading so the viewer's rendered mode is exercised.
            const body = path.endsWith('.md')
              ? `# contents of ${path}\n\nsecond line\n`
              : `contents of ${path}\nsecond line\n`;
            send({
              type: 'fileContents',
              path,
              data: Buffer.from(body, 'utf8').toString('base64'),
              truncated: false,
              binary: false,
            });
            break;
          }
          case 'ping':
            // Faithful to the real agent: answer the liveness probe so the client's heartbeat
            // keeps the connection alive.
            send({ type: 'pong' });
            break;
          default:
            break;
        }
      });
    });
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        created,
        received,
        browserReceived,
        browserSessions,
        closeBrowserSockets: () => {
          for (const socket of browserSockets) socket.close();
        },
        close: () =>
          new Promise((r) => {
            for (const socket of browserSockets) socket.terminate();
            browserWss.close(() => wss.close(() => httpServer.close(() => r())));
          }),
      });
    });
  });
}
