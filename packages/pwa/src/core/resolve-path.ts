// Resolve a New-workspace path input against a machine's optional default path.
// An absolute input (starting with `/`) wins as an escape hatch; a relative input is
// joined onto the default; an empty input opens the default root. With no default set,
// the input is returned unchanged (legacy behavior: paths were always absolute).
export function resolveProjectPath(defaultPath: string | undefined, input: string): string {
  if (!defaultPath) return input;
  if (input.startsWith('/')) return input;
  const root = defaultPath.replace(/\/+$/, '');
  return input ? `${root}/${input}` : root;
}

// Display a workspace path relative to a machine's optional default path — the inverse of
// resolveProjectPath. A path under the default is shown without that prefix; the default
// root itself shows its folder name; a path outside the default (or no default) is shown
// in full. The `/` boundary check avoids stripping a default that is only a string prefix.
export function displayProjectPath(defaultPath: string | undefined, projectPath: string): string {
  if (!defaultPath) return projectPath;
  const root = defaultPath.replace(/\/+$/, '');
  if (!root) return projectPath;
  if (projectPath === root) return root.split('/').filter(Boolean).pop() ?? projectPath;
  if (projectPath.startsWith(`${root}/`)) return projectPath.slice(root.length + 1);
  return projectPath;
}

// Turn an absolute path into the value the New-workspace input should hold so that
// resolveProjectPath reproduces it — the inverse used when the folder picker returns a
// selection. The default root maps to '' (opens the root); a path under the default maps to
// the relative remainder; a path outside the default (or no default) stays absolute, which
// resolveProjectPath passes through unchanged.
export function relativeProjectPath(defaultPath: string | undefined, absolute: string): string {
  if (!defaultPath) return absolute;
  const root = defaultPath.replace(/\/+$/, '');
  if (!root) return absolute;
  if (absolute === root) return '';
  if (absolute.startsWith(`${root}/`)) return absolute.slice(root.length + 1);
  return absolute;
}
