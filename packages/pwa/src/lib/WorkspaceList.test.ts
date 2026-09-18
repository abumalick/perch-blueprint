import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import WorkspaceList from './WorkspaceList.svelte';
import { deriveHomeView, type HomeView } from '../core/home-view';

function fakeStore(
  workspaces: unknown[],
  machines: { id: string; name?: string; enabled?: boolean; defaultPath?: string }[] = [
    { id: 'mac', name: 'Mac' },
  ],
  active: unknown = null,
  homeView?: HomeView,
  folderFilter: string[] = [],
) {
  const statuses: Record<string, string> = { mac: 'online' };
  return {
    workspaces,
    machines,
    active,
    statuses,
    homeView:
      homeView ??
      deriveHomeView({
        enabledMachineCount: machines.filter((m) => m.enabled !== false).length,
        anyOnline: machines.some((m) => m.enabled !== false && statuses[m.id] === 'online'),
        workspaceCount: workspaces.length,
        graceElapsed: true,
      }),
    open: vi.fn(),
    goCreate: vi.fn(),
    goSettings: vi.fn(),
    reconnectAll: vi.fn(),
    unattachedBrowserSessions: () => [] as { connectionId: string; name: string }[],
    openBrowserView: vi.fn(),
    browserSessions: {} as Record<string, { name: string }[]>,
    supportsBrowser: (_connectionId: string) => false,
    folderFilter,
    setFolderFilter: vi.fn(),
  };
}

const ws = {
  machineId: 'mac', id: 'perch-a', name: 'api', projectPath: '/home/u/workspace/api',
  command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'needs-feedback',
};

const wsUbuntu = { ...ws, machineId: 'ubuntu', id: 'perch-b', name: 'web' };

describe('WorkspaceList', () => {
  it('renders the create (empty) state when a machine is online with no workspaces', () => {
    render(WorkspaceList, { props: { store: fakeStore([]) as never } });
    expect(screen.getByText(/no workspaces/i)).toBeInTheDocument();
  });

  it('prompts to add a machine when none are configured', async () => {
    const store = fakeStore([], [], null, 'add-machine');
    render(WorkspaceList, { props: { store: store as never } });
    expect(screen.getByTestId('home-add-machine')).toBeInTheDocument();
    expect(screen.queryByText(/no workspaces/i)).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /add a machine/i }));
    expect(store.goSettings).toHaveBeenCalled();
  });

  it('shows a loading screen while connecting', () => {
    render(WorkspaceList, { props: { store: fakeStore([], [], null, 'connecting') as never } });
    expect(screen.getByTestId('home-connecting')).toBeInTheDocument();
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('shows a calm reconnecting screen (no scary message, no button) for a known-reachable machine', () => {
    render(WorkspaceList, { props: { store: fakeStore([], [], null, 'reconnecting') as never } });
    expect(screen.getByTestId('home-reconnecting')).toBeInTheDocument();
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
    expect(screen.queryByText(/can't reach/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('reconnect-home')).not.toBeInTheDocument();
  });

  it('shows the unreachable screen and reconnects on tap', async () => {
    const store = fakeStore([], [], null, 'unreachable');
    render(WorkspaceList, { props: { store: store as never } });
    expect(screen.getByTestId('home-unreachable')).toBeInTheDocument();
    expect(screen.getByText(/tailscale/i)).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId('reconnect-home'));
    expect(store.reconnectAll).toHaveBeenCalled();
  });

  it('renders workspaces and opens one on tap', async () => {
    const store = fakeStore([ws]);
    render(WorkspaceList, { props: { store: store as never } });
    expect(screen.getByText('api')).toBeInTheDocument();
    await fireEvent.click(screen.getByText('api'));
    expect(store.open).toHaveBeenCalledWith(ws);
  });

  it('renders a Blocked badge for a workspace with the blocked status', () => {
    const blockedWs = { ...ws, id: 'perch-c', name: 'parked', status: 'blocked' };
    render(WorkspaceList, { props: { store: fakeStore([blockedWs]) as never } });
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.queryByText('Needs you')).not.toBeInTheDocument();
  });

  it('triggers create and settings', async () => {
    const store = fakeStore([]);
    render(WorkspaceList, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /new/i }));
    await fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(store.goCreate).toHaveBeenCalled();
    expect(store.goSettings).toHaveBeenCalled();
  });

  it('shows the build-slug badge when a non-main build is served', () => {
    render(WorkspaceList, { props: { store: fakeStore([]) as never, buildLabel: 'feat-x' } });
    expect(screen.getByText('feat-x')).toBeInTheDocument();
  });

  it('hides the badge for the main build', () => {
    render(WorkspaceList, { props: { store: fakeStore([]) as never, buildLabel: 'main' } });
    expect(screen.queryByText('main')).not.toBeInTheDocument();
  });

  it('shows the machine name when more than one machine is enabled', () => {
    const machines = [
      { id: 'mac', name: 'Mac' },
      { id: 'ubuntu', name: 'Ubuntu PC' },
    ];
    render(WorkspaceList, { props: { store: fakeStore([ws], machines) as never } });
    expect(screen.getByText('Mac')).toBeInTheDocument();
  });

  it('shows each workspace its own machine, not every machine', () => {
    const machines = [
      { id: 'mac', name: 'Mac' },
      { id: 'ubuntu', name: 'Ubuntu PC' },
    ];
    render(WorkspaceList, { props: { store: fakeStore([ws], machines) as never } });
    expect(screen.getByText('Mac')).toBeInTheDocument();
    expect(screen.queryByText('Ubuntu PC')).not.toBeInTheDocument();
  });

  it('hides the machine name when only one machine is enabled', () => {
    const machines = [{ id: 'mac', name: 'Mac' }];
    render(WorkspaceList, { props: { store: fakeStore([ws], machines) as never } });
    expect(screen.queryByText('Mac')).not.toBeInTheDocument();
  });

  it('counts only enabled machines, not all configured ones', () => {
    const machines = [
      { id: 'mac', name: 'Mac' },
      { id: 'ubuntu', name: 'Ubuntu PC', enabled: false },
    ];
    render(WorkspaceList, { props: { store: fakeStore([ws], machines) as never } });
    expect(screen.queryByText('Mac')).not.toBeInTheDocument();
  });

  it('shows the path relative to the machine default folder when set', () => {
    const machines = [{ id: 'mac', name: 'Mac', defaultPath: '/home/u/workspace' }];
    const w = { ...ws, name: 'dash', projectPath: '/home/u/workspace/dashboard' };
    render(WorkspaceList, { props: { store: fakeStore([w], machines) as never } });
    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(screen.queryByText('/home/u/workspace/dashboard')).not.toBeInTheDocument();
  });

  it('shows the full path when the machine has no default folder', () => {
    render(WorkspaceList, { props: { store: fakeStore([ws]) as never } });
    expect(screen.getByText('/home/u/workspace/api')).toBeInTheDocument();
  });

  it('marks the active workspace row as current (sidebar highlight)', () => {
    render(WorkspaceList, {
      props: { store: fakeStore([ws, wsUbuntu], [{ id: 'mac', name: 'Mac' }], ws) as never },
    });
    expect(screen.getByText('api').closest('button')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('web').closest('button')).not.toHaveAttribute('aria-current');
  });

  it('puts the folder line first and the terminal title on the second line', () => {
    const { container } = render(WorkspaceList, { props: { store: fakeStore([ws]) as never } });
    const [folderLine, titleLine] = [...container.querySelector('.body')!.children];
    expect(folderLine).toHaveClass('path-line');
    expect(folderLine!.querySelector('.path')).toHaveTextContent('/home/u/workspace/api');
    expect(titleLine).toHaveClass('name-line');
    expect(titleLine!.querySelector('.name')).toHaveTextContent('api');
  });

  it('renders the machine pill after the folder, on the folder line', () => {
    const machines = [
      { id: 'mac', name: 'Mac' },
      { id: 'ubuntu', name: 'Ubuntu PC' },
    ];
    const { container } = render(WorkspaceList, { props: { store: fakeStore([ws], machines) as never } });
    const folderLine = container.querySelector('.path-line')!;
    const kids = [...folderLine.children];
    const pathIdx = kids.findIndex((c) => c.classList.contains('path'));
    const machineIdx = kids.findIndex((c) => c.classList.contains('machine'));
    expect(machineIdx).toBeGreaterThan(pathIdx);
    expect(kids[machineIdx]).toHaveTextContent('Mac');
  });

  it('lists unattached browser sessions and opens the viewer on tap', async () => {
    const store = fakeStore([ws]);
    store.unattachedBrowserSessions = () => [{ connectionId: 'mac', name: 'github' }];
    render(WorkspaceList, { props: { store: store as never } });
    expect(screen.getByText(/browser sessions/i)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /github/i }));
    expect(store.openBrowserView).toHaveBeenCalledWith('mac', 'github');
  });

  it('hides the browser sessions section when every session is attached', () => {
    render(WorkspaceList, { props: { store: fakeStore([ws]) as never } });
    expect(screen.queryByText(/browser sessions/i)).toBeNull();
  });

  it('does not render a status dot', () => {
    const { container } = render(WorkspaceList, { props: { store: fakeStore([ws]) as never } });
    expect(container.querySelector('.dot')).toBeNull();
  });

  it('puts the status badge and chevron on the first line, leaving the title its own line', () => {
    const { container } = render(WorkspaceList, { props: { store: fakeStore([ws]) as never } });
    const folderLine = container.querySelector('.path-line')!;
    expect(folderLine.querySelector('.badge')).toHaveTextContent('Needs you');
    expect(folderLine.querySelector('.chev')).not.toBeNull();
    const titleLine = container.querySelector('.name-line')!;
    expect(titleLine.querySelector('.badge')).toBeNull();
    expect(titleLine.querySelector('.chev')).toBeNull();
    expect(titleLine).toHaveTextContent('api');
  });

  it('applies a persisted folder filter on first render', () => {
    const wsApi = { ...ws };
    const wsWeb = { ...ws, id: 'perch-b', name: 'web', projectPath: '/home/u/workspace/web' };
    const store = fakeStore(
      [wsApi, wsWeb],
      [{ id: 'mac', name: 'Mac' }],
      null,
      undefined,
      ['/home/u/workspace/api'],
    );
    const { container } = render(WorkspaceList, { props: { store: store as never } });
    expect(container.querySelectorAll('.row')).toHaveLength(1);
  });

  it('does not wipe a persisted filter while the workspace list has not loaded yet', () => {
    // Right after a reload, store.workspaces starts empty until the agent's async `list`
    // reply arrives — that must not look like "the selected folder vanished".
    const store = fakeStore([], [{ id: 'mac', name: 'Mac' }], null, undefined, [
      '/home/u/workspace/api',
    ]);
    render(WorkspaceList, { props: { store: store as never } });
    expect(store.setFolderFilter).not.toHaveBeenCalled();
  });

  it('toggling a folder pill persists the selection through the store', async () => {
    // jsdom has no Web Animations API; force motionDuration() to 0 so the removed row's
    // out:slide transition takes Svelte's no-op fast path instead of calling element.animate().
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      addEventListener() {},
      removeEventListener() {},
    }));
    const wsApi = { ...ws };
    const wsWeb = { ...ws, id: 'perch-b', name: 'web', projectPath: '/home/u/workspace/web' };
    const store = fakeStore([wsApi, wsWeb]);
    render(WorkspaceList, { props: { store: store as never } });
    await fireEvent.click(screen.getByLabelText(/filter by project/i));
    const pill = screen.getByRole('checkbox', { name: /api/i });
    await fireEvent.click(pill);
    expect(store.setFolderFilter).toHaveBeenCalledWith(['/home/u/workspace/api']);
    vi.unstubAllGlobals();
  });

  it('announces a shared file generically, with a thumbnail for an image', () => {
    // jsdom implements neither half of the object-URL API.
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:preview');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const store = {
      ...fakeStore([ws]),
      pendingSharedFile: { name: 'photo.png', bytes: new Uint8Array([1, 2]) },
    };
    render(WorkspaceList, { props: { store: store as never } });
    expect(screen.getByTestId('shared-file-banner')).toHaveTextContent(
      '1 file ready — open a session to attach it',
    );
    expect(screen.getByAltText(/shared preview/i)).toBeInTheDocument();
    // The blob must carry the MIME, or the <img> has nothing to decode with.
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }));
    vi.unstubAllGlobals();
  });

  // A non-image blob in an <img> renders a broken-image icon, so the thumbnail must be
  // image-only now that any file type can be shared in.
  it('shows no thumbnail for a shared non-image file', () => {
    const store = {
      ...fakeStore([ws]),
      pendingSharedFile: { name: 'bundle.zip', bytes: new Uint8Array([0x50, 0x4b]) },
    };
    render(WorkspaceList, { props: { store: store as never } });
    expect(screen.getByTestId('shared-file-banner')).toBeInTheDocument();
    expect(screen.queryByAltText(/shared preview/i)).toBeNull();
  });
});

describe('WorkspaceList agent address', () => {
  it('shows the agent address so the user knows which session to contact', () => {
    render(WorkspaceList, { store: fakeStore([{ ...ws, agentAddress: 'perch-be' }]) as never });
    expect(screen.getByTestId('agent-address')).toHaveTextContent('perch-be');
  });

  // Absent for zsh/Codex workspaces, parked ones, and any version-skewed agent that does
  // not send the field — the row must simply not carry a badge.
  it('renders no badge when the workspace has no address', () => {
    render(WorkspaceList, { store: fakeStore([ws]) as never });
    expect(screen.queryByTestId('agent-address')).not.toBeInTheDocument();
  });

  // The address is only meaningful next to the machine it belongs to, so it must sit after
  // the machine pill rather than drifting to the other end of the row.
  it('places the address after the machine pill on the first line', () => {
    const store = fakeStore(
      [{ ...ws, agentAddress: 'perch-be' }],
      [
        { id: 'mac', name: 'Mac' },
        { id: 'ubuntu', name: 'Ubuntu' },
      ],
    );
    render(WorkspaceList, { store: store as never });
    const machine = screen.getByText('Mac');
    const address = screen.getByTestId('agent-address');
    expect(machine.compareDocumentPosition(address) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(address.parentElement).toBe(machine.parentElement);
  });
});
