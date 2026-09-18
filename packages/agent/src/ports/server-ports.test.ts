import { describe, it, expect } from 'vitest';
import type { PtyPort, PtySession } from './pty-port';
import type { ClientConnection } from './client-connection';
import type { AgentMessage } from '@perch/contracts';

describe('server ports', () => {
  it('can be implemented by in-memory fakes', () => {
    const sent: AgentMessage[] = [];
    const conn: ClientConnection = {
      send: (m) => {
        sent.push(m);
      },
      close: () => undefined,
      onMessage: () => undefined,
      onClose: () => undefined,
    };
    const session: PtySession = {
      onData: () => undefined,
      onExit: () => undefined,
      write: () => undefined,
      resize: () => undefined,
      kill: () => undefined,
    };
    const pty: PtyPort = { spawn: () => session };

    conn.send({ type: 'authResult', ok: true });
    pty.spawn({ command: 'tmux', args: [], cols: 80, rows: 24 }).write('x');
    expect(sent).toEqual([{ type: 'authResult', ok: true }]);
  });
});
