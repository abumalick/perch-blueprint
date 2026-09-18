import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CommandPicker from './CommandPicker.svelte';

const commands = [
  { command: '/myplugin:task', submit: false },
  { command: '/rename', submit: true },
];

describe('CommandPicker', () => {
  it('shows the trigger and no menu until tapped', () => {
    render(CommandPicker, { props: { commands, onSelect: vi.fn() } });
    expect(screen.getByRole('button', { name: /commands/i })).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  // Raw command text, in file order — what you see is what gets typed.
  it('lists the commands verbatim in file order', async () => {
    render(CommandPicker, { props: { commands, onSelect: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: /commands/i }));
    expect(screen.getAllByRole('option').map((o) => o.textContent?.trim())).toEqual([
      '/myplugin:task',
      '/rename',
    ]);
  });

  it('calls onSelect with the chosen entry and closes the menu', async () => {
    const onSelect = vi.fn();
    render(CommandPicker, { props: { commands, onSelect } });
    await fireEvent.click(screen.getByRole('button', { name: /commands/i }));
    await fireEvent.click(screen.getByRole('option', { name: '/rename' }));
    expect(onSelect).toHaveBeenCalledWith({ command: '/rename', submit: true });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape', async () => {
    render(CommandPicker, { props: { commands, onSelect: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: /commands/i }));
    expect(screen.queryByRole('listbox')).toBeTruthy();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on an outside tap', async () => {
    render(CommandPicker, { props: { commands, onSelect: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: /commands/i }));
    await fireEvent.click(screen.getByRole('button', { name: /close command menu/i }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  // The soft keyboard closes if a tap moves focus off the terminal textarea, so both the
  // trigger and the option rows must preventDefault on pointerdown. jsdom has no
  // PointerEvent, hence the hand-rolled cancelable MouseEvent (as in BrowserView.test.ts).
  it('does not steal focus from the terminal', async () => {
    render(CommandPicker, { props: { commands, onSelect: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: /commands/i }));
    for (const node of [
      screen.getByRole('button', { name: /commands/i }),
      screen.getByRole('option', { name: '/rename' }),
    ]) {
      const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });
});
