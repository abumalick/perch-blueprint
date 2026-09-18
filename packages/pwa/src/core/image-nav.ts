// Navigation among the image files of a single folder. Pure; the folder's file list
// (dirEntries.files) is already in memory when the viewer is open.
import { imageMediaType } from '@perch/contracts';

export function imageFiles(files: string[]): string[] {
  return files.filter((f) => imageMediaType(f) !== '');
}

export function neighbor(images: string[], current: string, dir: -1 | 1): string | null {
  const i = images.indexOf(current);
  if (i < 0) return null;
  return images[i + dir] ?? null;
}

export function position(
  images: string[],
  current: string,
): { index: number; count: number } | null {
  const i = images.indexOf(current);
  if (i < 0) return null;
  return { index: i + 1, count: images.length };
}
