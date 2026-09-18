import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BrowserCommandPort } from '../ports/browser-command-port';

const exec = promisify(execFile);

export type CommandRunner = (
  cmd: string,
  args: string[],
  env: Record<string, string>,
) => Promise<void>;

// argv array, never a shell string — the URL must not reach a shell. The env
// overlay extends process.env: the agent runs as a service, and the child needs
// the inherited PATH to locate the agent-browser mise shim.
export const execFileRunner: CommandRunner = async (cmd, args, env) => {
  await exec(cmd, args, { env: { ...process.env, ...env } });
};

// Every command runs with an empty env overlay (NO_ENV). agent-browser derives a session's
// config hash from the launch env, and it relaunches the browser — dropping the current page
// and the live stream — whenever a command's config differs from how the session was created.
// Imposing AGENT_BROWSER_IDLE_TIMEOUT_MS here therefore nukes any session created with a
// different (or no) idle-timeout env — exactly what happened to agent-created sessions the
// moment Perch steered them (setViewport on viewer attach). Staying env-less keeps Perch's
// commands config-compatible with those sessions. The cost is that Perch no longer sets a
// 30-minute idle auto-close on the sessions it starts; they close via the UI's ✕ instead.
const NO_ENV: Record<string, string> = {};

function isHttpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

export class AgentBrowserCli implements BrowserCommandPort {
  constructor(private readonly run: CommandRunner = execFileRunner) {}

  async start(session: string): Promise<void> {
    await this.run('agent-browser', ['--session', session, 'open', 'about:blank'], NO_ENV);
    await this.setPhoneViewport(session);
  }

  // A phone-sized viewport renders ~1:1 on the phone canvas, so taps land precisely
  // (a 1280px page scaled to a 390px screen needs sub-finger accuracy). Best-effort:
  // an older CLI without `set viewport` still yields a usable session.
  private async setPhoneViewport(session: string): Promise<void> {
    try {
      await this.run(
        'agent-browser',
        ['--session', session, 'set', 'viewport', '390', '700'],
        NO_ENV,
      );
    } catch {
      // viewport is an enhancement, not a requirement
    }
  }

  async navigate(session: string, url: string): Promise<void> {
    if (!isHttpUrl(url)) {
      throw new Error(`refusing to open non-http(s) URL: ${url}`);
    }
    await this.run('agent-browser', ['--session', session, 'open', url], NO_ENV);
  }

  async back(session: string): Promise<void> {
    await this.run('agent-browser', ['--session', session, 'back'], NO_ENV);
  }

  async forward(session: string): Promise<void> {
    await this.run('agent-browser', ['--session', session, 'forward'], NO_ENV);
  }

  async stop(session: string): Promise<void> {
    await this.run('agent-browser', ['--session', session, 'close'], NO_ENV);
  }

  async setViewport(session: string, width: number, height: number): Promise<void> {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error('viewport dimensions must be finite');
    }
    const clamp = (n: number) => String(Math.min(4096, Math.max(200, Math.round(n))));
    await this.run(
      'agent-browser',
      ['--session', session, 'set', 'viewport', clamp(width), clamp(height)],
      NO_ENV,
    );
  }
}
