export interface GithubRepoRef {
  owner: string;
  repo: string;
  // 'user' or 'org' when resolvable; absent when the lookup failed (offline/rate-limited) so
  // the PWA falls back to the universal user Projects URL.
  ownerType?: 'user' | 'org';
}

// Resolves a working directory's GitHub `origin` remote to an owner/repo (plus owner type).
// Behind a port so the git subprocess stays out of the application layer and can be faked in
// tests.
export interface RepoRemotePort {
  // The GitHub owner/repo for a path's `origin` remote, or null when there is no git repo,
  // no origin, or the remote is not a github.com URL.
  getGithubRepo(path: string): Promise<GithubRepoRef | null>;
}
