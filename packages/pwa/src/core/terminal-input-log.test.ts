import { describe, expect, test } from 'vitest';
import { createInputLog } from './terminal-input-log';

describe('createInputLog', () => {
  test('starts empty', () => {
    expect(createInputLog(3).snapshot()).toEqual([]);
  });

  test('keeps records in insertion order', () => {
    const log = createInputLog(5);
    log.push({ kind: 'compositionUpdate', detail: 'gi', out: 'i' });
    log.push({ kind: 'enter', detail: '', out: '\\r' });
    expect(log.snapshot()).toEqual([
      { kind: 'compositionUpdate', detail: 'gi', out: 'i' },
      { kind: 'enter', detail: '', out: '\\r' },
    ]);
  });

  test('drops the oldest record past capacity', () => {
    const log = createInputLog(2);
    log.push({ kind: 'a', detail: '', out: '' });
    log.push({ kind: 'b', detail: '', out: '' });
    log.push({ kind: 'c', detail: '', out: '' });
    expect(log.snapshot().map((r) => r.kind)).toEqual(['b', 'c']);
  });

  test('clear empties the buffer', () => {
    const log = createInputLog(3);
    log.push({ kind: 'a', detail: '', out: '' });
    log.clear();
    expect(log.snapshot()).toEqual([]);
  });

  test('snapshot is a copy — mutating it does not affect the log', () => {
    const log = createInputLog(3);
    log.push({ kind: 'a', detail: '', out: '' });
    const snap = log.snapshot();
    snap.push({ kind: 'x', detail: '', out: '' });
    expect(log.snapshot()).toHaveLength(1);
  });
});
