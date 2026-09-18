import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TmuxPort, TmuxSessionInfo } from '../ports/tmux-port';

const exec = promisify(execFile);

// Field separator for `list-sessions -F`. It must be PRINTABLE ASCII: when the agent
// runs as a service (launchd/systemd) its tmux client has no controlling TTY, and in
// that mode tmux rewrites every control character (tab, newline, …) and every
// non-ASCII byte in format output to `_`. A tab separator silently collapsed, so every
// line parsed as a single field and listSessions returned nothing. `|:|` survives that
// rewrite and is vanishingly unlikely to occur in a session name, path, or command.
// pane_title is last so it can contain the separator harmlessly (it's the remainder).
const SEP = '|:|';
const FORMAT = [
  '#{session_name}',
  '#{session_path}',
  '#{session_created}',
  '#{@perch_command}',
  '#{pane_title}',
].join(SEP);

export function isNoServer(err: unknown): boolean {
  const stderr = (err as { stderr?: string }).stderr ?? '';
  // "no server running on <socket>" — the socket exists but the server is down.
  // "error connecting to <socket> (No such file or directory)" — the socket itself is
  // gone, which is what happens on a cold boot: /tmp is wiped before any tmux ran. Both
  // mean there is no server, hence no sessions; missing this second form crash-looped the
  // agent on startup after every reboot.
  return stderr.includes('no server running') || stderr.includes('error connecting to');
}

function isMissingSession(err: unknown): boolean {
  const stderr = (err as { stderr?: string }).stderr ?? '';
  // `list-panes -t <session>` resolves its target as a window, so it reports an absent
  // session as a missing *window* — a different message for the same "target is gone".
  return (
    isNoServer(err) ||
    stderr.includes("can't find session") ||
    stderr.includes("can't find window")
  );
}

function parseLine(line: string): TmuxSessionInfo | null {
  const parts = line.split(SEP);
  if (parts.length < 3) return null;
  const [name, startPath, created, command] = parts;
  if (!name || !startPath || !created) return null;
  return {
    name,
    startPath,
    command: command ?? '',
    createdAt: Number(created) * 1000,
    title: parts.slice(4).join(SEP),
  };
}

export class TmuxAdapter implements TmuxPort {
  // tmux's default terminal-features for xterm* lacks `hyperlinks`, so it strips OSC 8
  // links before streaming them to the agent's `attach-session` client. Append the
  // feature (server-global, persists for the tmux server's life). The show-check both
  // avoids a duplicate entry and makes this self-healing — run on every attach, it
  // re-adds the feature if anything (another tool, a config reload) ever cleared it,
  // rather than latching once and never recovering.
  async ensureHyperlinks(): Promise<void> {
    try {
      const { stdout } = await exec('tmux', ['show', '-g', 'terminal-features']);
      if (!stdout.includes('hyperlinks')) {
        await exec('tmux', ['set', '-as', 'terminal-features', '*:hyperlinks']);
      }
    } catch (err) {
      if (isNoServer(err)) return; // no server yet — a later attach retries
      throw err;
    }
  }

  async listSessions(prefix: string): Promise<TmuxSessionInfo[]> {
    let stdout: string;
    try {
      const res = await exec('tmux', ['list-sessions', '-F', FORMAT]);
      stdout = res.stdout;
    } catch (err) {
      if (isNoServer(err)) return [];
      throw err;
    }
    return stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map(parseLine)
      .filter((s): s is TmuxSessionInfo => s !== null && s.name.startsWith(prefix));
  }

  async createSession(input: { name: string; cwd: string; command: string }): Promise<void> {
    await exec('tmux', ['new-session', '-d', '-s', input.name, '-c', input.cwd, input.command]);
    await exec('tmux', ['set-option', '-t', input.name, '@perch_command', input.command]);
  }

  async killSession(name: string): Promise<void> {
    // Idempotent: when the inner process exits, tmux destroys the session on its own, so a
    // later close finds nothing to kill. Treat an already-absent session as success.
    try {
      await exec('tmux', ['kill-session', '-t', name]);
    } catch (err) {
      if (isMissingSession(err)) return;
      throw err;
    }
  }

  async panePid(name: string): Promise<number | null> {
    let stdout: string;
    try {
      const res = await exec('tmux', ['list-panes', '-t', name, '-F', '#{pane_pid}']);
      stdout = res.stdout;
    } catch (err) {
      if (isMissingSession(err)) return null;
      throw err;
    }
    const pid = Number(stdout.split('\n')[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  async hasSession(name: string): Promise<boolean> {
    try {
      await exec('tmux', ['has-session', '-t', name]);
      return true;
    } catch {
      return false;
    }
  }
}
