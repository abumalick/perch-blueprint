import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { NodePtyAdapter } from './node-pty-adapter';
import type { PtySession } from '../ports/pty-port';

const exec = promisify(execFile);
const created: string[] = [];
let openSession: PtySession | null = null;

afterEach(async () => {
  if (openSession) {
    openSession.kill();
    openSession = null;
  }
  for (const name of created.splice(0)) {
    await exec('tmux', ['kill-session', '-t', name]).catch(() => undefined);
  }
});

// Poll until `check` returns something truthy, rather than sleeping a guessed interval.
async function until<T>(check: () => Promise<T | null | false>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check().catch(() => null);
    if (result) return result as T;
    if (Date.now() > deadline) throw new Error('condition not met within timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('NodePtyAdapter (real node-pty + tmux)', () => {
  it('attaches to a tmux session and streams output', async () => {
    const name = `perch-pty-${Date.now()}`;
    created.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 30']);

    const adapter = new NodePtyAdapter();
    openSession = adapter.spawn({ command: 'tmux', args: ['attach-session', '-t', name], cols: 80, rows: 24 });

    const data = await new Promise<string>((resolve) => {
      let buf = '';
      openSession!.onData((d: string) => {
        buf += d;
        if (buf.length > 0) resolve(buf);
      });
      setTimeout(() => resolve(buf), 2000);
    });

    expect(data.length).toBeGreaterThan(0); // tmux paints the screen on attach
  });

  // The tmux client parses the bytes we write as *keys*, using its terminfo. An entry
  // without `kcbt` (back-tab) leaves it unable to recognise \x1b[Z: it swallows the
  // `ESC [` as an unknown CSI and forwards a bare literal `Z`. That is invisible for the
  // arrows (every entry has kcub1/kcuf1) and silently broke the keyboard bar's Shift+Tab,
  // which is the only way to reach Claude Code's permission-mode cycle from the phone.
  it('forwards a back-tab key press through to the session', async () => {
    const name = `perch-pty-${Date.now()}`;
    created.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'cat -v']);

    const adapter = new NodePtyAdapter();
    openSession = adapter.spawn({ command: 'tmux', args: ['attach-session', '-t', name], cols: 80, rows: 24 });
    // The write is only parsed as a key once the client is actually attached.
    await until(async () => (await exec('tmux', ['list-clients', '-t', name])).stdout.trim().length > 0);

    openSession.write('\x1b[Z');
    const pane = await until(async () => {
      const { stdout } = await exec('tmux', ['capture-pane', '-p', '-t', name]);
      return stdout.trim().length > 0 ? stdout.trim() : null;
    });

    expect(pane).toContain('^[[Z');
  });
});
