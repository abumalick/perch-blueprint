import { WebSocket } from 'ws';
import type { RelaySocket, ConnectUpstream } from '../ports/browser-stream-port';

export function wsRelaySocket(socket: WebSocket): RelaySocket {
  return {
    send: (data) => socket.send(data),
    bufferedAmount: () => socket.bufferedAmount,
    onMessage: (listener) => {
      socket.on('message', (raw) => listener(raw.toString()));
    },
    onClose: (listener) => {
      socket.on('close', listener);
    },
    close: () => socket.close(),
  };
}

// Dials the local agent-browser stream server. Deliberately sends no Origin header:
// agent-browser's origin gate rejects browser origins but accepts header-less clients.
export const connectBrowserUpstream: ConnectUpstream = (port) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.once('error', reject);
    socket.once('open', () => {
      socket.removeListener('error', reject);
      // Post-open errors also emit 'close', which the relay handles; swallow the
      // 'error' event itself so it doesn't crash the process as unhandled.
      socket.on('error', () => undefined);
      resolve(wsRelaySocket(socket));
    });
  });
