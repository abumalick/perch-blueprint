import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FolderPicker from './FolderPicker.svelte';

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    browseError: null as string | null,
    dirEntries: { path: '/home/u/workspace', subdirs: ['/home/u/workspace/perch'], files: ['/home/u/workspace/README.md'] },
    pickerBrowse: vi.fn(),
    pickerMakeDir: vi.fn(),
    ...over,
  };
}

function props(store: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    store: store as never,
    roots: ['/home/u/workspace'],
    machineId: 'mac',
    onpick: vi.fn(),
    oncancel: vi.fn(),
    ...over,
  };
}

describe('FolderPicker (single root)', () => {
  it('shows a loading state until entries arrive', () => {
    render(FolderPicker, { props: props(fakeStore({ dirEntries: null })) });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders folders as buttons and descends on tap', async () => {
    const store = fakeStore();
    render(FolderPicker, { props: props(store) });
    await fireEvent.click(screen.getByRole('button', { name: 'perch' }));
    expect(store.pickerBrowse).toHaveBeenCalledWith('mac', '/home/u/workspace/perch');
  });

  it('does not list files (it is a folder picker)', () => {
    render(FolderPicker, { props: props(fakeStore()) });
    expect(screen.queryByText('README.md')).toBeNull();
  });

  it('hides the Up row at the single confinement root', () => {
    render(FolderPicker, { props: props(fakeStore()) });
    expect(screen.queryByRole('button', { name: /up one level/i })).not.toBeInTheDocument();
  });

  it('shows Up below the root and ascends on tap', async () => {
    const store = fakeStore({ dirEntries: { path: '/home/u/workspace/perch', subdirs: [], files: [] } });
    render(FolderPicker, { props: props(store) });
    await fireEvent.click(screen.getByRole('button', { name: /up one level/i }));
    expect(store.pickerBrowse).toHaveBeenCalledWith('mac', '/home/u/workspace');
  });

  it('picks the folder currently shown', async () => {
    const store = fakeStore({ dirEntries: { path: '/home/u/workspace/perch', subdirs: [], files: [] } });
    const onpick = vi.fn();
    render(FolderPicker, { props: props(store, { onpick }) });
    await fireEvent.click(screen.getByRole('button', { name: /use this folder/i }));
    expect(onpick).toHaveBeenCalledWith('/home/u/workspace/perch');
  });

  it('creates a folder in the current directory and (via the agent reply) browses into it', async () => {
    const store = fakeStore({ dirEntries: { path: '/home/u/workspace/perch', subdirs: [], files: [] } });
    render(FolderPicker, { props: props(store) });
    await fireEvent.click(screen.getByRole('button', { name: /new folder/i }));
    await fireEvent.input(screen.getByRole('textbox', { name: /folder name/i }), {
      target: { value: 'docs' },
    });
    await fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(store.pickerMakeDir).toHaveBeenCalledWith('mac', '/home/u/workspace/perch', 'docs');
  });

  it('disables Create and warns when the name matches an existing folder', async () => {
    // Default store: current dir has a `perch` subfolder and a `README.md` file.
    const store = fakeStore();
    render(FolderPicker, { props: props(store) });
    await fireEvent.click(screen.getByRole('button', { name: /new folder/i }));
    await fireEvent.input(screen.getByRole('textbox', { name: /folder name/i }), {
      target: { value: 'perch' },
    });
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
  });

  it('disables Create when the name matches an existing file', async () => {
    const store = fakeStore();
    render(FolderPicker, { props: props(store) });
    await fireEvent.click(screen.getByRole('button', { name: /new folder/i }));
    await fireEvent.input(screen.getByRole('textbox', { name: /folder name/i }), {
      target: { value: 'README.md' },
    });
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });

  it('disables Create for an invalid folder name', async () => {
    const store = fakeStore({ dirEntries: { path: '/home/u/workspace/perch', subdirs: [], files: [] } });
    render(FolderPicker, { props: props(store) });
    await fireEvent.click(screen.getByRole('button', { name: /new folder/i }));
    const create = screen.getByRole('button', { name: /^create$/i });
    expect(create).toBeDisabled();
    await fireEvent.input(screen.getByRole('textbox', { name: /folder name/i }), {
      target: { value: 'a/b' },
    });
    expect(create).toBeDisabled();
    await fireEvent.input(screen.getByRole('textbox', { name: /folder name/i }), {
      target: { value: 'ok' },
    });
    expect(create).not.toBeDisabled();
  });

  it('does not offer New folder at the multi-root list', () => {
    render(FolderPicker, {
      props: props(fakeStore({ dirEntries: null }), { roots: ['/home/u/workspace', '/srv/code'] }),
    });
    expect(screen.queryByRole('button', { name: /new folder/i })).not.toBeInTheDocument();
  });

  it('cancels back to the form when Back is tapped at the confinement root', async () => {
    const oncancel = vi.fn();
    render(FolderPicker, { props: props(fakeStore(), { oncancel }) });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(oncancel).toHaveBeenCalled();
  });

  it('ascends one level on Back from a subfolder instead of dismissing', async () => {
    const store = fakeStore({ dirEntries: { path: '/home/u/workspace/perch', subdirs: [], files: [] } });
    const oncancel = vi.fn();
    render(FolderPicker, { props: props(store, { oncancel }) });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(store.pickerBrowse).toHaveBeenCalledWith('mac', '/home/u/workspace');
    expect(oncancel).not.toHaveBeenCalled();
  });

  // A failed *initial* browse leaves dirEntries null: there is nothing to ascend to, and it is
  // exactly when the user most wants out — so Back must dismiss rather than sit dead.
  it('dismisses on Back when no entries have loaded', async () => {
    const oncancel = vi.fn();
    render(FolderPicker, {
      props: props(fakeStore({ dirEntries: null, browseError: 'nope' }), { oncancel }),
    });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(oncancel).toHaveBeenCalled();
  });

  it('offers an explicit Cancel that dismisses from any depth', async () => {
    const store = fakeStore({ dirEntries: { path: '/home/u/workspace/perch/src', subdirs: [], files: [] } });
    const oncancel = vi.fn();
    render(FolderPicker, { props: props(store, { oncancel }) });
    await fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(oncancel).toHaveBeenCalled();
    expect(store.pickerBrowse).not.toHaveBeenCalled();
  });

  it('shows an error state instead of loading when a browse fails', () => {
    render(FolderPicker, {
      props: props(fakeStore({ dirEntries: null, browseError: 'path outside allowed roots: /x' })),
    });
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't open this folder/i)).toBeInTheDocument();
  });

  it('disables Use this folder until entries arrive', () => {
    render(FolderPicker, { props: props(fakeStore({ dirEntries: null })) });
    expect(screen.getByRole('button', { name: /use this folder/i })).toBeDisabled();
  });
});

describe('FolderPicker (multiple roots)', () => {
  it('lists the roots and enters one on tap', async () => {
    const store = fakeStore({ dirEntries: null });
    render(FolderPicker, { props: props(store, { roots: ['/home/u/workspace', '/srv/code'] }) });
    expect(screen.getByRole('button', { name: '/home/u/workspace' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: '/srv/code' }));
    expect(store.pickerBrowse).toHaveBeenCalledWith('mac', '/srv/code');
  });

  it('does not offer Use this folder at the roots list', () => {
    render(FolderPicker, { props: props(fakeStore({ dirEntries: null }), { roots: ['/home/u/workspace', '/srv/code'] }) });
    expect(screen.queryByRole('button', { name: /use this folder/i })).not.toBeInTheDocument();
  });

  it('returns to the roots list when going Up from a root', async () => {
    const store = fakeStore({ dirEntries: { path: '/srv/code', subdirs: [], files: [] } });
    render(FolderPicker, { props: props(store, { roots: ['/home/u/workspace', '/srv/code'] }) });
    // Enter a root, then Up should land back on the roots list.
    await fireEvent.click(screen.getByRole('button', { name: '/srv/code' }));
    await fireEvent.click(screen.getByRole('button', { name: /up one level/i }));
    expect(screen.getByRole('button', { name: '/home/u/workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '/srv/code' })).toBeInTheDocument();
  });

  it('returns to the roots list on Back from a root', async () => {
    const store = fakeStore({ dirEntries: { path: '/srv/code', subdirs: [], files: [] } });
    const oncancel = vi.fn();
    render(FolderPicker, {
      props: props(store, { roots: ['/home/u/workspace', '/srv/code'], oncancel }),
    });
    await fireEvent.click(screen.getByRole('button', { name: '/srv/code' }));
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('button', { name: '/home/u/workspace' })).toBeInTheDocument();
    expect(oncancel).not.toHaveBeenCalled();
  });

  it('dismisses on Back from the roots list', async () => {
    const oncancel = vi.fn();
    render(FolderPicker, {
      props: props(fakeStore({ dirEntries: null }), {
        roots: ['/home/u/workspace', '/srv/code'],
        oncancel,
      }),
    });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(oncancel).toHaveBeenCalled();
  });
});
