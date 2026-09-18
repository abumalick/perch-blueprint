import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import App from '../App.svelte';

// Force the wide (≥980px) layout by faking a matching media query. Absent this stub
// trackWide falls back to false (jsdom has no matchMedia), so tests render narrow.
function stubWide() {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => vi.unstubAllGlobals());

function fakeStore(view: string) {
  return {
    view,
    homeView: 'list',
    start: vi.fn(),
    workspaces: [],
    statuses: {},
    machines: [],
    active: null,
    recentPaths: {},
    terminalState: 'live',
    open: vi.fn(), back: vi.fn(), goCreate: vi.fn(), goSettings: vi.fn(), goNewMachine: vi.fn(),
    addMachine: vi.fn(), removeMachine: vi.fn(), requestCreate: vi.fn(),
    attach: vi.fn(), sendInput: vi.fn(), resize: vi.fn(), closeActive: vi.fn(),
    setKeyboardAnchor: vi.fn(), reconnectAll: vi.fn(), logConnectivity: vi.fn(),
    unattachedBrowserSessions: () => [] as { connectionId: string; name: string }[],
    openBrowserView: vi.fn(),
    browserTarget: null as { connectionId: string; session: string } | null,
    closeBrowserView: vi.fn(),
    openBrowserStream: vi.fn(() => null),
  };
}

describe('App', () => {
  it('calls start on mount and renders the list view', () => {
    const store = fakeStore('list');
    render(App, { props: { store: store as never } });
    expect(store.start).toHaveBeenCalled();
    expect(screen.getByText('Perch')).toBeInTheDocument();
  });

  it('renders the settings view', () => {
    const store = fakeStore('settings');
    render(App, { props: { store: store as never } });
    expect(screen.getByText(/machines/i)).toBeInTheDocument();
  });

  it('renders the add-machine view', () => {
    const store = fakeStore('newMachine');
    render(App, { props: { store: store as never } });
    expect(screen.getByRole('heading', { name: /add machine/i })).toBeInTheDocument();
  });

  it('narrow layout shows only the active view, no sidebar', () => {
    const store = fakeStore('settings');
    render(App, { props: { store: store as never } });
    expect(screen.getByText(/machines/i)).toBeInTheDocument();
    expect(screen.queryByText('Perch')).not.toBeInTheDocument();
  });

  it('wide layout shows the workspace sidebar beside the active view', () => {
    stubWide();
    const store = fakeStore('settings');
    render(App, { props: { store: store as never } });
    // Sidebar (workspace list header) and the right-pane active view render together.
    expect(screen.getByText('Perch')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /machines/i })).toBeInTheDocument();
  });

  it('wide layout shows a placeholder in the right pane when no workspace is selected', () => {
    stubWide();
    const store = fakeStore('list');
    render(App, { props: { store: store as never } });
    expect(screen.getByText('Perch')).toBeInTheDocument();
    expect(screen.getByText(/select a workspace/i)).toBeInTheDocument();
  });

  it('renders the browser view for an open browser target', () => {
    const store = fakeStore('browserView');
    store.browserTarget = { connectionId: 'mac', session: 'github' };
    render(App, { props: { store: store as never } });
    expect(store.openBrowserStream).toHaveBeenCalled();
    expect(screen.getByText('github')).toBeInTheDocument();
  });

  it('reconnects machines when the tab returns to the foreground', () => {
    const store = fakeStore('list');
    render(App, { props: { store: store as never } });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.reconnectAll).toHaveBeenCalled();
  });

  it('reconnects machines when the browser comes back online', () => {
    const store = fakeStore('list');
    render(App, { props: { store: store as never } });
    window.dispatchEvent(new Event('online'));
    expect(store.reconnectAll).toHaveBeenCalled();
  });

  it('removes the reconnect listeners on unmount', () => {
    const store = fakeStore('list');
    const { unmount } = render(App, { props: { store: store as never } });
    unmount();
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.reconnectAll).not.toHaveBeenCalled();
  });
});
