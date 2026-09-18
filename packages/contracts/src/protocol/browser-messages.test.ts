import { describe, it, expect } from 'vitest';
import { parseBrowserClientMessage, parseBrowserAgentMessage } from './browser-messages';

describe('browserClientMessageSchema', () => {
  it('parses an auth message', () => {
    expect(parseBrowserClientMessage({ type: 'auth', token: 'secret' })).toEqual({
      type: 'auth',
      token: 'secret',
    });
  });

  it('parses a ping message', () => {
    expect(parseBrowserClientMessage({ type: 'ping' })).toEqual({ type: 'ping' });
  });

  it('parses an input_mouse press with optional fields', () => {
    const msg = {
      type: 'input_mouse',
      eventType: 'mousePressed',
      x: 12,
      y: 34,
      button: 'left',
      clickCount: 1,
      modifiers: 0,
    };
    expect(parseBrowserClientMessage(msg)).toEqual(msg);
  });

  it('parses an input_mouse wheel with deltas and no button', () => {
    const msg = { type: 'input_mouse', eventType: 'mouseWheel', x: 5, y: 6, deltaX: 0, deltaY: -120 };
    expect(parseBrowserClientMessage(msg)).toEqual(msg);
  });

  it('rejects an input_mouse message without coordinates', () => {
    expect(() => parseBrowserClientMessage({ type: 'input_mouse', eventType: 'mousePressed' })).toThrow();
  });

  it('parses an input_keyboard message', () => {
    const msg = { type: 'input_keyboard', eventType: 'keyDown', key: 'a', code: 'KeyA', text: 'a' };
    expect(parseBrowserClientMessage(msg)).toEqual(msg);
  });

  it('parses an input_touch message', () => {
    const msg = {
      type: 'input_touch',
      eventType: 'touchStart',
      touchPoints: [{ x: 10, y: 20 }],
    };
    expect(parseBrowserClientMessage(msg)).toEqual(msg);
  });

  it('parses a navigate message', () => {
    expect(parseBrowserClientMessage({ type: 'navigate', url: 'https://example.com' })).toEqual({
      type: 'navigate',
      url: 'https://example.com',
    });
  });

  it('parses back, forward and closeSession messages', () => {
    for (const type of ['back', 'forward', 'closeSession']) {
      expect(parseBrowserClientMessage({ type })).toEqual({ type });
    }
  });

  it('parses a setViewport message with positive integer dimensions', () => {
    expect(parseBrowserClientMessage({ type: 'setViewport', width: 390, height: 844 })).toEqual({
      type: 'setViewport',
      width: 390,
      height: 844,
    });
  });

  it.each([
    { width: 0, height: 844 },
    { width: 390, height: -1 },
    { width: 390.5, height: 844 },
    { width: 390 },
  ])('rejects a setViewport message with invalid dimensions %j', (dims) => {
    expect(() => parseBrowserClientMessage({ type: 'setViewport', ...dims })).toThrow();
  });

  it('rejects an unknown message type', () => {
    expect(() => parseBrowserClientMessage({ type: 'frobnicate' })).toThrow();
  });
});

describe('browserAgentMessageSchema', () => {
  it('parses an authResult message', () => {
    expect(parseBrowserAgentMessage({ type: 'authResult', ok: true })).toEqual({
      type: 'authResult',
      ok: true,
    });
  });

  it('parses a pong message', () => {
    expect(parseBrowserAgentMessage({ type: 'pong' })).toEqual({ type: 'pong' });
  });

  it('parses an ended message with each known reason', () => {
    for (const reason of ['closed', 'not-found', 'error', 'opened-elsewhere']) {
      expect(parseBrowserAgentMessage({ type: 'ended', reason })).toEqual({ type: 'ended', reason });
    }
  });

  it('rejects an ended message with an unknown reason', () => {
    expect(() => parseBrowserAgentMessage({ type: 'ended', reason: 'nope' })).toThrow();
  });

  it('parses a frame message and keeps extra metadata keys', () => {
    const msg = {
      type: 'frame',
      data: '/9j/4AAQ',
      metadata: { deviceWidth: 390, deviceHeight: 844, timestamp: 123, sessionId: 'x' },
    };
    expect(parseBrowserAgentMessage(msg)).toEqual(msg);
  });

  it('rejects a frame message without metadata dimensions', () => {
    expect(() =>
      parseBrowserAgentMessage({ type: 'frame', data: '/9j/4AAQ', metadata: {} }),
    ).toThrow();
  });

  it('parses relayed tabs/url/status messages and keeps upstream extras', () => {
    const tabs = { type: 'tabs', tabs: [{ id: 't1', active: true }] };
    expect(parseBrowserAgentMessage(tabs)).toEqual(tabs);

    const url = { type: 'url', url: 'https://example.com', title: 'Example' };
    expect(parseBrowserAgentMessage(url)).toEqual(url);

    const status = { type: 'status', loading: true };
    expect(parseBrowserAgentMessage(status)).toEqual(status);
  });

  it('rejects a url message without a url', () => {
    expect(() => parseBrowserAgentMessage({ type: 'url' })).toThrow();
  });

  it('rejects an unknown message type', () => {
    expect(() => parseBrowserAgentMessage({ type: 'console', text: 'hi' })).toThrow();
  });
});
