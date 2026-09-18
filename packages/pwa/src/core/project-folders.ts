import type { Workspace } from '@perch/contracts';
import type { MachineConfig } from './settings-store';
import { displayProjectPath } from './resolve-path';

// One entry of the workspace-list folder filter, in display order. `key` is the folder's full
// label path (what gets selected and persisted); `label` is that path relative to the nearest
// shown ancestor; `count` covers every session in the folder's subtree.
export interface ProjectFolder {
  key: string;
  label: string;
  count: number;
  depth: number;
}

// The project-folder label for a workspace: its projectPath shown relative to its machine's
// default path (the same transform as the workspace-list path). This is the grouping key, so
// the same relative path on different machines collapses into one folder.
export function projectFolderLabel(machines: readonly MachineConfig[], workspace: Workspace): string {
  const defaultPath = machines.find((m) => m.id === workspace.machineId)?.defaultPath;
  return displayProjectPath(defaultPath, workspace.projectPath);
}

// Whether a session's label lies in the folder `key` or anywhere below it. The `/` boundary
// keeps `bar` from matching `bar-archive`.
function inFolder(label: string, key: string): boolean {
  return label === key || label.startsWith(`${key}/`);
}

// Every ancestor path of a label, then the label itself: `bar/qux/x` → bar, bar/qux, bar/qux/x.
// Splitting at each `/` after the first character keeps an absolute path's root as `/srv`.
function pathPrefixes(label: string): string[] {
  const prefixes: string[] = [];
  for (let i = 1; i < label.length; i++) if (label[i] === '/') prefixes.push(label.slice(0, i));
  prefixes.push(label);
  return prefixes;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

// Build the folder tree, alphabetical at every level. A folder gets its own entry when it
// holds sessions itself or branches into two or more subfolders; single-child chains in
// between are collapsed into their descendant's label (`acme/web-app`, not `acme` › `web-app`).
export function deriveProjectFolders(
  workspaces: readonly Workspace[],
  machines: readonly MachineConfig[],
): ProjectFolder[] {
  const own = new Set<string>();
  const subtreeCount = new Map<string, number>();
  const children = new Map<string, Set<string>>();
  const roots = new Set<string>();
  for (const ws of workspaces) {
    const label = projectFolderLabel(machines, ws);
    own.add(label);
    let parent: string | null = null;
    for (const prefix of pathPrefixes(label)) {
      subtreeCount.set(prefix, (subtreeCount.get(prefix) ?? 0) + 1);
      if (parent === null) roots.add(prefix);
      else children.set(parent, (children.get(parent) ?? new Set<string>()).add(prefix));
      parent = prefix;
    }
  }

  const folders: ProjectFolder[] = [];
  const walk = (path: string, shownParent: string | null, depth: number) => {
    const kids = [...(children.get(path) ?? [])].sort(byName);
    const shown = own.has(path) || kids.length > 1;
    if (shown) {
      const label = shownParent === null ? path : path.slice(shownParent.length + 1);
      folders.push({ key: path, label, count: subtreeCount.get(path) ?? 0, depth });
    }
    for (const kid of kids) walk(kid, shown ? path : shownParent, shown ? depth + 1 : depth);
  };
  for (const root of [...roots].sort(byName)) walk(root, null, 0);
  return folders;
}

// Which persisted filter keys are still valid: a key stays while any session lies under it,
// even when the tree no longer shows that folder as its own entry (a parent collapses once
// only one project is left below it). `workspacesLoaded` must be false until the workspace list
// has actually arrived at least once: it starts empty on every reload (the agent's list reply is
// async), and an empty list at that point means "not loaded yet", not "the selected folders
// vanished" — pruning then would wipe a persisted filter before it ever gets a chance to apply.
export function pruneStaleFilter(
  selected: ReadonlySet<string>,
  workspaces: readonly Workspace[],
  machines: readonly MachineConfig[],
  workspacesLoaded: boolean,
): string[] {
  if (!workspacesLoaded) return [...selected];
  const labels = workspaces.map((ws) => projectFolderLabel(machines, ws));
  return [...selected].filter((key) => labels.some((label) => inFolder(label, key)));
}

// Filter the list to the selected folders and everything below them. An empty selection means
// "show all" and returns the input unchanged. Preserves the input order (the list is already
// status-sorted upstream).
export function filterWorkspaces(
  workspaces: Workspace[],
  machines: readonly MachineConfig[],
  selected: ReadonlySet<string>,
): Workspace[] {
  if (selected.size === 0) return workspaces;
  return workspaces.filter((ws) => {
    const label = projectFolderLabel(machines, ws);
    return [...selected].some((key) => inFolder(label, key));
  });
}
