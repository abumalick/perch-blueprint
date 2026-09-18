import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsBrowserDiscovery } from './fs-browser-discovery';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perch-browser-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const alive = () => true;
const dead = () => false;

describe('FsBrowserDiscovery', () => {
  it('lists a live session with its parsed stream port', async () => {
    await writeFile(join(dir, 'ws1.stream'), '9223\n');
    await writeFile(join(dir, 'ws1.pid'), '4242\n');
    const discovery = new FsBrowserDiscovery({ dir, isPidAlive: alive });
    expect(await discovery.listSessions()).toEqual([{ name: 'ws1', streamPort: 9223 }]);
  });

  it('skips a session whose pid is not alive', async () => {
    await writeFile(join(dir, 'gone.stream'), '9223');
    await writeFile(join(dir, 'gone.pid'), '4242');
    const discovery = new FsBrowserDiscovery({ dir, isPidAlive: dead });
    expect(await discovery.listSessions()).toEqual([]);
  });

  it('skips a session with no pid file', async () => {
    await writeFile(join(dir, 'orphan.stream'), '9223');
    const discovery = new FsBrowserDiscovery({ dir, isPidAlive: alive });
    expect(await discovery.listSessions()).toEqual([]);
  });

  it('returns [] when the directory does not exist', async () => {
    const discovery = new FsBrowserDiscovery({ dir: join(dir, 'missing'), isPidAlive: alive });
    expect(await discovery.listSessions()).toEqual([]);
  });

  it('skips a session whose stream file is not a port number', async () => {
    await writeFile(join(dir, 'bad.stream'), 'garbage');
    await writeFile(join(dir, 'bad.pid'), '4242');
    await writeFile(join(dir, 'good.stream'), '9300');
    await writeFile(join(dir, 'good.pid'), '4243');
    const discovery = new FsBrowserDiscovery({ dir, isPidAlive: alive });
    expect(await discovery.listSessions()).toEqual([{ name: 'good', streamPort: 9300 }]);
  });

  it('checks liveness with process.kill(pid, 0) by default', async () => {
    await writeFile(join(dir, 'me.stream'), '9223');
    await writeFile(join(dir, 'me.pid'), `${process.pid}`);
    const discovery = new FsBrowserDiscovery({ dir });
    expect(await discovery.listSessions()).toEqual([{ name: 'me', streamPort: 9223 }]);
  });
});
