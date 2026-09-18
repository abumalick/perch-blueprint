// Build GitHub links for a workspace's repo. Pure — the owner/repo/ownerType comes from the
// agent (remote parsed from git, owner type from the public API). Orgs use
// /orgs/<owner>/projects (the board list); users use /users/<owner>/projects. When ownerType
// is absent (the agent couldn't resolve it), fall back to the user form — it redirects to the
// owner's profile projects, which is correct for users and a reasonable fallback for orgs.
export function githubLinks(gh: {
  owner: string;
  repo: string;
  ownerType?: 'user' | 'org';
}): { issues: string; projects: string } {
  const projects =
    gh.ownerType === 'org'
      ? `https://github.com/orgs/${gh.owner}/projects`
      : `https://github.com/users/${gh.owner}/projects`;
  return {
    issues: `https://github.com/${gh.owner}/${gh.repo}/issues`,
    projects,
  };
}
