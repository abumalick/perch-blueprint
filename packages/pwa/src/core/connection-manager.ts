import type { AgentMessage, ClientMessage } from '@perch/contracts';
import { MachineConnection, type ConnectionDiagnostic, type ConnectionStatus } from './machine-connection';
import type { SocketFactory } from './ports/socket';
import type { WorkspaceAggregator } from './workspace-aggregator';
import type { MachineConfig } from './settings-store';

export interface ConnectionManagerDeps {
  socketFactory: SocketFactory;
  aggregator: WorkspaceAggregator;
  onMessage: (machineId: string, message: AgentMessage) => void;
  onStatus: (machineId: string, status: ConnectionStatus) => void;
  onDiagnostic?: (machineId: string, diagnostic: ConnectionDiagnostic) => void;
  schedule?: (fn: () => void, ms: number) => void;
}

export class ConnectionManager {
  private readonly connections = new Map<string, MachineConnection>();

  constructor(private readonly deps: ConnectionManagerDeps) {}

  setMachines(configs: MachineConfig[]): void {
    const wanted = new Set(configs.filter((c) => c.enabled !== false).map((c) => c.id));
    for (const [id, conn] of this.connections) {
      if (!wanted.has(id)) {
        conn.close();
        this.connections.delete(id);
        this.deps.aggregator.setMachineOffline(id);
      }
    }
    for (const config of configs) {
      if (config.enabled === false) continue;
      this.connections.get(config.id)?.close();
      const conn = new MachineConnection({
        url: config.url,
        token: config.token,
        socketFactory: this.deps.socketFactory,
        schedule: this.deps.schedule,
        onDiagnostic: (diagnostic) => this.deps.onDiagnostic?.(config.id, diagnostic),
        onMessage: (message) => {
          this.deps.aggregator.apply(config.id, message);
          this.deps.onMessage(config.id, message);
        },
        onStatus: (status) => {
          if (status === 'offline') {
            this.deps.aggregator.setMachineOffline(config.id);
          } else if (status === 'online') {
            // The agent only returns workspaces in response to `list`; request it on
            // every (re)connect so the list populates and re-syncs after a reconnect.
            this.connections.get(config.id)?.send({ type: 'list' });
            // Same deal for the keyboard bar's command shortcuts: asking on every
            // (re)connect is what picks up an edit to the agent's ~/.perch/commands.json.
            this.connections.get(config.id)?.send({ type: 'listCommands' });
          }
          this.deps.onStatus(config.id, status);
        },
      });
      this.connections.set(config.id, conn);
      conn.connect();
    }
  }

  send(machineId: string, message: ClientMessage): void {
    this.connections.get(machineId)?.send(message);
  }

  // Manually resume a machine that gave up auto-retrying (see MachineConnection.reconnect).
  reconnect(machineId: string): void {
    this.connections.get(machineId)?.reconnect();
  }

  // Probe a machine's link immediately (see MachineConnection.checkLiveness).
  checkLiveness(machineId: string): void {
    this.connections.get(machineId)?.checkLiveness();
  }

  stop(): void {
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
  }
}
