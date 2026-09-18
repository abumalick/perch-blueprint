import type { Socket, SocketFactory } from '../core/ports/socket';

export const browserSocketFactory: SocketFactory = (url: string): Socket => {
  const ws = new WebSocket(url);
  return {
    // Sends are fire-and-forget (the Socket port returns void). A socket can linger in
    // CONNECTING — iOS WebKit stalls the tailnet path — where WebSocket.send throws
    // InvalidStateError; drop the frame instead so a throw can't abort callers (e.g. goCreate
    // sends to every machine before switching the view, so a stalled one made "New" do nothing).
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close: () => ws.close(),
    onMessage: (cb) => ws.addEventListener('message', (e: MessageEvent) => cb(String(e.data))),
    onOpen: (cb) => ws.addEventListener('open', () => cb()),
    onClose: (cb) =>
      ws.addEventListener('close', (e: CloseEvent) => cb({ code: e.code, reason: e.reason })),
    onError: (cb) => ws.addEventListener('error', () => cb()),
  };
};
