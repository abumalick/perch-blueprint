import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FileViewer from './FileViewer.svelte';

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    fileView: null as Record<string, unknown> | null,
    viewError: null as string | null,
    fileWrap: false,
    closeViewer: vi.fn(),
    setFileWrap: vi.fn(),
    ...over,
  };
}

describe('FileViewer', () => {
  it('shows the filename and contents with a line-number gutter', () => {
    const { container } = render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/a.txt', text: 'one\ntwo\nthree', truncated: false, binary: false } }) as never },
    });
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(container.querySelector('.content')?.textContent).toBe('one\ntwo\nthree');
    expect(container.querySelector('.gutter')?.textContent).toBe('1\n2\n3');
  });

  it('shows a truncated banner', () => {
    render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/a.txt', text: 'x', truncated: true, binary: false } }) as never },
    });
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });

  it('shows a binary notice instead of content', () => {
    const { container } = render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/blob.bin', text: '', truncated: false, binary: true } }) as never },
    });
    expect(screen.getByText(/binary file/i)).toBeInTheDocument();
    expect(container.querySelector('.content')).toBeNull();
  });

  it('shows an error state when viewError is set', () => {
    render(FileViewer, { props: { store: fakeStore({ viewError: 'denied' }) as never } });
    expect(screen.getByText(/couldn't open this file/i)).toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('reflects a wrapped preference: hides the gutter and presses the button', () => {
    const { container } = render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/a.txt', text: 'a\nb', truncated: false, binary: false }, fileWrap: true }) as never },
    });
    const btn = screen.getByRole('button', { name: /word wrap/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.gutter')).toBeNull();
    expect(container.querySelector('.code.wrap')).not.toBeNull();
  });

  it('shows the gutter when wrap is off', () => {
    const { container } = render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/a.txt', text: 'a\nb', truncated: false, binary: false }, fileWrap: false }) as never },
    });
    expect(screen.getByRole('button', { name: /word wrap/i })).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('.gutter')).not.toBeNull();
    expect(container.querySelector('.code.wrap')).toBeNull();
  });

  it('persists a wrap toggle through the store', async () => {
    const setFileWrap = vi.fn();
    render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/a.txt', text: 'a\nb', truncated: false, binary: false }, fileWrap: false, setFileWrap }) as never },
    });
    await fireEvent.click(screen.getByRole('button', { name: /word wrap/i }));
    expect(setFileWrap).toHaveBeenCalledWith(true);
  });

  it('does not show the wrap toggle for a binary file', () => {
    render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/blob.bin', text: '', truncated: false, binary: true } }) as never },
    });
    expect(screen.queryByRole('button', { name: /word wrap/i })).toBeNull();
  });

  it('renders a markdown file as formatted HTML', () => {
    const { container } = render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/README.md', text: '# Title\n\nhello', truncated: false, binary: false } }) as never },
    });
    expect(container.querySelector('.prose h1')?.textContent).toBe('Title');
    expect(container.querySelector('.content')).toBeNull();
  });

  it('offers a raw toggle on markdown that swaps in the source text', async () => {
    const { container } = render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/README.md', text: '# Title', truncated: false, binary: false } }) as never },
    });
    await fireEvent.click(screen.getByRole('button', { name: /raw/i }));
    expect(container.querySelector('.prose')).toBeNull();
    expect(container.querySelector('.content')?.textContent).toBe('# Title');
  });

  it('hides the wrap toggle while markdown is rendered', () => {
    render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/README.md', text: '# Title', truncated: false, binary: false } }) as never },
    });
    expect(screen.queryByRole('button', { name: /word wrap/i })).toBeNull();
  });

  it('does not offer a raw toggle for a non-markdown file', () => {
    render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/a.txt', text: 'x', truncated: false, binary: false } }) as never },
    });
    expect(screen.queryByRole('button', { name: /raw/i })).toBeNull();
  });

  it('goes back to rendered when another markdown file is opened', async () => {
    const { container, rerender } = render(FileViewer, {
      props: { store: fakeStore({ fileView: { path: '/p/a.md', text: '# A', truncated: false, binary: false } }) as never },
    });
    await fireEvent.click(screen.getByRole('button', { name: /raw/i }));
    expect(container.querySelector('.content')).not.toBeNull();

    await rerender({ store: fakeStore({ fileView: { path: '/p/b.md', text: '# B', truncated: false, binary: false } }) as never });
    expect(container.querySelector('.prose h1')?.textContent).toBe('B');
  });

  it('returns to the browser on Back', async () => {
    const store = fakeStore({ fileView: { path: '/p/a.txt', text: 'x', truncated: false, binary: false } });
    render(FileViewer, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(store.closeViewer).toHaveBeenCalled();
  });
});
