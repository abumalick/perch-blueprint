import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import DictationErrorBanner from './DictationErrorBanner.svelte';

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    dictationState: 'idle',
    dictationError: null,
    toggleDictation: vi.fn(),
    dismissDictationError: vi.fn(),
    ...over,
  };
}

describe('DictationErrorBanner', () => {
  it('renders nothing when dictation is not in error', () => {
    render(DictationErrorBanner, { props: { store: fakeStore({ dictationState: 'transcribing' }) as never } });
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('shows the error message when in error', () => {
    render(DictationErrorBanner, {
      props: { store: fakeStore({ dictationState: 'error', dictationError: 'ElevenLabs quota exceeded' }) as never },
    });
    expect(screen.getByText(/quota exceeded/i)).toBeInTheDocument();
  });

  it('falls back to a generic message when no error text is set', () => {
    render(DictationErrorBanner, { props: { store: fakeStore({ dictationState: 'error', dictationError: null }) as never } });
    expect(screen.getByText(/dictation failed/i)).toBeInTheDocument();
  });

  it('retries the dictation on Retry', async () => {
    const store = fakeStore({ dictationState: 'error', dictationError: 'Dictation timed out — try again' });
    render(DictationErrorBanner, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(store.toggleDictation).toHaveBeenCalled();
  });

  it('dismisses on the close button', async () => {
    const store = fakeStore({ dictationState: 'error', dictationError: 'Invalid ElevenLabs key' });
    render(DictationErrorBanner, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(store.dismissDictationError).toHaveBeenCalled();
  });
});
