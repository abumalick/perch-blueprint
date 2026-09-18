import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './cli';

const exec = promisify(execFile);
const sessions: string[] = [];
const tmpDirs: string[] = [];

afterEach(async () => {
  for (const name of sessions.splice(0)) {
    await exec('tmux', ['kill-session', '-t', name]).catch(() => undefined);
  }
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('perch CLI (real tmux)', () => {
  it('creates, lists, and closes a workspace end to end', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-cli-home-'));
    const project = await mkdtemp(join(tmpdir(), 'perch-cli-proj-'));
    tmpDirs.push(home, project);
    const env = { PERCH_MACHINE_ID: 'test', PERCH_TOKEN: 'test-token', PERCH_PROJECT_ROOTS: tmpdir() };

    const createdJson = await run(['create', project, 'sleep 30'], env, home);
    const ws = JSON.parse(createdJson) as { id: string; projectPath: string; status: string };
    sessions.push(ws.id);
    expect(ws.id.startsWith('perch-')).toBe(true);
    expect(ws.projectPath).toBe(project);
    expect(ws.status).toBe('idle');

    const listJson = await run(['list'], env, home);
    const list = JSON.parse(listJson) as Array<{ id: string }>;
    expect(list.some((w) => w.id === ws.id)).toBe(true);

    const recentJson = await run(['recent'], env, home);
    expect(JSON.parse(recentJson)).toContain(project);

    await run(['close', ws.id], env, home);
    const afterJson = await run(['list'], env, home);
    const after = JSON.parse(afterJson) as Array<{ id: string }>;
    expect(after.some((w) => w.id === ws.id)).toBe(false);
  });

  // `perch list` is the same question the PWA asks, so it must not answer it differently.
  it('stamps the agent address of the Claude session running in a workspace', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-cli-home-'));
    const project = await mkdtemp(join(tmpdir(), 'perch-cli-proj-'));
    tmpDirs.push(home, project);
    const env = { PERCH_MACHINE_ID: 'test', PERCH_TOKEN: 'test-token', PERCH_PROJECT_ROOTS: tmpdir() };

    const ws = JSON.parse(await run(['create', project, 'sleep 30'], env, home)) as { id: string };
    sessions.push(ws.id);

    await mkdir(join(home, '.claude', 'sessions'), { recursive: true });
    await writeFile(
      join(home, '.claude', 'sessions', '4242.json'),
      JSON.stringify({ name: 'project-ab', tmux: `${ws.id}:@1.%1` }),
      'utf8',
    );

    const list = JSON.parse(await run(['list'], env, home)) as Array<{ id: string; agentAddress?: string }>;
    expect(list.find((w) => w.id === ws.id)?.agentAddress).toBe('project-ab');
  });
});
