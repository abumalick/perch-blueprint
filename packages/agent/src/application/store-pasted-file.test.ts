import { describe, it, expect } from 'vitest';
import { storePastedFile } from './store-pasted-file';
import type { FileWriterPort } from '../ports/file-writer-port';

function fakeWriter(existing: string[] = []) {
  const present = new Set(existing);
  const writes: Array<{ path: string; bytes: Uint8Array }> = [];
  const dirs: string[] = [];
  const writer: FileWriterPort = {
    ensureDir: async (d) => void dirs.push(d),
    exists: async (p) => present.has(p),
    writeFile: async (p, b) => {
      writes.push({ path: p, bytes: b });
      present.add(p);
    },
  };
  return { writer, writes, dirs };
}

describe('storePastedFile', () => {
  it('writes into <cwd>/.tmp/files and returns the relative path', async () => {
    const { writer, writes, dirs } = fakeWriter();
    const path = await storePastedFile(
      { writer },
      { projectPath: '/home/u/api', name: 'pasted-image.png', bytes: new Uint8Array([1]) },
    );
    expect(path).toBe('.tmp/files/pasted-image.png');
    expect(dirs).toEqual(['/home/u/api/.tmp/files']);
    expect(writes[0]!.path).toBe('/home/u/api/.tmp/files/pasted-image.png');
  });

  it('suffixes -1, -2 before the extension on collision', async () => {
    const { writer } = fakeWriter([
      '/home/u/api/.tmp/files/pasted-image.png',
      '/home/u/api/.tmp/files/pasted-image-1.png',
    ]);
    const path = await storePastedFile(
      { writer },
      { projectPath: '/home/u/api', name: 'pasted-image.png', bytes: new Uint8Array([1]) },
    );
    expect(path).toBe('.tmp/files/pasted-image-2.png');
  });

  it('strips path components from the proposed name (no escape)', async () => {
    const { writer, writes } = fakeWriter();
    const path = await storePastedFile(
      { writer },
      { projectPath: '/home/u/api', name: '../../evil.png', bytes: new Uint8Array([1]) },
    );
    expect(path).toBe('.tmp/files/evil.png');
    expect(writes[0]!.path).toBe('/home/u/api/.tmp/files/evil.png');
  });

  it('falls back to a default name when the proposed name is empty', async () => {
    const { writer } = fakeWriter();
    const path = await storePastedFile(
      { writer },
      { projectPath: '/home/u/api', name: '', bytes: new Uint8Array([1]) },
    );
    expect(path).toBe('.tmp/files/pasted-file');
  });
});
