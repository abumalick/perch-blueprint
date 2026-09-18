import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import UpdateBanner from './UpdateBanner.svelte';

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    updateReady: false,
    incomingBuildLabel: null,
    applyUpdate: vi.fn(),
    dismissUpdate: vi.fn(),
    ...over,
  };
}

describe('UpdateBanner', () => {
  it('renders nothing when no update is pending', () => {
    render(UpdateBanner, { props: { store: fakeStore() as never } });
    expect(screen.queryByRole('button', { name: /reload/i })).not.toBeInTheDocument();
  });

  it('names the incoming worktree build', () => {
    render(UpdateBanner, { props: { store: fakeStore({ updateReady: true, incomingBuildLabel: 'feat-x' }) as never } });
    expect(screen.getByText(/feat-x/)).toBeInTheDocument();
  });

  it('shows a generic message for a main build', () => {
    render(UpdateBanner, { props: { store: fakeStore({ updateReady: true, incomingBuildLabel: 'main' }) as never } });
    expect(screen.getByText(/new version available/i)).toBeInTheDocument();
    expect(screen.queryByText('main')).not.toBeInTheDocument();
  });

  it('shows a generic message when the label is unknown', () => {
    render(UpdateBanner, { props: { store: fakeStore({ updateReady: true, incomingBuildLabel: null }) as never } });
    expect(screen.getByText(/new version available/i)).toBeInTheDocument();
  });

  it('applies the update on Reload', async () => {
    const store = fakeStore({ updateReady: true, incomingBuildLabel: 'feat-x' });
    render(UpdateBanner, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(store.applyUpdate).toHaveBeenCalled();
  });

  it('dismisses on the close button', async () => {
    const store = fakeStore({ updateReady: true, incomingBuildLabel: 'feat-x' });
    render(UpdateBanner, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(store.dismissUpdate).toHaveBeenCalled();
  });
});
