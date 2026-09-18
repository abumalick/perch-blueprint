import type { RecentStorePort } from '../ports/recent-store-port';
import { isHiddenPath } from './is-hidden-path';

export async function getRecentPaths(deps: {
  recent: RecentStorePort;
  hidden: string[];
}): Promise<string[]> {
  const paths = await deps.recent.list();
  return paths.filter((p) => !isHiddenPath(p, deps.hidden));
}
