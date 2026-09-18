import { describe, it, expect } from 'vitest';
import {
  PERCH_PROTOCOL_VERSION,
  parseBrowserClientMessage,
  parseBrowserAgentMessage,
} from './index';

describe('@perch/contracts', () => {
  it('exposes a numeric protocol version', () => {
    expect(PERCH_PROTOCOL_VERSION).toBe(1);
  });

  it('exports the browser stream message parsers', () => {
    expect(typeof parseBrowserClientMessage).toBe('function');
    expect(typeof parseBrowserAgentMessage).toBe('function');
  });
});
