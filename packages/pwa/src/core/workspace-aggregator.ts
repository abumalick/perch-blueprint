import { sortByStatus, type AgentMessage, type Workspace } from '@perch/contracts';

export class WorkspaceAggregator {
  private readonly byMachine = new Map<string, Workspace[]>();
  private readonly listeners: Array<() => void> = [];

  apply(machineId: string, message: AgentMessage): void {
    switch (message.type) {
      case 'workspaces':
        // Stamp each workspace with the CONNECTION's id (the PWA's machine config id),
        // not the agent's internal PERCH_MACHINE_ID. The UI routes attach/input/close and
        // the status dot by workspace.machineId, which must match the connection key — else
        // a machine named differently from the agent's id can list but never attach.
        this.byMachine.set(
          machineId,
          message.workspaces.map((w) => ({ ...w, machineId })),
        );
        this.emit();
        return;
      case 'workspaceUpdated': {
        const current = this.byMachine.get(machineId) ?? [];
        const updated = { ...message.workspace, machineId };
        const next = current.filter((w) => w.id !== updated.id);
        next.push(updated);
        this.byMachine.set(machineId, next);
        this.emit();
        return;
      }
      case 'closed': {
        const current = this.byMachine.get(machineId);
        if (!current) return;
        this.byMachine.set(
          machineId,
          current.filter((w) => w.id !== message.workspaceId),
        );
        this.emit();
        return;
      }
      default:
        return;
    }
  }

  setMachineOffline(machineId: string): void {
    if (this.byMachine.has(machineId)) {
      this.byMachine.delete(machineId);
      this.emit();
    }
  }

  snapshot(): Workspace[] {
    const all: Workspace[] = [];
    for (const list of this.byMachine.values()) {
      all.push(...list);
    }
    return sortByStatus(all);
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
