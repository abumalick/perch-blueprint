import { basename, extname, join } from 'node:path';
import type { FileWriterPort } from '../ports/file-writer-port';

export async function storePastedFile(
  deps: { writer: FileWriterPort },
  input: { projectPath: string; name: string; bytes: Uint8Array },
): Promise<string> {
  // basename() strips any path component (`../`, absolute) so a hostile name cannot
  // escape `.tmp/files/`.
  const safeName = basename(input.name) || 'pasted-file';
  const dir = join(input.projectPath, '.tmp', 'files');
  await deps.writer.ensureDir(dir);
  const finalName = await uniqueName(deps.writer, dir, safeName);
  await deps.writer.writeFile(join(dir, finalName), input.bytes);
  return join('.tmp', 'files', finalName);
}

async function uniqueName(writer: FileWriterPort, dir: string, name: string): Promise<string> {
  if (!(await writer.exists(join(dir, name)))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!(await writer.exists(join(dir, candidate)))) return candidate;
  }
}
