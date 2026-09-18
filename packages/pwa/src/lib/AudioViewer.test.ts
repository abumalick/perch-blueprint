import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import AudioViewer from './AudioViewer.svelte';

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    fileView: null as Record<string, unknown> | null,
    viewError: null as string | null,
    audioPosition: null as { index: number; count: number } | null,
    closeViewer: vi.fn(),
    showAudioNeighbor: vi.fn(),
    ...over,
  };
}

const audioView = (over: Record<string, unknown> = {}) => ({
  path: '/p/clip.mp3',
  text: '',
  mediaType: 'audio/mpeg',
  blobUrl: 'blob:fake-object-url',
  truncated: false,
  binary: false,
  ...over,
});

describe('AudioViewer', () => {
  it('renders an audio player from blobUrl', () => {
    const { container } = render(AudioViewer, { props: { store: fakeStore({ fileView: audioView() }) as never } });
    expect(screen.getByText('clip.mp3')).toBeInTheDocument();
    const audio = container.querySelector('audio') as HTMLAudioElement | null;
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute('src')).toBe('blob:fake-object-url');
    expect(audio?.hasAttribute('controls')).toBe(true);
  });

  it('shows a too-large message and no player when over the cap', () => {
    const { container } = render(AudioViewer, {
      props: { store: fakeStore({ fileView: audioView({ blobUrl: '', truncated: true }) }) as never },
    });
    expect(screen.getByText(/too large/i)).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeNull();
  });

  it('keeps the player mounted but with no src attribute while the bytes are in flight', () => {
    const { container } = render(AudioViewer, {
      props: { store: fakeStore({ fileView: audioView({ blobUrl: '' }) }) as never },
    });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    // The element persists across tracks (iOS keeps the play activation), but its src must be
    // absent — not "" — while loading: an empty src makes WebKit render the player's error icon.
    const audio = container.querySelector('audio') as HTMLAudioElement | null;
    expect(audio).not.toBeNull();
    expect(audio?.hasAttribute('src')).toBe(false);
  });

  it('shows an error state when viewError is set', () => {
    render(AudioViewer, { props: { store: fakeStore({ viewError: 'denied' }) as never } });
    expect(screen.getByText(/couldn't open this file/i)).toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('returns to the browser on Back', async () => {
    const store = fakeStore({ fileView: audioView() });
    render(AudioViewer, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(store.closeViewer).toHaveBeenCalled();
  });

  it('shows prev/next controls and a counter when the folder has more than one audio file', async () => {
    const store = fakeStore({ fileView: audioView(), audioPosition: { index: 2, count: 3 } });
    render(AudioViewer, { props: { store: store as never } });
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(store.showAudioNeighbor).toHaveBeenCalledWith(1);
    await fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(store.showAudioNeighbor).toHaveBeenCalledWith(-1);
  });

  it('hides the nav controls when the folder has a single audio file', () => {
    const store = fakeStore({ fileView: audioView(), audioPosition: { index: 1, count: 1 } });
    render(AudioViewer, { props: { store: store as never } });
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /previous/i })).toBeNull();
  });

  it('disables Previous on the first track and Next on the last', () => {
    const first = fakeStore({ fileView: audioView(), audioPosition: { index: 1, count: 3 } });
    const { unmount } = render(AudioViewer, { props: { store: first as never } });
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
    unmount();

    const last = fakeStore({ fileView: audioView(), audioPosition: { index: 3, count: 3 } });
    render(AudioViewer, { props: { store: last as never } });
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /previous/i })).not.toBeDisabled();
  });

  it('auto-advances to the next track when the current one ends', async () => {
    const store = fakeStore({ fileView: audioView(), audioPosition: { index: 1, count: 3 } });
    const { container } = render(AudioViewer, { props: { store: store as never } });
    const audio = container.querySelector('audio') as HTMLAudioElement;
    await fireEvent.ended(audio);
    expect(store.showAudioNeighbor).toHaveBeenCalledWith(1);
  });
});
