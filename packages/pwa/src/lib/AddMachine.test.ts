import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import AddMachine from './AddMachine.svelte';

function fakeStore(overrides: Record<string, unknown> = {}) {
  return {
    addMachine: vi.fn(),
    goSettings: vi.fn(),
    ...overrides,
  };
}

describe('AddMachine', () => {
  it('adds a machine from the form and returns to settings', async () => {
    const store = fakeStore();
    render(AddMachine, { props: { store: store as never } });
    await fireEvent.input(screen.getByLabelText(/name/i), { target: { value: 'Mini PC' } });
    await fireEvent.input(screen.getByLabelText(/url/i), { target: { value: 'wss://mini' } });
    await fireEvent.input(screen.getByLabelText(/token/i), { target: { value: 'sek' } });
    await fireEvent.click(screen.getByRole('button', { name: /add machine/i }));
    expect(store.addMachine).toHaveBeenCalledWith({ id: 'mini-pc', name: 'Mini PC', url: 'wss://mini', token: 'sek' });
    expect(store.goSettings).toHaveBeenCalled();
  });

  it('adds a machine with an optional default path', async () => {
    const store = fakeStore();
    render(AddMachine, { props: { store: store as never } });
    await fireEvent.input(screen.getByLabelText(/name/i), { target: { value: 'Mini PC' } });
    await fireEvent.input(screen.getByLabelText(/url/i), { target: { value: 'wss://mini' } });
    await fireEvent.input(screen.getByLabelText(/token/i), { target: { value: 'sek' } });
    await fireEvent.input(screen.getByLabelText(/default path/i), { target: { value: '/home/u/ws' } });
    await fireEvent.click(screen.getByRole('button', { name: /add machine/i }));
    expect(store.addMachine).toHaveBeenCalledWith({
      id: 'mini-pc',
      name: 'Mini PC',
      url: 'wss://mini',
      token: 'sek',
      defaultPath: '/home/u/ws',
    });
  });

  it('does not add a machine when a required field is missing', async () => {
    const store = fakeStore();
    render(AddMachine, { props: { store: store as never } });
    await fireEvent.input(screen.getByLabelText(/name/i), { target: { value: 'Mini PC' } });
    await fireEvent.click(screen.getByRole('button', { name: /add machine/i }));
    expect(store.addMachine).not.toHaveBeenCalled();
    expect(store.goSettings).not.toHaveBeenCalled();
  });

  it('returns to settings via the back button without adding', async () => {
    const store = fakeStore();
    render(AddMachine, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(store.goSettings).toHaveBeenCalled();
    expect(store.addMachine).not.toHaveBeenCalled();
  });
});
