import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ProcessScopePort } from '../ports/process-scope-port';

const exec = promisify(execFile);

export type CgroupReader = (pid: number) => Promise<string>;
export type ScopeCommandRunner = (cmd: string, args: string[]) => Promise<void>;

// tmux names every pane scope this way (systemd.c: `tmux-spawn-<uuid>.scope`). Matching the
// shape is what keeps this from ever stopping the agent's own unit — see `isPaneScope`.
const PANE_SCOPE = /^tmux-spawn-[0-9a-f-]+\.scope$/;

const readProcCgroup: CgroupReader = (pid) => readFile(`/proc/${pid}/cgroup`, 'utf8');

const execFileRunner: ScopeCommandRunner = async (cmd, args) => {
  await exec(cmd, args);
};

function isPaneScope(name: string): boolean {
  return PANE_SCOPE.test(name);
}

// Reaps the transient systemd scope a tmux pane ran in. Linux-only by construction: on a
// machine without /proc or systemd every lookup fails and yields null, which the close path
// treats as "nothing to reap" rather than an error.
export class SystemdScopeReaper implements ProcessScopePort {
  constructor(
    private readonly readCgroup: CgroupReader = readProcCgroup,
    private readonly run: ScopeCommandRunner = execFileRunner,
  ) {}

  async scopeForPid(pid: number): Promise<string | null> {
    let cgroup: string;
    try {
      cgroup = await this.readCgroup(pid);
    } catch {
      return null; // the process is gone, or this is not Linux
    }
    // cgroup v2: a single `0::<path>` line. The unit is the last path segment.
    const leaf = cgroup.trim().split('/').pop() ?? '';
    return isPaneScope(leaf) ? leaf : null;
  }

  async stopScope(name: string): Promise<void> {
    // Anything else reaching here is a bug upstream, and the blast radius of obeying it is
    // the agent's own unit. Refuse loudly rather than shell out.
    if (!isPaneScope(name)) {
      throw new Error(`refusing to stop non-pane unit: ${name}`);
    }
    await this.run('systemctl', ['--user', 'stop', name]);
  }
}
