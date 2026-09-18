export interface BrowserCommandPort {
  // Start a fresh browser session named after the workspace, on about:blank.
  start(session: string): Promise<void>;
  // Point an existing session at a URL. Only http(s) URLs are accepted.
  navigate(session: string, url: string): Promise<void>;
  // History navigation for an existing session.
  back(session: string): Promise<void>;
  forward(session: string): Promise<void>;
  // Close the session (its stream server then closes, ending attached viewers).
  stop(session: string): Promise<void>;
  // Resize the session's viewport to the attached viewer's canvas (CSS pixels).
  setViewport(session: string, width: number, height: number): Promise<void>;
}
