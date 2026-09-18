import { describe, it, expect } from 'vitest';
import { parseCommands } from './parse-commands';

describe('parseCommands', () => {
  it('reads command entries, defaulting submit to false', () => {
    expect(parseCommands([{ command: '/myplugin:task' }, { command: '/rename', submit: true }])).toEqual([
      { command: '/myplugin:task', submit: false },
      { command: '/rename', submit: true },
    ]);
  });

  it('returns an empty list for a non-array payload', () => {
    expect(parseCommands({ commands: [{ command: '/rename' }] })).toEqual([]);
  });

  it('drops entries whose command is missing, empty, or not a string', () => {
    expect(
      parseCommands([{ command: '/keep' }, { command: '' }, { command: 42 }, { submit: true }]),
    ).toEqual([{ command: '/keep', submit: false }]);
  });

  it('drops entries that are not objects', () => {
    expect(parseCommands(['/rename', null, 42, { command: '/keep' }])).toEqual([
      { command: '/keep', submit: false },
    ]);
  });

  // A hand-edited file is forgiving on `submit`: only a literal `true` submits, and a bad
  // value costs the flag rather than silently dropping the command the user wanted.
  it('treats a non-boolean submit as false rather than dropping the entry', () => {
    expect(parseCommands([{ command: '/rename', submit: 'yes' }])).toEqual([
      { command: '/rename', submit: false },
    ]);
  });
});
