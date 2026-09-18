import { describe, it, expect } from 'vitest';
import { WorkspaceAggregator } from './workspace-aggregator';
import type { Workspace } from '@perch/contracts';
import type { WorkspaceStatus } from '@perch/contracts';

function ws(id: string, machineId: string, status: WorkspaceStatus, lastActivityAt = 0): Workspace {
  return {
    machineId,
    id,
    name: id,
    projectPath: `/p/${id}`,
    command: 'claude',
    createdAt: 0,
    lastActivityAt,
    status,
  };
}

describe('WorkspaceAggregator', () => {
  it('stamps workspaces with the connection id, not the agent-sent machineId', () => {
    const agg = new WorkspaceAggregator();
    // The agent labels workspaces with its own PERCH_MACHINE_ID ("agent-internal"),
    // but the PWA connection is keyed "conn1" — routing must use "conn1".
    agg.apply('conn1', { type: 'workspaces', workspaces: [ws('a', 'agent-internal', 'idle')] });
    expect(agg.snapshot()[0]?.machineId).toBe('conn1');
    agg.apply('conn1', { type: 'workspaceUpdated', workspace: ws('a', 'agent-internal', 'finished') });
    expect(agg.snapshot()[0]?.machineId).toBe('conn1');
  });

  it('aggregates and sorts workspaces across machines by status', () => {
    const agg = new WorkspaceAggregator();
    agg.apply('m1', { type: 'workspaces', workspaces: [ws('a', 'm1', 'idle')] });
    agg.apply('m2', { type: 'workspaces', workspaces: [ws('b', 'm2', 'needs-feedback')] });
    expect(agg.snapshot().map((w) => w.id)).toEqual(['b', 'a']);
  });

  it('upserts on workspaceUpdated', () => {
    const agg = new WorkspaceAggregator();
    agg.apply('m1', { type: 'workspaces', workspaces: [ws('a', 'm1', 'idle')] });
    agg.apply('m1', { type: 'workspaceUpdated', workspace: ws('a', 'm1', 'needs-feedback') });
    expect(agg.snapshot()[0]?.status).toBe('needs-feedback');
    expect(agg.snapshot()).toHaveLength(1);
  });

  it('removes on closed', () => {
    const agg = new WorkspaceAggregator();
    agg.apply('m1', { type: 'workspaces', workspaces: [ws('a', 'm1', 'idle'), ws('b', 'm1', 'idle')] });
    agg.apply('m1', { type: 'closed', workspaceId: 'a' });
    expect(agg.snapshot().map((w) => w.id)).toEqual(['b']);
  });

  it('clears a machine when set offline', () => {
    const agg = new WorkspaceAggregator();
    agg.apply('m1', { type: 'workspaces', workspaces: [ws('a', 'm1', 'idle')] });
    agg.apply('m2', { type: 'workspaces', workspaces: [ws('b', 'm2', 'idle')] });
    agg.setMachineOffline('m1');
    expect(agg.snapshot().map((w) => w.id)).toEqual(['b']);
  });

  it('notifies onChange listeners', () => {
    const agg = new WorkspaceAggregator();
    let count = 0;
    agg.onChange(() => {
      count += 1;
    });
    agg.apply('m1', { type: 'workspaces', workspaces: [ws('a', 'm1', 'idle')] });
    expect(count).toBe(1);
  });
});
