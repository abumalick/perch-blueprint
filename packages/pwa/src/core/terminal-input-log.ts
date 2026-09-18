// Fixed-capacity ring buffer for diagnosing terminal input on-device. Records the
// normalized input events and the pty bytes we emit, so the Settings panel can show what
// a given Android keyboard actually produces. Pure and DOM-free.

export interface InputLogRecord {
  kind: string; // event kind, e.g. 'compositionUpdate', 'beforeinput:insertText', 'keydown'
  detail: string; // human-readable event payload (data / inputType / key)
  out: string; // pty bytes emitted, printable-escaped by the caller
}

export interface InputLog {
  push(record: InputLogRecord): void;
  snapshot(): InputLogRecord[];
  clear(): void;
}

// Shared instance the Android input adapter writes to and the Settings diagnostics panel
// reads from. 200 entries is plenty to inspect a reproduction and negligible in memory.
export const inputLog = createInputLog(200);

export function createInputLog(capacity: number): InputLog {
  let records: InputLogRecord[] = [];
  return {
    push(record) {
      records.push(record);
      if (records.length > capacity) records.shift();
    },
    snapshot() {
      return records.slice();
    },
    clear() {
      records = [];
    },
  };
}
