import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RepoRemotePort, GithubRepoRef } from '../ports/repo-remote-port';

const exec = promisify(execFile);

// Parse a git remote URL into a GitHub owner/repo, or null when it is not a github.com
// remote. Handles the scp-like SSH form (git@github.com:owner/repo.git) and the ssh://,
// https:// URL forms, with or without a trailing `.git` or slash. Pure — unit-testable
// without spawning git.
export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  const scp = /^[^@]+@github\.com:(.+)$/.exec(trimmed);
  const urlMatch = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com\/(.+)$/.exec(trimmed);
  const rest = scp?.[1] ?? urlMatch?.[1];
  if (!rest) return null;
  const [owner, repo] = rest
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .split('/');
  if (!owner || !repo) return null;
  return { owner, repo };
}

type GitRunner = (path: string) => Promise<string | null>;
type OwnerTypeResolver = (owner: string) => Promise<'user' | 'org' | undefined>;

async function readOriginUrl(path: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['-C', path, 'remote', 'get-url', 'origin']);
    return stdout.trim();
  } catch {
    return null;
  }
}

function toOwnerType(type: unknown): 'user' | 'org' | undefined {
  return type === 'Organization' ? 'org' : type === 'User' ? 'user' : undefined;
}

// Owner type via the authenticated `gh` CLI (5000/hr, no practical limit). Uses the user's
// existing gh auth; returns undefined when gh is absent, unauthenticated, or errors.
async function ghOwnerType(owner: string): Promise<'user' | 'org' | undefined> {
  try {
    const { stdout } = await exec('gh', ['api', `users/${owner}`, '--jq', '.type'], {
      timeout: 4000,
    });
    return toOwnerType(stdout.trim());
  } catch {
    return undefined;
  }
}

// Owner type via the unauthenticated public API (60/hr/IP). Fallback for machines without a
// usable `gh`. Short timeout so `list` never blocks on the network.
async function httpOwnerType(owner: string): Promise<'user' | 'org' | undefined> {
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'perch-agent' },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return undefined;
    return toOwnerType((await res.json())?.type);
  } catch {
    return undefined;
  }
}

// Owner type is public and only needed to pick the right Projects URL (orgs → /orgs/…, users
// → /users/…). Prefer authenticated `gh` (no rate limit), fall back to the unauthenticated
// public API, then undefined so the PWA uses the universal user link.
async function fetchOwnerType(owner: string): Promise<'user' | 'org' | undefined> {
  return (await ghOwnerType(owner)) ?? (await httpOwnerType(owner));
}

export class GitRepoRemote implements RepoRemotePort {
  // Remotes essentially never change during a session, so a path is resolved once and cached
  // (null included) to keep `list` from spawning git on every call.
  // The parsed remote is cached permanently by path — the git subprocess runs once per path.
  private readonly repoByPath = new Map<string, { owner: string; repo: string } | null>();
  // Owner type is cached by owner, but only on SUCCESS: a failed lookup (offline, or the
  // unauthenticated 60/hr rate limit) is not cached, so a later `list` retries and the org
  // Projects link self-heals once the limit resets — without an agent restart.
  private readonly ownerTypes = new Map<string, 'user' | 'org'>();

  constructor(
    private readonly run: GitRunner = readOriginUrl,
    private readonly resolveOwnerType: OwnerTypeResolver = fetchOwnerType,
  ) {}

  async getGithubRepo(path: string): Promise<GithubRepoRef | null> {
    let parsed = this.repoByPath.get(path);
    if (parsed === undefined) {
      const url = await this.run(path);
      parsed = url ? parseGithubRemote(url) : null;
      this.repoByPath.set(path, parsed);
    }
    if (!parsed) return null;
    const ownerType = await this.ownerType(parsed.owner);
    return ownerType ? { ...parsed, ownerType } : { ...parsed };
  }

  private async ownerType(owner: string): Promise<'user' | 'org' | undefined> {
    const cached = this.ownerTypes.get(owner);
    if (cached) return cached;
    const type = await this.resolveOwnerType(owner);
    if (type) this.ownerTypes.set(owner, type);
    return type;
  }
}
