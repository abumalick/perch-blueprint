import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CreateWorkspace from './CreateWorkspace.svelte';

function fakeStore(lastMachineId: string | null = null, over: Record<string, unknown> = {}) {
  return {
    machines: [
      { id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' },
      { id: 'pc', name: 'PC', url: 'wss://pc', token: 't' },
    ],
    statuses: { mac: 'online', pc: 'online' } as Record<string, string>,
    recentPaths: {
      mac: ['/home/u/workspace/api'],
      pc: ['/home/u/projects/web'],
    },
    machineRoots: {} as Record<string, string[]>,
    lastMachineId,
    requestCreate: vi.fn(),
    back: vi.fn(),
    ...over,
  };
}

function fakeStoreWithDefault(over: Record<string, unknown> = {}) {
  return {
    machines: [{ id: 'box', name: 'Box', url: 'wss://box', token: 't', defaultPath: '/home/u/workspace' }],
    statuses: { box: 'online' } as Record<string, string>,
    recentPaths: { box: [] as string[] },
    // The agent's reported roots that drive the Browse picker.
    machineRoots: { box: ['/home/u/workspace'] } as Record<string, string[]>,
    lastMachineId: 'box',
    requestCreate: vi.fn(),
    back: vi.fn(),
    // Folder-picker plumbing, exercised only when the Browse picker is opened.
    openFolderPicker: vi.fn(),
    closeFolderPicker: vi.fn(),
    pickerBrowse: vi.fn(),
    dirEntries: null as { path: string; subdirs: string[]; files: string[] } | null,
    browseError: null as string | null,
    ...over,
  };
}

function fakeStoreNoRoots() {
  return {
    machines: [{ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' }],
    statuses: { mac: 'online' } as Record<string, string>,
    recentPaths: { mac: [] as string[] },
    machineRoots: {} as Record<string, string[]>,
    lastMachineId: 'mac',
    requestCreate: vi.fn(),
    back: vi.fn(),
    openFolderPicker: vi.fn(),
    closeFolderPicker: vi.fn(),
    pickerBrowse: vi.fn(),
    dirEntries: null as { path: string; subdirs: string[]; files: string[] } | null,
    browseError: null as string | null,
  };
}

function fakeStoreWithDefaultAndRecents() {
  return {
    machines: [{ id: 'box', name: 'Box', url: 'wss://box', token: 't', defaultPath: '/home/u/workspace' }],
    statuses: { box: 'online' } as Record<string, string>,
    recentPaths: { box: ['/home/u/workspace/scratch', '/other/place'] },
    machineRoots: {} as Record<string, string[]>,
    lastMachineId: 'box',
    requestCreate: vi.fn(),
    back: vi.fn(),
  };
}

const create = () => screen.getByRole('button', { name: /^create$/i });

describe('CreateWorkspace', () => {
  it('creates a workspace from a recent path with the default command', async () => {
    const store = fakeStore();
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: '/home/u/workspace/api' }));
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenCalledWith('mac', '/home/u/workspace/api', "claude --model 'opus[1m]'");
  });

  it('shows the create error inline when the agent rejects the path', () => {
    const store = { ...fakeStore(), createError: 'directory does not exist: /home/u/nope' };
    render(CreateWorkspace, { props: { store: store as never } });
    expect(screen.getByText(/directory does not exist: \/home\/u\/nope/)).toBeTruthy();
  });

  it('shows recent paths for the selected machine', async () => {
    const store = fakeStore();
    render(CreateWorkspace, { props: { store: store as never } });

    expect(screen.getByRole('button', { name: '/home/u/workspace/api' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '/home/u/projects/web' })).toBeNull();

    await fireEvent.click(screen.getByRole('radio', { name: 'PC' }));

    expect(screen.getByRole('button', { name: '/home/u/projects/web' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '/home/u/workspace/api' })).toBeNull();
  });

  it('preselects the last used machine and its most-recent path', async () => {
    const store = fakeStore('pc');
    render(CreateWorkspace, { props: { store: store as never } });
    expect((screen.getByRole('radio', { name: 'PC' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByPlaceholderText('/home/u/workspace/project') as HTMLInputElement).value).toBe(
      '/home/u/projects/web',
    );
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenCalledWith('pc', '/home/u/projects/web', "claude --model 'opus[1m]'");
  });

  it('defaults to the first machine and its recent path when none was used before', () => {
    const store = fakeStore(null);
    render(CreateWorkspace, { props: { store: store as never } });
    expect((screen.getByRole('radio', { name: 'Mac' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByPlaceholderText('/home/u/workspace/project') as HTMLInputElement).value).toBe(
      '/home/u/workspace/api',
    );
  });

  it('orders machine pills alphabetically regardless of config order, ignoring last-used for ordering', () => {
    const store = fakeStore(null, {
      machines: [
        { id: 'zeta', name: 'Zeta', url: 'wss://zeta', token: 't' },
        { id: 'alpha', name: 'Alpha', url: 'wss://alpha', token: 't' },
      ],
      statuses: { zeta: 'online', alpha: 'online' },
      recentPaths: {},
    });
    render(CreateWorkspace, { props: { store: store as never } });
    const radios = screen.getAllByRole('radio', { name: /Zeta|Alpha/ });
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['alpha', 'zeta']);
    // No last-used machine: falls back to the alphabetically-first connected one.
    expect((screen.getByRole('radio', { name: 'Alpha' }) as HTMLInputElement).checked).toBe(true);
  });

  it('excludes offline and disabled machines from the pills', () => {
    const store = fakeStore(null, {
      machines: [
        { id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' },
        { id: 'pc', name: 'PC', url: 'wss://pc', token: 't', enabled: false },
        { id: 'other', name: 'Other', url: 'wss://other', token: 't' },
      ],
      statuses: { mac: 'online', pc: 'online', other: 'offline' },
      recentPaths: {},
    });
    render(CreateWorkspace, { props: { store: store as never } });
    expect(screen.getByRole('radio', { name: 'Mac' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'PC' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Other' })).toBeNull();
  });

  it('falls back to the alphabetically-first connected machine when the last-used one is not connected', () => {
    const store = fakeStore('pc', {
      machines: [
        { id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' },
        { id: 'pc', name: 'PC', url: 'wss://pc', token: 't' },
      ],
      statuses: { mac: 'online', pc: 'offline' },
      recentPaths: {},
    });
    render(CreateWorkspace, { props: { store: store as never } });
    expect(screen.queryByRole('radio', { name: 'PC' })).toBeNull();
    expect((screen.getByRole('radio', { name: 'Mac' }) as HTMLInputElement).checked).toBe(true);
  });

  it('still shows the picker with exactly one connected machine', () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    expect((screen.getByRole('radio', { name: 'Box' }) as HTMLInputElement).checked).toBe(true);
  });

  it('shows a message and disables Create when no machine is connected', () => {
    const store = fakeStore(null, { statuses: { mac: 'offline', pc: 'offline' } });
    render(CreateWorkspace, { props: { store: store as never } });
    expect(screen.queryByRole('radio', { name: 'Mac' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'PC' })).toBeNull();
    expect(screen.getByText(/no connected machines/i)).toBeTruthy();
    expect(create()).toBeDisabled();
  });

  it('resolves a relative path against the machine default path', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.input(screen.getByTestId('path'), { target: { value: 'perch' } });
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenCalledWith('box', '/home/u/workspace/perch', "claude --model 'opus[1m]'");
  });

  it('still accepts an absolute path as an escape hatch when a default is set', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.input(screen.getByTestId('path'), { target: { value: '/elsewhere/repo' } });
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenCalledWith('box', '/elsewhere/repo', "claude --model 'opus[1m]'");
  });

  it('previews the resolved absolute path and labels the field relative to the default', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    expect(screen.getByText(/relative to \/home\/u\/workspace/)).toBeInTheDocument();
    await fireEvent.input(screen.getByTestId('path'), { target: { value: 'perch' } });
    expect(screen.getByTestId('resolved-preview')).toHaveTextContent('/home/u/workspace/perch');
  });

  it('opens the default root when the path is left empty', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenCalledWith('box', '/home/u/workspace', "claude --model 'opus[1m]'");
  });

  it('shows no resolved preview when the machine has no default path', () => {
    const store = fakeStore();
    render(CreateWorkspace, { props: { store: store as never } });
    expect(screen.queryByTestId('resolved-preview')).toBeNull();
  });

  it('displays recent paths relative to the default, but sends the full absolute path', async () => {
    const store = fakeStoreWithDefaultAndRecents();
    render(CreateWorkspace, { props: { store: store as never } });

    // a child of the default is shown relative; a path outside it stays full
    expect(screen.getByRole('button', { name: 'scratch' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '/other/place' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '/home/u/workspace/scratch' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'scratch' }));
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenCalledWith('box', '/home/u/workspace/scratch', "claude --model 'opus[1m]'");
  });

  it('opens the picker and browses the machine single root', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    expect(store.openFolderPicker).toHaveBeenCalled();
    expect(store.pickerBrowse).toHaveBeenCalledWith('box', '/home/u/workspace');
  });

  it('fills the path relative to the default when a folder is picked', async () => {
    const store = fakeStoreWithDefault({ dirEntries: { path: '/home/u/workspace/perch', subdirs: [], files: [] } });
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    await fireEvent.click(screen.getByRole('button', { name: /use this folder/i }));
    // Back on the form: the input now holds the picked folder relative to the default.
    const pathInput = screen.getByTestId('path') as HTMLInputElement;
    expect(pathInput.value).toBe('perch');
    expect(screen.getByTestId('resolved-preview')).toHaveTextContent('/home/u/workspace/perch');
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenCalledWith('box', '/home/u/workspace/perch', "claude --model 'opus[1m]'");
  });

  it('fills an absolute path when the picked folder is outside the default', async () => {
    const store = fakeStoreWithDefault({
      machineRoots: { box: ['/home/u/workspace', '/srv/code'] },
      dirEntries: { path: '/srv/code', subdirs: [], files: [] },
    });
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    // Several roots → roots list; enter the one outside the default, then pick it.
    await fireEvent.click(screen.getByRole('button', { name: '/srv/code' }));
    await fireEvent.click(screen.getByRole('button', { name: /use this folder/i }));
    expect((screen.getByTestId('path') as HTMLInputElement).value).toBe('/srv/code');
  });

  it('disables Browse when the machine reports no roots', () => {
    const store = fakeStoreNoRoots();
    render(CreateWorkspace, { props: { store: store as never } });
    expect(screen.getByRole('button', { name: /browse/i })).toBeDisabled();
  });

  it('refills the path with the new machine recent when switching, until edited', async () => {
    const store = fakeStore('mac');
    render(CreateWorkspace, { props: { store: store as never } });
    const pathInput = screen.getByPlaceholderText('/home/u/workspace/project') as HTMLInputElement;
    expect(pathInput.value).toBe('/home/u/workspace/api');

    await fireEvent.click(screen.getByRole('radio', { name: 'PC' }));
    expect(pathInput.value).toBe('/home/u/projects/web');

    // once the user types a path, switching machine no longer overrides it
    await fireEvent.input(pathInput, { target: { value: '/custom/path' } });
    await fireEvent.click(screen.getByRole('radio', { name: 'Mac' }));
    expect(pathInput.value).toBe('/custom/path');
  });

  // --- command & model radios ---

  it('defaults to Claude + Opus and sends the quoted model flag', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    expect((screen.getByRole('radio', { name: 'Claude' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Opus' }) as HTMLInputElement).checked).toBe(true);
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenCalledWith('box', '/home/u/workspace', "claude --model 'opus[1m]'");
  });

  it('sends the chosen Claude model', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('radio', { name: 'Sonnet' }));
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenCalledWith('box', '/home/u/workspace', "claude --model 'sonnet[1m]'");
  });

  it('runs Codex with its default model, then the chosen one', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('radio', { name: 'Codex' }));
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenLastCalledWith('box', '/home/u/workspace', "codex --model 'gpt-5.3-codex'");
    await fireEvent.click(screen.getByRole('radio', { name: 'gpt-5.5' }));
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenLastCalledWith('box', '/home/u/workspace', "codex --model 'gpt-5.5'");
  });

  it('offers the lighter Codex models', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('radio', { name: 'Codex' }));
    await fireEvent.click(screen.getByRole('radio', { name: 'gpt-5.1-codex-mini' }));
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenLastCalledWith('box', '/home/u/workspace', "codex --model 'gpt-5.1-codex-mini'");
    await fireEvent.click(screen.getByRole('radio', { name: 'gpt-5.4-mini' }));
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenLastCalledWith('box', '/home/u/workspace', "codex --model 'gpt-5.4-mini'");
  });

  it('runs ZSH with no model flag and shows no model options', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('radio', { name: 'ZSH' }));
    expect(screen.queryByRole('radio', { name: 'Opus' })).toBeNull();
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenCalledWith('box', '/home/u/workspace', 'zsh');
  });

  it('resets the model back to Opus when switching command away and back', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('radio', { name: 'Sonnet' }));
    await fireEvent.click(screen.getByRole('radio', { name: 'Codex' }));
    await fireEvent.click(screen.getByRole('radio', { name: 'Claude' }));
    expect((screen.getByRole('radio', { name: 'Opus' }) as HTMLInputElement).checked).toBe(true);
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenLastCalledWith('box', '/home/u/workspace', "claude --model 'opus[1m]'");
  });

  it('always opens at Claude + Opus, ignoring any remembered command', () => {
    const store = fakeStoreWithDefault({ lastCommand: 'codex' });
    render(CreateWorkspace, { props: { store: store as never } });
    expect((screen.getByRole('radio', { name: 'Claude' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Opus' }) as HTMLInputElement).checked).toBe(true);
  });

  it('reveals a custom command field (hidden by default) and sends the trimmed typed value', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    expect(screen.queryByTestId('custom-command')).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: /custom/i }));
    await fireEvent.input(screen.getByTestId('custom-command'), { target: { value: '  claude --resume  ' } });
    await fireEvent.click(create());
    expect(store.requestCreate).toHaveBeenCalledWith('box', '/home/u/workspace', 'claude --resume');
  });

  it('does not create when Custom is selected but the command is empty', async () => {
    const store = fakeStoreWithDefault();
    render(CreateWorkspace, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('radio', { name: /custom/i }));
    await fireEvent.click(create());
    expect(store.requestCreate).not.toHaveBeenCalled();
  });
});
