import { describe, it, expect } from 'vitest';
import { ConnectionManager } from './connection-manager';
import { WorkspaceAggregator } from './workspace-aggregator';
import type { Socket } from './ports/socket';
import type { AgentMessage } from '@perch/contracts';

function fakeSocket() {
  let onMessage: (d: string) => void = () => undefined;
  let onOpen: () => void = () => undefined;
  let onClose: () => void = () => undefined;
  const sent: string[] = [];
  let closed = false;
  const socket: Socket = {
    send: (d) => sent.push(d),
    close: () => {
      closed = true;
      onClose();
    },
    onMessage: (cb) => {
      onMessage = cb;
    },
    onOpen: (cb) => {
      onOpen = cb;
    },
    onClose: (cb) => {
      onClose = cb;
    },
  };
  return {
    socket,
    sent,
    isClosed: () => closed,
    open: () => onOpen(),
    deliver: (m: unknown) => onMessage(JSON.stringify(m)),
  };
}

function harness() {
  const sockets: Record<string, ReturnType<typeof fakeSocket>> = {};
  const aggregator = new WorkspaceAggregator();
  const messages: Array<[string, AgentMessage]> = [];
  const statuses: Array<[string, string]> = [];
  const manager = new ConnectionManager({
    socketFactory: (url) => {
      const f = fakeSocket();
      sockets[url] = f;
      return f.socket;
    },
    aggregator,
    onMessage: (id, m) => messages.push([id, m]),
    onStatus: (id, s) => statuses.push([id, s]),
    schedule: () => undefined,
  });
  return { manager, aggregator, sockets, messages, statuses };
}

const mac = { id: 'mac', name: 'Mac', url: 'wss://mac', token: 't1' };
const mini = { id: 'mini', name: 'Mini', url: 'wss://mini', token: 't2' };

describe('ConnectionManager', () => {
  it('requests the workspace list when a machine comes online', () => {
    const h = harness();
    h.manager.setMachines([mac]);
    h.sockets['wss://mac']!.open();
    h.sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const sent = h.sockets['wss://mac']!.sent.map((s) => JSON.parse(s) as { type: string });
    expect(sent).toContainEqual({ type: 'list' });
  });

  // The keyboard bar's command drop-down is per-machine config; asking on every (re)connect
  // is what picks up an edit to the agent's ~/.perch/commands.json.
  it('requests the command shortcuts when a machine comes online', () => {
    const h = harness();
    h.manager.setMachines([mac]);
    h.sockets['wss://mac']!.open();
    h.sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const sent = h.sockets['wss://mac']!.sent.map((s) => JSON.parse(s) as { type: string });
    expect(sent).toContainEqual({ type: 'listCommands' });
  });

  it('opens a connection per machine and authenticates', () => {
    const h = harness();
    h.manager.setMachines([mac, mini]);
    h.sockets['wss://mac']!.open();
    expect(JSON.parse(h.sockets['wss://mac']!.sent[0]!)).toEqual({ type: 'auth', token: 't1' });
    expect(Object.keys(h.sockets)).toEqual(['wss://mac', 'wss://mini']);
  });

  it('routes workspace messages into the aggregator', () => {
    const h = harness();
    h.manager.setMachines([mac]);
    h.sockets['wss://mac']!.open();
    h.sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    h.sockets['wss://mac']!.deliver({
      type: 'workspaces',
      workspaces: [
        { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' },
      ],
    });
    expect(h.aggregator.snapshot().map((w) => w.id)).toEqual(['perch-a']);
  });

  it('forwards every message to onMessage with the machine id', () => {
    const h = harness();
    h.manager.setMachines([mac]);
    h.sockets['wss://mac']!.open();
    h.sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    h.sockets['wss://mac']!.deliver({ type: 'output', workspaceId: 'perch-a', data: 'aGk=' });
    expect(h.messages).toContainEqual(['mac', { type: 'output', workspaceId: 'perch-a', data: 'aGk=' }]);
  });

  it('reports status and clears a machine on offline', () => {
    const h = harness();
    h.manager.setMachines([mac]);
    h.sockets['wss://mac']!.open();
    h.sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    h.sockets['wss://mac']!.deliver({
      type: 'workspaces',
      workspaces: [
        { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' },
      ],
    });
    h.sockets['wss://mac']!.socket.close();
    expect(h.statuses).toContainEqual(['mac', 'offline']);
    expect(h.aggregator.snapshot()).toEqual([]);
  });

  it('closes removed machines on setMachines', () => {
    const h = harness();
    h.manager.setMachines([mac, mini]);
    h.manager.setMachines([mac]);
    expect(h.sockets['wss://mini']!.isClosed()).toBe(true);
  });

  it('sends a client message to a specific machine', () => {
    const h = harness();
    h.manager.setMachines([mac]);
    h.sockets['wss://mac']!.open();
    h.sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    h.manager.send('mac', { type: 'list' });
    expect(JSON.parse(h.sockets['wss://mac']!.sent.at(-1)!)).toEqual({ type: 'list' });
  });

  it('reconnect() drives a fresh connection attempt for one machine', () => {
    const h = harness();
    h.manager.setMachines([mac]);
    h.sockets['wss://mac']!.socket.close(); // machine drops (schedule is a no-op here)
    h.manager.reconnect('mac');
    h.sockets['wss://mac']!.open();
    expect(JSON.parse(h.sockets['wss://mac']!.sent[0]!)).toEqual({ type: 'auth', token: 't1' });
  });

  it('does not open a connection for a disabled machine', () => {
    const h = harness();
    h.manager.setMachines([{ ...mac, enabled: false }]);
    expect(h.sockets['wss://mac']).toBeUndefined();
  });

  it('closes the socket and clears workspaces when a machine is disabled', () => {
    const h = harness();
    h.manager.setMachines([mac]);
    h.sockets['wss://mac']!.open();
    h.sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    h.sockets['wss://mac']!.deliver({
      type: 'workspaces',
      workspaces: [
        { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' },
      ],
    });
    h.manager.setMachines([{ ...mac, enabled: false }]);
    expect(h.sockets['wss://mac']!.isClosed()).toBe(true);
    expect(h.aggregator.snapshot()).toEqual([]);
  });

  it('reconnects a machine when it is re-enabled', () => {
    const h = harness();
    h.manager.setMachines([{ ...mac, enabled: false }]);
    h.manager.setMachines([mac]);
    expect(h.sockets['wss://mac']).toBeDefined();
    h.sockets['wss://mac']!.open();
    expect(JSON.parse(h.sockets['wss://mac']!.sent[0]!)).toEqual({ type: 'auth', token: 't1' });
  });

  it('clears workspaces when a machine is removed', () => {
    const h = harness();
    h.manager.setMachines([mac]);
    h.sockets['wss://mac']!.open();
    h.sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    h.sockets['wss://mac']!.deliver({
      type: 'workspaces',
      workspaces: [
        { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' },
      ],
    });
    h.manager.setMachines([]);
    expect(h.aggregator.snapshot()).toEqual([]);
  });
});
