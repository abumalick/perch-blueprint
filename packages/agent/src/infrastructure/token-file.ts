import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function writeAgentToken(home: string, token: string): Promise<string> {
  const dir = join(home, '.perch');
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'token');
  await writeFile(path, token, { encoding: 'utf8', mode: 0o600 });
  return path;
}
