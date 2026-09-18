import * as pty from 'node-pty';
import type { PtyPort, PtySession } from '../ports/pty-port';

export class NodePtyAdapter implements PtyPort {
  spawn(input: { command: string; args: string[]; cols: number; rows: number }): PtySession {
    const proc = pty.spawn(input.command, input.args, {
      // The PWA's front-end is xterm.js, a 256-colour terminal, and this is what the tmux
      // client believes it is talking to. `xterm-color` understated it twice over: it has
      // no `kcbt`, so tmux could not parse back-tab (\x1b[Z) and forwarded a bare `Z`,
      // and its 8-colour claim made tmux flatten 256-colour output to the nearest ANSI
      // colour before it ever reached the phone.
      name: 'xterm-256color',
      cols: input.cols,
      rows: input.rows,
      cwd: process.env.HOME ?? process.cwd(),
      env: process.env,
    });
    return {
      onData: (listener) => {
        proc.onData(listener);
      },
      onExit: (listener) => {
        proc.onExit(() => listener());
      },
      write: (data) => {
        proc.write(data);
      },
      resize: (cols, rows) => {
        proc.resize(cols, rows);
      },
      kill: () => {
        proc.kill();
      },
    };
  }
}
