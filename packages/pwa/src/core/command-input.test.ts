import { describe, it, expect } from 'vitest';
import { commandInput } from './command-input';

describe('commandInput', () => {
  // The command lands in the prompt with the cursor after it, so the rest of the request
  // can be typed or dictated.
  it('appends a space to a command that takes an argument', () => {
    expect(commandInput({ command: '/myplugin:task', submit: false })).toBe(
      '/myplugin:task ',
    );
  });

  it('appends a carriage return to a submit command', () => {
    expect(commandInput({ command: '/rename', submit: true })).toBe('/rename\r');
  });
});
