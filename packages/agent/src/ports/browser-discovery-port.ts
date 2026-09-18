export interface BrowserSessionInfo {
  name: string;
  streamPort: number;
}

export interface BrowserDiscoveryPort {
  // Live agent-browser sessions on this machine. A session is live when its stream
  // sidecar file names a port and its pid sidecar names a running process.
  listSessions(): Promise<BrowserSessionInfo[]>;
}
