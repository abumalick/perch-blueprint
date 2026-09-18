import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import BrowserPicker from './BrowserPicker.svelte';

const noop = () => undefined;

describe('BrowserPicker', () => {
  it('renders nothing when there are no sessions and starting is unavailable', () => {
    const { container } = render(BrowserPicker, {
      props: { sessions: [], workspaceId: 'ws1', canStart: false, onOpen: noop, onStart: noop },
    });
    expect(container.querySelector('button')).toBeNull();
  });

  it('offers Start browser when there are no sessions but the agent supports it', async () => {
    const onStart = vi.fn();
    render(BrowserPicker, {
      props: { sessions: [], workspaceId: 'ws1', canStart: true, onOpen: noop, onStart },
    });
    await fireEvent.click(screen.getByRole('button', { name: /start browser/i }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('opens the single session directly without a menu', async () => {
    const onOpen = vi.fn();
    render(BrowserPicker, {
      props: { sessions: ['ws1__login'], workspaceId: 'ws1', canStart: false, onOpen, onStart: noop },
    });
    await fireEvent.click(screen.getByRole('button', { name: /browser/i }));
    expect(onOpen).toHaveBeenCalledWith('ws1__login');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('drops a menu of the sessions when there are several, and opens the chosen one', async () => {
    const onOpen = vi.fn();
    render(BrowserPicker, {
      props: { sessions: ['ws1', 'ws1__login'], workspaceId: 'ws1', canStart: false, onOpen, onStart: noop },
    });
    // The trigger does not open a session directly; it drops the menu.
    await fireEvent.click(screen.getByRole('button', { name: /browser/i }));
    expect(onOpen).not.toHaveBeenCalled();
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent?.trim());
    expect(items).toEqual(['🌐 main', '🌐 login']);
    await fireEvent.click(screen.getByRole('menuitem', { name: /login/i }));
    expect(onOpen).toHaveBeenCalledWith('ws1__login');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
