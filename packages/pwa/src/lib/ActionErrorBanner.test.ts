import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ActionErrorBanner from './ActionErrorBanner.svelte';

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    actionError: null,
    dismissActionError: vi.fn(),
    ...over,
  };
}

describe('ActionErrorBanner', () => {
  it('renders nothing when there is no action error', () => {
    render(ActionErrorBanner, { props: { store: fakeStore() as never } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the agent error message', () => {
    render(ActionErrorBanner, {
      props: { store: fakeStore({ actionError: 'cannot park: no Claude session to resume' }) as never },
    });
    expect(screen.getByText(/no Claude session to resume/i)).toBeInTheDocument();
  });

  it('dismisses on the close button', async () => {
    const store = fakeStore({ actionError: 'boom' });
    render(ActionErrorBanner, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(store.dismissActionError).toHaveBeenCalled();
  });
});
