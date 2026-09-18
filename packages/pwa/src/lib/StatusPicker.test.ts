import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import StatusPicker from './StatusPicker.svelte';

describe('StatusPicker', () => {
  it('shows the current status label and no menu until tapped', () => {
    render(StatusPicker, { props: { status: 'blocked', onSelect: vi.fn() } });
    expect(screen.getByRole('button', { name: /status: blocked/i })).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens a listbox of all 8 statuses in canonical order', async () => {
    render(StatusPicker, { props: { status: 'idle', onSelect: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: /status: idle/i }));
    const options = screen.getAllByRole('option').map((o) => o.textContent?.trim());
    expect(options).toEqual([
      '● Needs you',
      '● Needs hands',
      '● Idle',
      '● Finished',
      '● Parked',
      '● Blocked',
      '● Review',
      '● Working',
    ]);
  });

  it('calls onSelect with the chosen status and closes the menu', async () => {
    const onSelect = vi.fn();
    render(StatusPicker, { props: { status: 'idle', onSelect } });
    await fireEvent.click(screen.getByRole('button', { name: /status: idle/i }));
    await fireEvent.click(screen.getByRole('option', { name: /parked/i }));
    expect(onSelect).toHaveBeenCalledWith('parked');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
