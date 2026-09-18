import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Settings from './Settings.svelte';
import { inputLog } from '../core/terminal-input-log';

function fakeStore(overrides: Record<string, unknown> = {}) {
  return {
    machines: [{ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' }],
    statuses: {} as Record<string, string>,
    lastConnectionError: {} as Record<string, { message: string; code?: number; at: number }>,
    addMachine: vi.fn(),
    updateMachine: vi.fn(),
    removeMachine: vi.fn(),
    reconnectMachine: vi.fn(),
    toggleMachine: vi.fn(),
    back: vi.fn(),
    goNewMachine: vi.fn(),
    elevenLabsApiKey: '',
    setElevenLabsApiKey: vi.fn(),
    ...overrides,
  };
}

describe('Settings', () => {
  it('lists machines and removes one', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    expect(screen.getByText('Mac')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(store.removeMachine).toHaveBeenCalledWith('mac');
  });

  it('shows a live viewport readout under diagnostics', () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    expect(screen.getByTestId('viewport')).toHaveTextContent(/Viewport:\s*\d+\s*×\s*\d+\s*·\s*DPR/);
  });

  it('opens the add-machine screen via the + Add machine button', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /add machine/i }));
    expect(store.goNewMachine).toHaveBeenCalled();
  });

  it('pre-fills the edit form with the current default path', async () => {
    const store = fakeStore({
      machines: [{ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't', defaultPath: '/home/u/ws' }],
    });
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect((screen.getByTestId('edit-default-path') as HTMLInputElement).value).toBe('/home/u/ws');
  });

  it('saves an edited default path', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await fireEvent.input(screen.getByTestId('edit-default-path'), { target: { value: '/new/root' } });
    await fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(store.updateMachine).toHaveBeenCalledWith('mac', {
      url: 'wss://mac',
      token: undefined,
      defaultPath: '/new/root',
    });
  });

  it('reveals an edit form pre-filled with the current url and an empty token', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect((screen.getByTestId('edit-url') as HTMLInputElement).value).toBe('wss://mac');
    expect((screen.getByTestId('edit-token') as HTMLInputElement).value).toBe('');
  });

  it('saves an edited url and token, then collapses the form', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await fireEvent.input(screen.getByTestId('edit-url'), { target: { value: 'wss://mac2' } });
    await fireEvent.input(screen.getByTestId('edit-token'), { target: { value: 'newtok' } });
    await fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(store.updateMachine).toHaveBeenCalledWith('mac', { url: 'wss://mac2', token: 'newtok' });
    expect(screen.queryByTestId('edit-url')).not.toBeInTheDocument();
  });

  it('saves with a blank token as undefined (keep current)', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await fireEvent.input(screen.getByTestId('edit-url'), { target: { value: 'wss://mac2' } });
    await fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(store.updateMachine).toHaveBeenCalledWith('mac', { url: 'wss://mac2', token: undefined });
  });

  it('cancels editing without calling updateMachine', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(store.updateMachine).not.toHaveBeenCalled();
    expect(screen.queryByTestId('edit-url')).not.toBeInTheDocument();
  });

  it('does not save an edit with an empty url', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await fireEvent.input(screen.getByTestId('edit-url'), { target: { value: '' } });
    await fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(store.updateMachine).not.toHaveBeenCalled();
  });

  it('shows a diagnostic line when an offline machine has a connection error', () => {
    const store = fakeStore({
      statuses: { mac: 'offline' },
      lastConnectionError: {
        mac: { message: 'connection failed (likely network or permission block — unreachable)', code: 1006, at: Date.now() },
      },
    });
    render(Settings, { props: { store: store as never } });
    const diag = screen.getByTestId('diagnostic');
    expect(diag).toHaveTextContent('likely network or permission block');
    expect(diag).toHaveTextContent('code 1006');
  });

  it('hides the diagnostic line when the machine is online', () => {
    const store = fakeStore({
      statuses: { mac: 'online' },
      lastConnectionError: { mac: { message: 'old error', code: 1006, at: Date.now() } },
    });
    render(Settings, { props: { store: store as never } });
    expect(screen.queryByTestId('diagnostic')).not.toBeInTheDocument();
  });

  it('reconnects a machine that is not online via the Reconnect button', async () => {
    const store = fakeStore({ statuses: { mac: 'offline' } });
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    expect(store.reconnectMachine).toHaveBeenCalledWith('mac');
  });

  it('hides the Reconnect button when the machine is online', () => {
    const store = fakeStore({ statuses: { mac: 'online' } });
    render(Settings, { props: { store: store as never } });
    expect(screen.queryByTestId('reconnect')).not.toBeInTheDocument();
  });

  it('toggles a machine off via its switch', async () => {
    const store = fakeStore({ statuses: { mac: 'online' } });
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('switch', { name: /connect mac/i }));
    expect(store.toggleMachine).toHaveBeenCalledWith('mac');
  });

  it('shows the off state and hides reconnect for a disabled machine', () => {
    const store = fakeStore({
      machines: [{ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't', enabled: false }],
      statuses: { mac: 'offline' },
      lastConnectionError: { mac: { message: 'old error', code: 1006, at: Date.now() } },
    });
    render(Settings, { props: { store: store as never } });
    expect(screen.getByText('off')).toBeInTheDocument();
    expect(screen.queryByTestId('reconnect')).not.toBeInTheDocument();
    expect(screen.queryByTestId('diagnostic')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /connect mac/i }).getAttribute('aria-checked')).toBe('false');
  });

  it('marks the switch checked for an enabled machine', () => {
    const store = fakeStore({ statuses: { mac: 'online' } });
    render(Settings, { props: { store: store as never } });
    expect(screen.getByRole('switch', { name: /connect mac/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('pre-fills the ElevenLabs API key field from the store', () => {
    const store = fakeStore({ elevenLabsApiKey: 'sk_existing' });
    render(Settings, { props: { store: store as never } });
    expect((screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement).value).toBe('sk_existing');
  });

  it('saves the ElevenLabs API key', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.input(screen.getByLabelText(/elevenlabs api key/i), { target: { value: 'sk_new' } });
    await fireEvent.click(screen.getByRole('button', { name: /set api key/i }));
    expect(store.setElevenLabsApiKey).toHaveBeenCalledWith('sk_new');
  });

  it('returns to the list via the Done button', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(store.back).toHaveBeenCalled();
  });

  it('shows the terminal input log and reflects it on Refresh', async () => {
    inputLog.clear();
    inputLog.push({ kind: 'compositionupdate', detail: 'gi', out: 'i' });
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    const panel = screen.getByTestId('input-log');
    expect(panel.textContent).toContain('compositionupdate');
    expect(panel.textContent).toContain('gi');
  });

  it('clears the terminal input log', async () => {
    inputLog.clear();
    inputLog.push({ kind: 'keydown', detail: 'a (65)', out: '' });
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(inputLog.snapshot()).toEqual([]);
    expect(screen.getByTestId('input-log').textContent).toContain('Android IME events only');
  });
});
