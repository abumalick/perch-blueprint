import { describe, it, expect } from 'vitest';
import { deriveHomeView } from './home-view';

describe('deriveHomeView', () => {
  it('prompts to add a machine when none are enabled', () => {
    expect(
      deriveHomeView({ enabledMachineCount: 0, anyOnline: false, workspaceCount: 0, graceElapsed: true }),
    ).toBe('add-machine');
  });

  it('add-machine wins even if workspaces are cached and grace has not elapsed', () => {
    expect(
      deriveHomeView({ enabledMachineCount: 0, anyOnline: true, workspaceCount: 3, graceElapsed: false }),
    ).toBe('add-machine');
  });

  it('shows the list whenever there are workspaces, even if every machine is offline', () => {
    expect(
      deriveHomeView({ enabledMachineCount: 2, anyOnline: false, workspaceCount: 1, graceElapsed: true }),
    ).toBe('list');
  });

  it('prompts to create when a machine is online but reports no workspaces', () => {
    expect(
      deriveHomeView({ enabledMachineCount: 1, anyOnline: true, workspaceCount: 0, graceElapsed: true }),
    ).toBe('create');
  });

  it('shows connecting when no machine is online yet and grace has not elapsed', () => {
    expect(
      deriveHomeView({ enabledMachineCount: 1, anyOnline: false, workspaceCount: 0, graceElapsed: false }),
    ).toBe('connecting');
  });

  it('shows unreachable when no machine is online after the grace period', () => {
    expect(
      deriveHomeView({ enabledMachineCount: 2, anyOnline: false, workspaceCount: 0, graceElapsed: true }),
    ).toBe('unreachable');
  });

  it('shows reconnecting (not unreachable) when a machine that connected before is retrying', () => {
    expect(
      deriveHomeView({
        enabledMachineCount: 1,
        anyOnline: false,
        workspaceCount: 0,
        graceElapsed: true,
        anyReconnecting: true,
      }),
    ).toBe('reconnecting');
  });

  it('reconnecting overrides the initial connecting grace too', () => {
    expect(
      deriveHomeView({
        enabledMachineCount: 1,
        anyOnline: false,
        workspaceCount: 0,
        graceElapsed: false,
        anyReconnecting: true,
      }),
    ).toBe('reconnecting');
  });

  it('still shows unreachable for a machine that has never connected (not reconnecting)', () => {
    expect(
      deriveHomeView({
        enabledMachineCount: 1,
        anyOnline: false,
        workspaceCount: 0,
        graceElapsed: true,
        anyReconnecting: false,
      }),
    ).toBe('unreachable');
  });
});
