import { join } from 'node:path';

export interface AgentConfig {
  machineId: string;
  token: string | undefined;
  host: string;
  port: number;
  projectRoots: string[];
  recentStorePath: string;
  statusStorePath: string;
  hiddenFoldersPath: string;
  commandsPath: string;
  clientLogPath: string;
  workspaceLogPath: string;
  parkedStorePath: string;
  claudeSessionsDir: string;
  sessionPrefix: string;
}

export function loadConfig(env: NodeJS.ProcessEnv, home: string): AgentConfig {
  const machineId = env.PERCH_MACHINE_ID;
  if (!machineId) {
    throw new Error('PERCH_MACHINE_ID is required');
  }
  const projectRoots = env.PERCH_PROJECT_ROOTS
    ? env.PERCH_PROJECT_ROOTS.split(':').filter((p) => p.length > 0)
    : [join(home, 'workspace')];

  let port = 8787;
  if (env.PERCH_PORT) {
    port = Number.parseInt(env.PERCH_PORT, 10);
    if (Number.isNaN(port)) {
      throw new Error('PERCH_PORT must be a number');
    }
  }

  return {
    machineId,
    token: env.PERCH_TOKEN,
    host: env.PERCH_HOST ?? '127.0.0.1',
    port,
    projectRoots,
    recentStorePath: join(home, '.perch', 'recent.json'),
    statusStorePath: join(home, '.perch', 'status.json'),
    hiddenFoldersPath: join(home, '.perch', 'hidden-folders.json'),
    commandsPath: join(home, '.perch', 'commands.json'),
    clientLogPath: join(home, '.perch', 'client-log.jsonl'),
    workspaceLogPath: join(home, '.perch', 'workspace-log.jsonl'),
    parkedStorePath: join(home, '.perch', 'parked.json'),
    // Claude Code's own registry, not Perch's — read-only, and absent on a machine
    // without Claude Code.
    claudeSessionsDir: join(home, '.claude', 'sessions'),
    sessionPrefix: 'perch-',
  };
}

export function assertServerConfig(
  config: AgentConfig,
): asserts config is AgentConfig & { token: string } {
  if (!config.token) {
    throw new Error('PERCH_TOKEN is required to run the agent server');
  }
}
