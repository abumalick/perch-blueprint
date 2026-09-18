import type { AgentMessage, BrowserSession, ClientMessage, CommandEntry, Workspace, WorkspaceStatus } from '@perch/contracts';
import { imageMediaType, pdfMediaType, audioMediaType } from '@perch/contracts';
import type { ConnectionManager } from './core/connection-manager';
import type { WorkspaceAggregator } from './core/workspace-aggregator';
import type { SettingsStore, MachineConfig } from './core/settings-store';
import { clampFontSize, TERMINAL_FONT_DEFAULT } from './core/settings-store';
import type { ConnectionDiagnostic, ConnectionStatus } from './core/machine-connection';
import type { ConnectionLog } from './core/connection-log';
import { deriveHomeView, type HomeView } from './core/home-view';
import { imageFiles, neighbor, position } from './core/image-nav';
import { audioFiles } from './core/audio-nav';
import { readSharedFile, consumeSharedFile, type CacheLike } from './core/shared-file';
import { checkUploadSize } from './core/upload-limit';
import { joinBrowserSessions } from './core/browser-sessions';
import { BrowserStream, type BrowserStreamDeps } from './core/browser-stream';
import { SpeechToText, type DictationState } from './core/speech-to-text';
import type { AudioRecorder } from './core/ports/audio-recorder';
import type { Transcriber } from './core/ports/transcriber';
import type { ImageLoader } from './core/ports/image-loader';
import type { SocketFactory } from './core/ports/socket';

type View = 'list' | 'terminal' | 'settings' | 'create' | 'newMachine' | 'browser' | 'viewer' | 'browserView';

// Terminal output: base64 of the pty's UTF-8 bytes. Decode base64 → bytes → UTF-8 string.
// (Writing the raw `atob` latin1 string instead mangles every non-ASCII byte — box-drawing,
// accents — into mojibake and breaks the render.)
function decode(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}
// Terminal input: encode the string as UTF-8 bytes, then base64 (utf8-safe — plain
// btoa throws on non-latin1 input).
function encode(text: string): string {
  return encodeBytes(new TextEncoder().encode(text));
}

// How long to show the "Connecting…" home screen before concluding the machines are
// unreachable (Tailscale off / agent down) and switching to the reconnect screen.
const GRACE_MS = 4000;
// A machine that has connected before is known-reachable, so we give it a much longer calm
// "Reconnecting…" window before falling through to the actionable "Can't reach" screen — a
// brief blip (phone waking, backoff) shouldn't alarm, but a genuine extended outage (Tailscale
// off, agent down) still surfaces the Tailscale hint + Reconnect button so the user can act.
const RECONNECT_GRACE_MS = 25_000;

export class PerchStore {
  view = $state<View>('list');
  workspaces = $state<Workspace[]>([]);
  statuses = $state<Record<string, ConnectionStatus>>({});
  // True once the connect grace period has elapsed with no machine online: it flips the home
  // screen from "Connecting…" to "Can't reach your machines". Reset whenever a machine is
  // online (or on a manual reconnect) so a later drop gets a fresh grace, not an instant
  // unreachable screen.
  graceElapsed = $state(false);
  // The last connection failure per machine, surfaced in Settings so a user can see why
  // a machine won't connect. Cleared once that machine reaches `online`.
  lastConnectionError = $state<Record<string, ConnectionDiagnostic | undefined>>({});
  machines = $state<MachineConfig[]>([]);
  // Machines that have reached `online` at least once this session — i.e. known-reachable, so
  // they auto-retry forever. Used to show a calm "Reconnecting…" instead of "Can't reach"
  // while such a machine is briefly down. Reactive record (not a Set) so `homeView` recomputes.
  reachedOnce = $state<Record<string, boolean>>({});
  // Which home screen to show: add-machine / connecting / reconnecting / unreachable / create / list.
  homeView = $derived.by<HomeView>(() =>
    deriveHomeView({
      enabledMachineCount: this.machines.filter((m) => m.enabled !== false).length,
      anyOnline: this.machines.some(
        (m) => m.enabled !== false && this.statuses[m.id] === 'online',
      ),
      workspaceCount: this.workspaces.length,
      graceElapsed: this.graceElapsed,
      // Calm "Reconnecting…" only within the (longer) grace window; once it elapses we fall
      // through to the actionable "Can't reach" screen so an extended outage isn't an eternal
      // spinner. `graceElapsed` here reflects RECONNECT_GRACE_MS (see recomputeGrace).
      anyReconnecting:
        !this.graceElapsed &&
        this.machines.some(
          (m) => m.enabled !== false && this.reachedOnce[m.id] && this.statuses[m.id] !== 'online',
        ),
    }),
  );
  // The machine used for the last create, so the New workspace view can preselect it.
  lastMachineId = $state<string | null>(null);
  // The command run for the last create, so the New workspace view can preselect it.
  lastCommand = $state<string | null>(null);
  active = $state<Workspace | null>(null);
  recentPaths = $state<Record<string, string[]>>({});
  // The agent's configured project roots, per machine, used as the folder picker's
  // top-level browse points. Filled from the `roots` reply to `listRoots` (sent on goCreate).
  machineRoots = $state<Record<string, string[]>>({});
  // The agent machine's command shortcuts, per machine, offered by the keyboard bar's
  // drop-down. Filled from the `commands` reply to `listCommands` (sent on every connect).
  machineCommands = $state<Record<string, CommandEntry[]>>({});
  dirEntries = $state<{ path: string; subdirs: string[]; files: string[] } | null>(null);
  // The project folder the browser is confined to (the active workspace's projectPath).
  browserRoot = $state<string | null>(null);
  // Set when the agent rejects/fails a browse while the browser is open, so the UI shows
  // the failure instead of hanging on "Loading…". Cleared on each new browse request.
  browseError = $state<string | null>(null);
  // The file currently open in the read-only viewer. `text` is the decoded UTF-8 contents
  // ('' when binary or a media file). For an image or PDF, `mediaType` is its MIME and
  // `blobUrl` is a blob/object URL of the bytes fetched over HTTP ('' while loading or when
  // over the size cap). Cleared on each new openFile.
  fileView = $state<{ path: string; text: string; mediaType: string; blobUrl: string; truncated: boolean; binary: boolean } | null>(null);
  // Set when the agent fails a readFile while the viewer is open, so the UI shows the
  // failure instead of hanging on "Loading…". Cleared on each new openFile.
  viewError = $state<string | null>(null);
  // Set when the agent rejects a create (e.g. the path is not an existing directory) while
  // the create form is open, so the form shows the failure instead of silently dropping it.
  // Cleared on each new create attempt and on entering the create view.
  createError = $state<string | null>(null);
  // An agent refusal that belongs to no particular view — e.g. parking a workspace with no
  // resumable Claude session. Without somewhere to land, such an error is dropped and the
  // action just appears to do nothing. Shown as a dismissible banner.
  actionError = $state<string | null>(null);
  // True while the New-workspace folder picker is open. It shares dirEntries/browseError
  // with the file browser (the two are never open at once) and only needs this flag so an
  // agent `error` is routed to the picker even though the view is still 'create'.
  pickerActive = $state(false);
  // Word-wrap preference for the file viewer, persisted via settings (loaded in start()).
  fileWrap = $state(true);
  // Global terminal font size (zoom), persisted via settings (loaded in start()).
  terminalFontSize = $state(TERMINAL_FONT_DEFAULT);
  // ElevenLabs API key for client-side dictation, persisted on-device (loaded in start()).
  elevenLabsApiKey = $state('');
  // Project-folder filter pills on the home list, persisted via settings (loaded in start()).
  folderFilter = $state<string[]>([]);
  // Live agent-browser sessions per connection, from the agent's `browserSessions`
  // message. Keyed by the CONNECTION id (this PWA's machine config id), never the
  // agent's self-reported machine id — same routing rule as workspaces.
  browserSessions = $state<Record<string, BrowserSession[]>>({});
  // Connections that have ever sent `browserSessions` (even empty): the browser UI is
  // only offered for these, so an older agent never gets messages it can't parse.
  private browserSupport = $state<Record<string, boolean>>({});
  // The session the browser view is showing (null when the view is closed).
  browserTarget = $state<{ connectionId: string; session: string } | null>(null);
  // Where closeBrowserView returns to (terminal when opened from a workspace, list from home).
  private browserReturnView: View = 'list';
  terminalState = $state<'live' | 'moved'>('live');
  // When true, the terminal grabs focus on mount and pops the soft keyboard. Only a
  // freshly created workspace sets this; opening an existing one leaves it false so the
  // keyboard stays closed (the user is usually reading output, not typing).
  autoFocus = $state(false);
  // A new build has been installed and is waiting; the update banner offers a reload.
  // `incomingBuildLabel` is the slug of that pending build (null if it couldn't be read).
  updateReady = $state(false);
  incomingBuildLabel = $state<string | null>(null);
  // A file handed to the app by the OS "Share" sheet (Android), read from the Cache API
  // at boot. Held until the user opens a session whose machine is online, then sent via the
  // paste path (sendPutFile). Home surfaces it as a "1 file ready" banner. Android-only:
  // iOS WebKit has no Web Share Target, so nothing populates it there.
  pendingSharedFile = $state<{ name: string; bytes: Uint8Array } | null>(null);
  // The Cache holding the shared file, kept so the entry can be dropped once attached (flush).
  private sharedFileCache: CacheLike | null = null;
  onOutput: ((data: string) => void) | null = null;
  // Called when the active terminal's machine recovers from a drop, so the view re-attaches
  // (clear stale rows + resend `attach`) and self-heals instead of staying frozen on the last
  // frame. Wired by TerminalView, which owns the terminal dimensions.
  onReattach: (() => void) | null = null;
  // Machines seen offline since they were last online. Lets setStatus fire onReattach only on
  // a real drop-and-recover, not on the first connect (which has nothing stale to re-attach).
  private disconnected = new Set<string>();
  // Push-to-talk dictation state, mirrored from the SpeechToText controller for the UI.
  dictationState = $state<DictationState>('idle');
  dictationError = $state<string | null>(null);
  // A create we sent and are waiting to see appear in the list, so we can auto-open it.
  private pendingCreate: { machineId: string; projectPath: string; existingIds: Set<string> } | null = null;
  // Focuses App's hidden input. iOS only raises the soft keyboard from a user gesture, so
  // the create tap focuses this anchor to open the keyboard now and hold it through the
  // round-trip; the terminal takes focus from it on mount (see App.svelte, TerminalView).
  private keyboardAnchor: (() => void) | null = null;
  // Lazily built on first use so dictation is inert when its adapters aren't wired (tests
  // that omit them, or a build without mic/transcriber support).
  private stt: SpeechToText | null = null;
  // The object URL of the media file (image or PDF) currently shown in the viewer, tracked so
  // it can be revoked when the viewer closes or another file is opened (otherwise the blob leaks).
  private currentBlobUrl: string | null = null;
  // Cancels the running grace timer (null when none is armed).
  private graceCancel: (() => void) | null = null;
  private readonly startTimer: (fn: () => void, ms: number) => () => void;

  constructor(
    private readonly deps: {
      settings: SettingsStore;
      manager: ConnectionManager;
      aggregator: WorkspaceAggregator;
      // Applies the waiting service worker and reloads the page (wired to vite-plugin-pwa's
      // updateSW in main.ts; omitted in tests).
      applyUpdate?: () => void;
      // Speech-to-text adapters (mic + ElevenLabs). Omitted in tests that don't exercise
      // dictation; when absent, toggleDictation is a no-op.
      recorder?: AudioRecorder;
      transcriber?: Transcriber;
      // Loads image bytes from the agent's /file endpoint (browser fetch).
      imageLoader: ImageLoader;
      // Builds the per-viewer browser stream sockets (`/browser?session=`). Omitted in
      // tests that don't exercise the browser view; then openBrowserStream returns null.
      socketFactory?: SocketFactory;
      // Arms a one-shot timer and returns a canceller (the grace clock). Defaults to
      // setTimeout; tests inject a manual timer for deterministic grace transitions.
      startTimer?: (fn: () => void, ms: number) => () => void;
      // Durable connection-event log and its per-machine flusher. Omitted in tests that don't
      // exercise logging; when absent, event recording and flushing are no-ops.
      connectionLog?: ConnectionLog;
      flushLog?: (machine: MachineConfig) => void;
    },
  ) {
    this.startTimer =
      deps.startTimer ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
    deps.aggregator.onChange(() => {
      this.workspaces = deps.aggregator.snapshot();
      // Keep the open workspace's metadata (e.g. status) in sync with the agent's
      // broadcasts so the terminal header status picker reflects the live state.
      if (this.active) {
        const fresh = this.workspaces.find(
          (w) => w.machineId === this.active!.machineId && w.id === this.active!.id,
        );
        if (fresh) this.active = fresh;
      }
      this.maybeOpenCreated();
    });
  }

  start(): void {
    this.machines = this.deps.settings.list();
    this.lastMachineId = this.deps.settings.lastMachine();
    this.lastCommand = this.deps.settings.lastCommand();
    this.fileWrap = this.deps.settings.fileWrap();
    this.terminalFontSize = this.deps.settings.terminalFontSize();
    this.elevenLabsApiKey = this.deps.settings.elevenLabsApiKey() ?? '';
    this.folderFilter = this.deps.settings.folderFilter();
    this.deps.manager.setMachines(this.machines);
    this.recomputeGrace();
  }

  setStatus(machineId: string, status: ConnectionStatus): void {
    this.statuses[machineId] = status;
    if (status === 'connecting') {
      this.deps.connectionLog?.push(machineId, 'connect');
    }
    if (status === 'offline') {
      this.disconnected.add(machineId);
    } else if (status === 'online') {
      this.reachedOnce[machineId] = true;
      this.deps.connectionLog?.push(machineId, 'online');
      this.flushMachine(machineId);
      this.lastConnectionError[machineId] = undefined;
      // After a drop, the reconnect resyncs the workspace list but never re-attaches the open
      // terminal, leaving it frozen on its last frame. Re-attach it automatically — exactly
      // what the manual refresh button does — so the terminal self-heals.
      if (this.disconnected.delete(machineId) && this.active?.machineId === machineId) {
        this.onReattach?.();
      }
      this.flushPendingSharedFile();
    }
    this.recomputeGrace();
  }

  // Reconnect every enabled machine that is idle-offline (the home Reconnect button, plus app
  // refocus / browser `online`). Deliberately **skips machines already `connecting`**: aborting
  // an in-flight attempt to restart it just resets progress on a slow-to-establish path (a phone
  // waking, Tailscale cold) — the connect-deadline reaps a genuinely stalled one within 10s
  // anyway. `manual` distinguishes a user tap from an automatic refocus in the connection log.
  reconnectAll(manual = false): void {
    this.graceElapsed = false;
    this.cancelGraceTimer();
    for (const m of this.machines) {
      const status = this.statuses[m.id];
      if (m.enabled !== false && status !== 'online' && status !== 'connecting') {
        this.deps.connectionLog?.push(m.id, manual ? 'manual-reconnect' : 'auto-reconnect');
        this.deps.manager.reconnect(m.id);
      }
    }
    this.recomputeGrace();
  }

  // Drives the connect grace clock: while enabled machines exist but none are online, arm a
  // one-shot timer that flips graceElapsed (→ unreachable screen). Cancel and reset it once a
  // machine is online or there are no machines, so the screen self-heals.
  private recomputeGrace(): void {
    const enabled = this.machines.filter((m) => m.enabled !== false);
    const anyOnline = enabled.some((m) => this.statuses[m.id] === 'online');
    if (enabled.length === 0 || anyOnline) {
      this.cancelGraceTimer();
      this.graceElapsed = false;
      return;
    }
    if (!this.graceElapsed && !this.graceCancel) {
      // A known-reachable machine (connected before) gets the longer reconnect grace so its
      // calm "Reconnecting…" isn't cut short; a never-connected machine keeps the short grace
      // before "Can't reach". Duration is fixed at arm time (the guard above prevents re-arming).
      const graceMs = enabled.some((m) => this.reachedOnce[m.id]) ? RECONNECT_GRACE_MS : GRACE_MS;
      this.graceCancel = this.startTimer(() => {
        this.graceCancel = null;
        this.graceElapsed = true;
      }, graceMs);
    }
  }

  private cancelGraceTimer(): void {
    this.graceCancel?.();
    this.graceCancel = null;
  }

  // Probe the active machine's link now (used when the app returns to the foreground). A dead
  // socket is force-closed and reconnected, which then triggers onReattach via setStatus.
  checkActiveLiveness(): void {
    if (this.active) this.deps.manager.checkLiveness(this.active.machineId);
  }

  setConnectionError(machineId: string, diagnostic: ConnectionDiagnostic): void {
    this.deps.connectionLog?.push(machineId, 'close', { code: diagnostic.code, reason: diagnostic.message });
    this.lastConnectionError[machineId] = diagnostic;
  }

  // Records an app-global connectivity event (visibility/network transition) and flushes every
  // online machine, so a foreground/reconnect drains the buffered story of the last drop.
  logConnectivity(kind: string): void {
    this.deps.connectionLog?.push(null, kind);
    for (const m of this.machines) {
      if (this.statuses[m.id] === 'online') this.flushMachine(m.id);
    }
  }

  private flushMachine(machineId: string): void {
    const machine = this.machines.find((m) => m.id === machineId);
    if (machine) this.deps.flushLog?.(machine);
  }

  handleMessage(machineId: string, message: AgentMessage): void {
    switch (message.type) {
      case 'output':
        if (this.active?.id === message.workspaceId) this.onOutput?.(decode(message.data));
        return;
      case 'fileStored':
        // The agent saved a pasted file under the workspace cwd; type its relative path
        // into the terminal at the cursor, exactly like typed input.
        if (this.active?.id === message.workspaceId) this.sendInput(message.path);
        return;
      case 'detached':
        if (this.active?.id === message.workspaceId && message.reason === 'opened-elsewhere') {
          this.terminalState = 'moved';
        }
        return;
      case 'closed':
        if (this.active?.id === message.workspaceId) this.back();
        return;
      case 'recentPaths':
        this.recentPaths = { ...this.recentPaths, [machineId]: message.paths };
        return;
      case 'commands':
        this.machineCommands = { ...this.machineCommands, [machineId]: message.commands };
        return;
      case 'roots':
        this.machineRoots = { ...this.machineRoots, [machineId]: message.roots };
        return;
      case 'browserSessions':
        this.browserSessions = { ...this.browserSessions, [machineId]: message.sessions };
        this.browserSupport = { ...this.browserSupport, [machineId]: true };
        return;
      case 'dirEntries':
        this.dirEntries = { path: message.path, subdirs: message.subdirs, files: message.files };
        this.browseError = null;
        return;
      case 'fileContents':
        // Text/binary only — images/PDFs never come over the WS; they are fetched over HTTP (openFile).
        this.fileView = {
          path: message.path,
          text: message.binary ? '' : decode(message.data),
          mediaType: '',
          blobUrl: '',
          truncated: message.truncated,
          binary: message.binary,
        };
        this.viewError = null;
        return;
      case 'error':
        // `bad_message` means an older agent rejected a client message it doesn't understand
        // (e.g. the heartbeat `ping` during a version-skew rollout). That's protocol noise,
        // not a failed user action, so don't surface it in any view.
        if (message.code === 'bad_message') return;
        // The agent reports failures (e.g. a rejected/unreadable path) as a generic error;
        // surface it in whichever view is waiting so it doesn't hang or vanish silently.
        if (this.view === 'browser' || this.pickerActive) this.browseError = message.message;
        else if (this.view === 'create' && this.pendingCreate) {
          this.createError = message.message;
          this.pendingCreate = null;
        } else if (this.view === 'viewer') this.viewError = message.message;
        else this.actionError = message.message;
        return;
      default:
        return;
    }
  }

  open(workspace: Workspace, focus = false): void {
    this.active = workspace;
    this.terminalState = 'live';
    this.autoFocus = focus;
    this.view = 'terminal';
    this.flushPendingSharedFile();
  }

  // Read an OS-shared file out of the Cache API (stashed by the share-target SW helper) and
  // hold it as pending. Called once at boot; `cache` is null when the Cache API is absent or
  // no share happened, in which case this is a clean no-op. The read is non-destructive — the
  // cache entry is removed only when the file is attached (flush) — so it survives a re-open
  // before attaching, and two boots can't race to delete a just-stashed entry.
  async loadSharedFile(cache: CacheLike | null): Promise<void> {
    if (!cache) return;
    this.sharedFileCache = cache;
    this.pendingSharedFile = await readSharedFile(cache);
    this.flushPendingSharedFile();
  }

  // Send the pending shared file to the active workspace once its machine is online (the
  // putFile needs a live socket to get its fileStored reply). Re-checked on open() and on a
  // machine going online, so the file lands as soon as both conditions hold. On success we
  // drop the cache entry so it isn't offered again next boot.
  private flushPendingSharedFile(): void {
    const shared = this.pendingSharedFile;
    if (!shared || !this.active || this.statuses[this.active.machineId] !== 'online') return;
    // The cache entry is the only copy; keep it (and the banner) if the send was refused,
    // e.g. the file is over the upload cap. Otherwise the bytes would be gone for good.
    if (!this.sendPutFile(shared.name, shared.bytes)) return;
    this.pendingSharedFile = null;
    if (this.sharedFileCache) void consumeSharedFile(this.sharedFileCache);
  }

  attach(cols: number, rows: number): void {
    if (this.active) this.send(this.active.machineId, { type: 'attach', workspaceId: this.active.id, cols, rows });
  }

  // Re-claim a workspace that was opened on another device: re-attaching evicts the other
  // viewer (the agent's registry is last-attach-wins), so we just flip back to live and
  // resend attach with the terminal's current size.
  takeOver(cols: number, rows: number): void {
    this.terminalState = 'live';
    this.attach(cols, rows);
  }

  sendInput(data: string): void {
    if (this.active) this.send(this.active.machineId, { type: 'input', workspaceId: this.active.id, data: encode(data) });
  }

  // Upload an attached file to the active workspace. The agent saves it under the workspace's
  // .tmp/files/ and replies with `fileStored`, which types the saved path into the terminal.
  // The size check lives here rather than at the call sites because paste, the file picker
  // and the share target all funnel through this one method.
  // Returns whether the file was actually sent, so a caller holding the only copy (the
  // share-target cache) knows not to discard it on a refusal.
  sendPutFile(name: string, bytes: Uint8Array): boolean {
    if (!this.active) return false;
    const tooLarge = checkUploadSize(bytes.byteLength);
    if (tooLarge) {
      this.actionError = tooLarge;
      return false;
    }
    this.send(this.active.machineId, { type: 'putFile', workspaceId: this.active.id, name, data: encodeBytes(bytes) });
    return true;
  }

  // Toggle dictation: first tap records, second stops and transcribes; the transcript is
  // inserted at the terminal via the normal input path (no auto-submit). No-op when the
  // dictation adapters aren't wired.
  toggleDictation(): Promise<void> {
    return this.speech()?.toggle() ?? Promise.resolve();
  }

  // Dismiss a dictation error (the error banner's ✕), returning the mic to idle.
  dismissDictationError(): void {
    this.stt?.dismiss();
  }

  dismissActionError(): void {
    this.actionError = null;
  }

  private speech(): SpeechToText | null {
    if (this.stt) return this.stt;
    const { recorder, transcriber } = this.deps;
    if (!recorder || !transcriber) return null;
    this.stt = new SpeechToText(
      recorder,
      transcriber,
      (text) => this.sendInput(text),
      () => {
        this.dictationState = this.stt?.state ?? 'idle';
        this.dictationError = this.stt?.error ?? null;
      },
    );
    return this.stt;
  }

  resize(cols: number, rows: number): void {
    if (this.active) this.send(this.active.machineId, { type: 'resize', workspaceId: this.active.id, cols, rows });
  }

  setWorkspaceStatus(status: WorkspaceStatus): void {
    if (this.active) {
      this.send(this.active.machineId, {
        type: 'setStatus',
        workspaceId: this.active.id,
        status,
      });
    }
  }

  setWorkspaceUrgent(urgent: boolean): void {
    if (this.active) {
      this.send(this.active.machineId, {
        type: 'setUrgent',
        workspaceId: this.active.id,
        urgent,
      });
    }
  }

  closeActive(): void {
    if (this.active) {
      this.send(this.active.machineId, { type: 'close', workspaceId: this.active.id });
      this.active = null;
      this.view = 'list';
    }
  }

  back(): void {
    if (this.active) this.send(this.active.machineId, { type: 'detach', workspaceId: this.active.id });
    this.active = null;
    this.view = 'list';
  }

  goSettings(): void {
    this.view = 'settings';
  }

  goNewMachine(): void {
    this.view = 'newMachine';
  }

  goCreate(): void {
    for (const m of this.machines) {
      this.send(m.id, { type: 'getRecentPaths' });
      this.send(m.id, { type: 'listRoots' });
    }
    this.dirEntries = null;
    this.createError = null;
    this.view = 'create';
  }

  // Leaving the create form returns you where you opened it from: the terminal when it was
  // reached from a workspace's menu, the list otherwise. No detach — the terminal was only
  // unmounted, and the agent keeps a single attachment per connection (same as openBrowser).
  cancelCreate(): void {
    if (this.active) this.view = 'terminal';
    else this.back();
  }

  browse(machineId: string, path: string): void {
    this.send(machineId, { type: 'browseDir', path });
  }

  openBrowser(): void {
    if (!this.active) return;
    this.browserRoot = this.active.projectPath;
    this.dirEntries = null;
    this.browseError = null;
    this.browse(this.active.machineId, this.active.projectPath);
    this.view = 'browser';
  }

  browseInto(path: string): void {
    if (!this.active) return;
    this.browseError = null;
    this.browse(this.active.machineId, path);
  }

  closeBrowser(): void {
    this.view = 'terminal';
  }

  supportsBrowser(connectionId: string): boolean {
    return this.browserSupport[connectionId] === true;
  }

  // Session names attached to this workspace (session name === workspace id rule).
  browserSessionsFor(workspace: Workspace): string[] {
    const sessions = this.browserSessions[workspace.machineId] ?? [];
    const peers = this.workspaces.filter((w) => w.machineId === workspace.machineId);
    return joinBrowserSessions(sessions, peers).attached.get(workspace.id) ?? [];
  }

  // Sessions matching no workspace (e.g. a home-level per-site login like `github`), across
  // every connection, for the home list's per-machine bucket.
  unattachedBrowserSessions(): { connectionId: string; name: string }[] {
    const out: { connectionId: string; name: string }[] = [];
    for (const [connectionId, sessions] of Object.entries(this.browserSessions)) {
      const peers = this.workspaces.filter((w) => w.machineId === connectionId);
      for (const name of joinBrowserSessions(sessions, peers).unattached) {
        out.push({ connectionId, name });
      }
    }
    return out;
  }

  startBrowser(connectionId: string, workspaceId: string): void {
    this.send(connectionId, { type: 'startBrowser', workspaceId });
  }

  openBrowserView(connectionId: string, session: string): void {
    this.browserReturnView = this.view;
    this.browserTarget = { connectionId, session };
    this.view = 'browserView';
  }

  closeBrowserView(): void {
    this.browserTarget = null;
    this.view = this.browserReturnView;
  }

  // Leaving after a closeSession: re-list the connection so the agent's fresh
  // browserSessions (without the closed session) replaces the stale chip.
  browserSessionClosed(): void {
    if (this.browserTarget) this.send(this.browserTarget.connectionId, { type: 'list' });
    this.closeBrowserView();
  }

  // Builds the viewer-scoped stream for the open browser target. The caller (BrowserView)
  // owns its lifecycle: open() on mount, close() on unmount, open() again to retry.
  openBrowserStream(
    handlers: Omit<BrowserStreamDeps, 'url' | 'token' | 'socketFactory'>,
  ): BrowserStream | null {
    const target = this.browserTarget;
    const socketFactory = this.deps.socketFactory;
    if (!target || !socketFactory) return null;
    const machine = this.machines.find((m) => m.id === target.connectionId);
    if (!machine) return null;
    // Strip trailing slashes so a machine URL like `wss://host:8442/` doesn't build
    // `…//browser` (same normalization as the /file image fetch).
    const base = machine.url.replace(/\/+$/, '');
    return new BrowserStream({
      url: `${base}/browser?session=${encodeURIComponent(target.session)}`,
      token: machine.token,
      socketFactory,
      ...handlers,
    });
  }

  // The New-workspace folder picker. It reuses browse()/dirEntries but stays on the 'create'
  // view: the picker is rendered inside CreateWorkspace so the form draft survives.
  // pickerActive routes agent errors here while it is open; the picker drives the actual
  // browsing through pickerBrowse (starting from the machine's reported roots).
  openFolderPicker(): void {
    this.dirEntries = null;
    this.browseError = null;
    this.pickerActive = true;
  }

  pickerBrowse(machineId: string, path: string): void {
    this.browseError = null;
    this.browse(machineId, path);
  }

  // Create `name` inside `parent` on the agent. The reply is a `dirEntries` for the new
  // folder, so the existing dirEntries handling browses into it (no extra client step).
  pickerMakeDir(machineId: string, parent: string, name: string): void {
    this.browseError = null;
    this.send(machineId, { type: 'makeDir', parent, name });
  }

  closeFolderPicker(): void {
    this.pickerActive = false;
  }

  openFile(path: string): void {
    if (!this.active) return;
    this.revokeBlobUrl();
    this.viewError = null;
    // Images, PDFs, and audio are fetched over HTTP (not the WS) — show the viewer now, load
    // the bytes async. Everything else is requested as text/binary over the WS.
    const mediaType = imageMediaType(path) || pdfMediaType(path) || audioMediaType(path);
    if (mediaType) {
      this.fileView = { path, text: '', mediaType, blobUrl: '', truncated: false, binary: false };
      this.view = 'viewer';
      void this.loadBlobFile(path, mediaType);
    } else {
      this.fileView = null;
      this.send(this.active.machineId, { type: 'readFile', path });
      this.view = 'viewer';
    }
  }

  // Fetches a media file's bytes (image, PDF, or audio) from the agent's HTTP /file endpoint
  // (bearer-authenticated) and exposes them as an object URL. Guards against a newer openFile
  // superseding this load.
  private async loadBlobFile(path: string, mediaType: string): Promise<void> {
    const machine = this.machines.find((m) => m.id === this.active?.machineId);
    if (!machine) return;
    // Strip any trailing slash so a machine URL like `wss://host:8442/` doesn't build
    // `…//file` (a double slash the agent's /file route won't match → 404).
    const base = machine.url.replace(/^ws/, 'http').replace(/\/+$/, '');
    try {
      const { status, blob } = await this.deps.imageLoader.load(
        `${base}/file?path=${encodeURIComponent(path)}`,
        machine.token,
      );
      if (this.fileView?.path !== path) return;
      if (status === 413) {
        this.fileView = { path, text: '', mediaType, blobUrl: '', truncated: true, binary: false };
        return;
      }
      if (status < 200 || status >= 300 || !blob) {
        this.viewError = `Couldn't load this file (HTTP ${status}).`;
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      if (this.fileView?.path !== path) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      this.currentBlobUrl = objectUrl;
      this.fileView = { path, text: '', mediaType, blobUrl: objectUrl, truncated: false, binary: false };
    } catch {
      if (this.fileView?.path === path) this.viewError = "Couldn't load this file.";
    }
  }

  private revokeBlobUrl(): void {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
  }

  closeViewer(): void {
    this.revokeBlobUrl();
    this.view = 'browser';
  }

  showImageNeighbor(dir: -1 | 1): void {
    if (!this.dirEntries || !this.fileView) return;
    const next = neighbor(imageFiles(this.dirEntries.files), this.fileView.path, dir);
    if (next) this.openFile(next);
  }

  get imagePosition(): { index: number; count: number } | null {
    if (!this.dirEntries || !this.fileView) return null;
    return position(imageFiles(this.dirEntries.files), this.fileView.path);
  }

  showAudioNeighbor(dir: -1 | 1): void {
    if (!this.dirEntries || !this.fileView) return;
    const next = neighbor(audioFiles(this.dirEntries.files), this.fileView.path, dir);
    if (next) this.openFile(next);
  }

  get audioPosition(): { index: number; count: number } | null {
    if (!this.dirEntries || !this.fileView) return null;
    return position(audioFiles(this.dirEntries.files), this.fileView.path);
  }

  setFileWrap(on: boolean): void {
    this.fileWrap = on;
    this.deps.settings.setFileWrap(on);
  }

  setTerminalFontSize(size: number): void {
    const clamped = clampFontSize(size);
    this.terminalFontSize = clamped;
    this.deps.settings.setTerminalFontSize(clamped);
  }

  setElevenLabsApiKey(key: string): void {
    this.elevenLabsApiKey = key;
    this.deps.settings.setElevenLabsApiKey(key);
  }

  setFolderFilter(keys: string[]): void {
    this.folderFilter = keys;
    this.deps.settings.setFolderFilter(keys);
  }

  setKeyboardAnchor(focus: (() => void) | null): void {
    this.keyboardAnchor = focus;
  }

  notifyUpdateAvailable(label: string | null): void {
    this.incomingBuildLabel = label;
    this.updateReady = true;
  }

  applyUpdate(): void {
    this.deps.applyUpdate?.();
  }

  dismissUpdate(): void {
    this.updateReady = false;
  }

  requestCreate(machineId: string, projectPath: string, command: string): void {
    // Open the keyboard while the create tap's gesture is still live (see keyboardAnchor).
    this.keyboardAnchor?.();
    this.createError = null;
    const existingIds = new Set(this.workspaces.map((w) => w.id));
    this.pendingCreate = { machineId, projectPath, existingIds };
    this.lastMachineId = machineId;
    this.deps.settings.setLastMachine(machineId);
    this.lastCommand = command;
    this.deps.settings.setLastCommand(command);
    this.send(machineId, { type: 'create', projectPath, command });
    // Stay on the create form until the agent confirms the workspace (then we jump into it)
    // or reports an error (surfaced inline). This keeps the form's draft so the user can fix
    // a bad path without retyping.
  }

  // Once the agent reports the new workspace, jump into it with the keyboard up so the
  // user can type the first command. Matching by (machine, path, not-seen-before id)
  // pinpoints the one we just created even if others share the path.
  private maybeOpenCreated(): void {
    const pending = this.pendingCreate;
    if (!pending) return;
    const created = this.workspaces.find(
      (w) => w.machineId === pending.machineId && w.projectPath === pending.projectPath && !pending.existingIds.has(w.id),
    );
    if (!created) return;
    this.pendingCreate = null;
    if (this.view === 'list' || this.view === 'create') this.open(created, true);
  }

  addMachine(config: MachineConfig): void {
    this.deps.settings.add(config);
    this.machines = this.deps.settings.list();
    this.deps.manager.setMachines(this.machines);
    this.recomputeGrace();
  }

  updateMachine(id: string, patch: { url: string; token?: string; defaultPath?: string }): void {
    this.deps.settings.update(id, patch);
    this.machines = this.deps.settings.list();
    this.deps.manager.setMachines(this.machines);
    this.recomputeGrace();
  }

  removeMachine(id: string): void {
    this.deps.settings.remove(id);
    this.machines = this.deps.settings.list();
    this.deps.manager.setMachines(this.machines);
    this.recomputeGrace();
  }

  toggleMachine(id: string): void {
    const current = this.machines.find((m) => m.id === id);
    if (!current) return;
    this.deps.settings.setEnabled(id, current.enabled === false);
    this.machines = this.deps.settings.list();
    this.deps.manager.setMachines(this.machines);
    this.recomputeGrace();
  }

  reconnectMachine(id: string): void {
    this.deps.connectionLog?.push(id, 'manual-reconnect');
    this.deps.manager.reconnect(id);
  }

  private send(machineId: string, message: ClientMessage): void {
    this.deps.manager.send(machineId, message);
  }
}
