import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FileBrowser from './FileBrowser.svelte';

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    browserRoot: '/home/u/proj',
    browseError: null as string | null,
    dirEntries: { path: '/home/u/proj', subdirs: ['/home/u/proj/src'], files: ['/home/u/proj/README.md'] },
    closeBrowser: vi.fn(),
    browseInto: vi.fn(),
    openFile: vi.fn(),
    ...over,
  };
}

describe('FileBrowser', () => {
  it('shows a loading state until entries arrive', () => {
    render(FileBrowser, { props: { store: fakeStore({ dirEntries: null }) as never } });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders folders as buttons and descends on tap', async () => {
    const store = fakeStore();
    render(FileBrowser, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: 'src' }));
    expect(store.browseInto).toHaveBeenCalledWith('/home/u/proj/src');
  });

  it('renders files as buttons and opens them on tap', async () => {
    const store = fakeStore();
    render(FileBrowser, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: 'README.md' }));
    expect(store.openFile).toHaveBeenCalledWith('/home/u/proj/README.md');
  });

  it('hides the Up row at the confinement root', () => {
    render(FileBrowser, { props: { store: fakeStore() as never } });
    expect(screen.queryByRole('button', { name: /up one level/i })).not.toBeInTheDocument();
  });

  it('shows Up below the root and ascends on tap', async () => {
    const store = fakeStore({
      dirEntries: { path: '/home/u/proj/src', subdirs: [], files: [] },
    });
    render(FileBrowser, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /up one level/i }));
    expect(store.browseInto).toHaveBeenCalledWith('/home/u/proj');
  });

  it('shows an error state instead of loading when a browse fails', () => {
    render(FileBrowser, {
      props: { store: fakeStore({ dirEntries: null, browseError: 'path outside allowed roots: /x' }) as never },
    });
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't open this folder/i)).toBeInTheDocument();
    expect(screen.getByText(/path outside allowed roots/i)).toBeInTheDocument();
  });

  it('returns to the terminal on Back at the confinement root', async () => {
    const store = fakeStore();
    render(FileBrowser, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(store.closeBrowser).toHaveBeenCalled();
  });

  it('ascends one level on Back from a subfolder instead of closing', async () => {
    const store = fakeStore({ dirEntries: { path: '/home/u/proj/src', subdirs: [], files: [] } });
    render(FileBrowser, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(store.browseInto).toHaveBeenCalledWith('/home/u/proj');
    expect(store.closeBrowser).not.toHaveBeenCalled();
  });

  // A failed *initial* browse leaves dirEntries null: nothing to ascend to, and it is exactly
  // when the user most wants out — so Back must close rather than sit dead.
  it('closes on Back when no entries have loaded', async () => {
    const store = fakeStore({ dirEntries: null, browseError: 'nope' });
    render(FileBrowser, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(store.closeBrowser).toHaveBeenCalled();
  });

  it('offers an explicit Close that returns to the terminal from any depth', async () => {
    const store = fakeStore({ dirEntries: { path: '/home/u/proj/src/core', subdirs: [], files: [] } });
    render(FileBrowser, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(store.closeBrowser).toHaveBeenCalled();
    expect(store.browseInto).not.toHaveBeenCalled();
  });
});
