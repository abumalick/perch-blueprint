export interface PtySession {
  onData(listener: (data: string) => void): void;
  onExit(listener: () => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface PtyPort {
  spawn(input: { command: string; args: string[]; cols: number; rows: number }): PtySession;
}
