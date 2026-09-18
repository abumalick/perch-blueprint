import { describe, it, expect } from 'vitest';
import { SystemdScopeReaper } from './systemd-scope-reaper';

const SCOPE = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-00000000-0000-4000-8000-000000000001.scope\n';

describe('SystemdScopeReaper', () => {
  it('reads the pane scope out of the cgroup line', async () => {
    const reaper = new SystemdScopeReaper(async () => SCOPE);
    expect(await reaper.scopeForPid(4242)).toBe(
      'tmux-spawn-00000000-0000-4000-8000-000000000001.scope',
    );
  });

  it('asks for the cgroup of the pid it was given', async () => {
    const asked: number[] = [];
    const reaper = new SystemdScopeReaper(async (pid) => {
      asked.push(pid);
      return SCOPE;
    });
    await reaper.scopeForPid(4242);
    expect(asked).toEqual([4242]);
  });

  // THE safety property. tmux without systemd support (or a pane the agent itself spawned)
  // leaves the process in the agent's OWN unit — returning that would make the close stop
  // `perch-agent.service`, killing the agent instead of the leftovers.
  it('refuses any cgroup that is not a tmux pane scope', async () => {
    const cases = [
      '0::/user.slice/user-1000.slice/user@1000.service/app.slice/perch-agent.service\n',
      '0::/user.slice/user-1000.slice/user@1000.service/init.scope\n',
      '0::/system.slice/nginx.service\n',
      '0::/\n',
      '',
    ];
    for (const cgroup of cases) {
      const reaper = new SystemdScopeReaper(async () => cgroup);
      expect(await reaper.scopeForPid(4242), cgroup).toBeNull();
    }
  });

  it('returns null when the process is already gone', async () => {
    const reaper = new SystemdScopeReaper(async () => {
      throw new Error('ENOENT: no such file or directory');
    });
    expect(await reaper.scopeForPid(4242)).toBeNull();
  });

  it('stops a scope through systemctl --user', async () => {
    const ran: Array<[string, string[]]> = [];
    const reaper = new SystemdScopeReaper(async () => SCOPE, async (cmd, args) => {
      ran.push([cmd, args]);
    });
    await reaper.stopScope('tmux-spawn-abc.scope');
    expect(ran).toEqual([['systemctl', ['--user', 'stop', 'tmux-spawn-abc.scope']]]);
  });

  // The name reaches an argv slot, never a shell — but it is derived from a file the agent
  // does not own, so refuse anything that is not the shape we produced.
  it('refuses to stop a name that is not a tmux pane scope', async () => {
    let ran = false;
    const reaper = new SystemdScopeReaper(async () => SCOPE, async () => {
      ran = true;
    });
    await expect(reaper.stopScope('perch-agent.service')).rejects.toThrow();
    expect(ran).toBe(false);
  });
});
