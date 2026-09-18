import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { PathResolver } from '../ports/path-resolver';

export const systemClock: Clock = {
  now: () => Date.now(),
};

export const systemPathResolver: PathResolver = (path) => resolve(path);

export class RandomIdGenerator implements IdGenerator {
  next(): string {
    return randomBytes(3).toString('hex');
  }
}
