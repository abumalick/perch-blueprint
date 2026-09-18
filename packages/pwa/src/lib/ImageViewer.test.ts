import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ImageViewer from './ImageViewer.svelte';

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    fileView: null as Record<string, unknown> | null,
    viewError: null as string | null,
    closeViewer: vi.fn(),
    ...over,
  };
}

const imageView = (over: Record<string, unknown> = {}) => ({
  path: '/p/logo.png',
  text: '',
  mediaType: 'image/png',
  blobUrl: 'blob:fake-object-url',
  truncated: false,
  binary: false,
  ...over,
});

describe('ImageViewer', () => {
  it('renders the image from blobUrl', () => {
    const { container } = render(ImageViewer, { props: { store: fakeStore({ fileView: imageView() }) as never } });
    expect(screen.getByText('logo.png')).toBeInTheDocument();
    const img = container.querySelector('.frame img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('blob:fake-object-url');
  });

  it('shows a too-large message and no image when the agent reported it over the cap', () => {
    const { container } = render(ImageViewer, {
      props: { store: fakeStore({ fileView: imageView({ blobUrl: '', truncated: true }) }) as never },
    });
    expect(screen.getByText(/too large/i)).toBeInTheDocument();
    expect(container.querySelector('.frame img')).toBeNull();
  });

  it('shows an error state when viewError is set', () => {
    render(ImageViewer, { props: { store: fakeStore({ viewError: 'denied' }) as never } });
    expect(screen.getByText(/couldn't open this file/i)).toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('returns to the browser on Back', async () => {
    const store = fakeStore({ fileView: imageView() });
    render(ImageViewer, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(store.closeViewer).toHaveBeenCalled();
  });
});
