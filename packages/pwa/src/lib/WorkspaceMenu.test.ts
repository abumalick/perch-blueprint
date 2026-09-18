import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import WorkspaceMenu from './WorkspaceMenu.svelte';
import type { WorkspaceStatus } from '@perch/contracts';

function props(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    wide: false,
    fontSize: 16,
    canZoomIn: true,
    canZoomOut: true,
    status: 'idle' as WorkspaceStatus,
    urgent: false,
    browserSessions: [] as string[],
    browserWorkspaceId: 'perch-a',
    canStartBrowser: false,
    onRefresh: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFiles: vi.fn(),
    onNewWorkspace: vi.fn(),
    onOpenBrowser: vi.fn(),
    onStartBrowser: vi.fn(),
    onSetStatus: vi.fn(),
    onSetUrgent: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('WorkspaceMenu', () => {
  it('renders nothing while closed', () => {
    render(WorkspaceMenu, { props: props({ open: false }) as never });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull();
  });

  it('on mobile shows every action row and the current font size', () => {
    render(WorkspaceMenu, { props: props({ wide: false, fontSize: 16 }) as never });
    expect(screen.getByRole('button', { name: /refresh/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeTruthy();
    expect(screen.getByText('16')).toBeTruthy();
    expect(screen.getByRole('button', { name: /files/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /new workspace/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /status: idle/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^close$/i })).toBeTruthy();
  });

  it('shows GitHub Issues/Projects links when the workspace has a github repo', () => {
    render(WorkspaceMenu, { props: props({ github: { owner: 'someuser', repo: 'perch' } }) as never });
    const issues = screen.getByRole('link', { name: /issues/i });
    const projects = screen.getByRole('link', { name: /projects/i });
    expect(issues.getAttribute('href')).toBe('https://github.com/someuser/perch/issues');
    expect(projects.getAttribute('href')).toBe('https://github.com/users/someuser/projects');
  });

  it('shows the GitHub links even on wide layout', () => {
    render(WorkspaceMenu, { props: props({ wide: true, github: { owner: 'a', repo: 'b' } }) as never });
    expect(screen.getByRole('link', { name: /issues/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /projects/i })).toBeTruthy();
  });

  it('hides the GitHub links when the workspace has no github repo', () => {
    render(WorkspaceMenu, { props: props() as never });
    expect(screen.queryByRole('link', { name: /issues/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /projects/i })).toBeNull();
  });

  it('on wide shows only Refresh and Font, hiding the mobile-only rows', () => {
    render(WorkspaceMenu, { props: props({ wide: true }) as never });
    expect(screen.getByRole('button', { name: /refresh/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /files/i })).toBeNull();
    // The wide layout's persistent sidebar already carries a ＋ button.
    expect(screen.queryByRole('button', { name: /new workspace/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /status:/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^close$/i })).toBeNull();
  });

  it('fires the non-navigating action callbacks and keeps the drawer open', async () => {
    const p = props();
    render(WorkspaceMenu, { props: p as never });
    await fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    await fireEvent.click(screen.getByRole('button', { name: /zoom out/i }));
    expect(p.onRefresh).toHaveBeenCalled();
    expect(p.onZoomIn).toHaveBeenCalled();
    expect(p.onZoomOut).toHaveBeenCalled();
    // Refresh/zoom are repeat-use, so the drawer stays open.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('fires Files and dismisses the drawer (a navigating action)', async () => {
    const p = props();
    render(WorkspaceMenu, { props: p as never });
    await fireEvent.click(screen.getByRole('button', { name: /files/i }));
    expect(p.onFiles).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fires New workspace and dismisses the drawer (a navigating action)', async () => {
    const p = props();
    render(WorkspaceMenu, { props: p as never });
    await fireEvent.click(screen.getByRole('button', { name: /new workspace/i }));
    expect(p.onNewWorkspace).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fires Close and dismisses the drawer (a navigating action)', async () => {
    const p = props();
    render(WorkspaceMenu, { props: p as never });
    await fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(p.onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables the zoom buttons at their bounds', () => {
    render(WorkspaceMenu, { props: props({ canZoomIn: false, canZoomOut: true }) as never });
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /zoom out/i })).not.toBeDisabled();
  });

  it('opens a single session directly through the browser picker', async () => {
    const p = props({ browserSessions: ['perch-a'] });
    render(WorkspaceMenu, { props: p as never });
    expect(screen.queryByRole('button', { name: /start browser/i })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /^browser$/i }));
    expect(p.onOpenBrowser).toHaveBeenCalledWith('perch-a');
  });

  it('shows Start browser when supported and no session exists', async () => {
    const p = props({ canStartBrowser: true });
    render(WorkspaceMenu, { props: p as never });
    await fireEvent.click(screen.getByRole('button', { name: /start browser/i }));
    expect(p.onStartBrowser).toHaveBeenCalled();
  });

  it('shows no browser control when there are no sessions and starting is unavailable', () => {
    render(WorkspaceMenu, { props: props({ browserSessions: [], canStartBrowser: false }) as never });
    expect(screen.queryByRole('button', { name: /browser/i })).toBeNull();
  });

  it('sets a new status through the picker', async () => {
    const p = props();
    render(WorkspaceMenu, { props: p as never });
    await fireEvent.click(screen.getByRole('button', { name: /status: idle/i }));
    await fireEvent.click(screen.getByRole('option', { name: /blocked/i }));
    expect(p.onSetStatus).toHaveBeenCalledWith('blocked');
  });

  it('marks a workspace urgent from the drawer, keeping it open (non-navigating)', async () => {
    const p = props({ urgent: false });
    render(WorkspaceMenu, { props: p as never });
    await fireEvent.click(screen.getByRole('button', { name: /mark urgent/i }));
    expect(p.onSetUrgent).toHaveBeenCalledWith(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('reflects the urgent state and clears it on tap', async () => {
    const p = props({ urgent: true });
    render(WorkspaceMenu, { props: p as never });
    const toggle = screen.getByRole('button', { name: /urgent/i, pressed: true });
    expect(toggle).toBeTruthy();
    await fireEvent.click(toggle);
    expect(p.onSetUrgent).toHaveBeenCalledWith(false);
  });

  it('shows the urgent toggle even on wide layout', () => {
    render(WorkspaceMenu, { props: props({ wide: true }) as never });
    expect(screen.getByRole('button', { name: /urgent/i })).toBeTruthy();
  });

  it('closes on a scrim tap', async () => {
    render(WorkspaceMenu, { props: props() as never });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /dismiss menu/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', async () => {
    render(WorkspaceMenu, { props: props() as never });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
