// Navigation among the audio files of a single folder, ordered by file name so "next"/
// "previous" and end-of-track auto-advance follow the natural track order (track2 before
// track10). Pure; the folder's file list (dirEntries.files) is already in memory when the
// viewer is open. Reuses the generic `neighbor`/`position` from image-nav.
import { audioMediaType } from '@perch/contracts';
import { basename } from './browse-path';

export function audioFiles(files: string[]): string[] {
  return files
    .filter((f) => audioMediaType(f) !== '')
    .sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true }));
}
