// Slug of the build currently served, baked in at build time (vite `define`).
// 'main' for a normal production build; a worktree slug when a test build is
// temporarily served via `pnpm serve:build` (see docs/WORKTREES.md).
export const BUILD_LABEL: string = __PERCH_BUILD_LABEL__;

export const isTestBuild = (label: string = BUILD_LABEL): boolean => label !== 'main';
