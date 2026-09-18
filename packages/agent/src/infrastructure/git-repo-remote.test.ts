import { describe, it, expect, vi } from 'vitest';
import { parseGithubRemote, GitRepoRemote } from './git-repo-remote';

describe('parseGithubRemote', () => {
  it('parses an scp-like SSH remote', () => {
    expect(parseGithubRemote('git@github.com:someuser/perch.git')).toEqual({
      owner: 'someuser',
      repo: 'perch',
    });
  });

  it('parses an ssh:// URL remote', () => {
    expect(parseGithubRemote('ssh://git@github.com/someuser/perch.git')).toEqual({
      owner: 'someuser',
      repo: 'perch',
    });
  });

  it('parses an HTTPS remote with and without the .git suffix', () => {
    expect(parseGithubRemote('https://github.com/acme-org/widgets.git')).toEqual({
      owner: 'acme-org',
      repo: 'widgets',
    });
    expect(parseGithubRemote('https://github.com/acme-org/widgets')).toEqual({
      owner: 'acme-org',
      repo: 'widgets',
    });
  });

  it('tolerates a trailing slash and surrounding whitespace', () => {
    expect(parseGithubRemote('  https://github.com/a/b/  \n')).toEqual({ owner: 'a', repo: 'b' });
  });

  it('returns null for non-GitHub hosts', () => {
    expect(parseGithubRemote('git@gitlab.com:a/b.git')).toBeNull();
    expect(parseGithubRemote('https://bitbucket.org/a/b.git')).toBeNull();
    expect(parseGithubRemote('git@github.com.evil.com:a/b.git')).toBeNull();
  });

  it('returns null for empty or unrecognizable input', () => {
    expect(parseGithubRemote('')).toBeNull();
    expect(parseGithubRemote('not a url')).toBeNull();
    expect(parseGithubRemote('https://github.com/onlyowner')).toBeNull();
  });
});

describe('GitRepoRemote', () => {
  it('resolves owner/repo and stamps the owner type', async () => {
    const run = vi.fn().mockResolvedValue('git@github.com:Acme-Org/acme-app.git');
    const resolveType = vi.fn().mockResolvedValue('org');
    const remote = new GitRepoRemote(run, resolveType);
    expect(await remote.getGithubRepo('/p/acme')).toEqual({
      owner: 'Acme-Org',
      repo: 'acme-app',
      ownerType: 'org',
    });
    expect(run).toHaveBeenCalledWith('/p/acme');
    expect(resolveType).toHaveBeenCalledWith('Acme-Org');
  });

  it('omits ownerType when it cannot be resolved (offline/rate-limited)', async () => {
    const remote = new GitRepoRemote(async () => 'git@github.com:a/b.git', async () => undefined);
    expect(await remote.getGithubRepo('/p/a')).toEqual({ owner: 'a', repo: 'b' });
  });

  it('caches by path, resolving git only once (including null results)', async () => {
    const run = vi.fn().mockResolvedValue(null);
    const remote = new GitRepoRemote(run, async () => undefined);
    expect(await remote.getGithubRepo('/p/x')).toBeNull();
    expect(await remote.getGithubRepo('/p/x')).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries owner-type resolution after a failure, then caches the success', async () => {
    const run = vi.fn().mockResolvedValue('git@github.com:Acme-Org/acme-app.git');
    const resolveType = vi
      .fn()
      .mockResolvedValueOnce(undefined) // first list: rate-limited / offline
      .mockResolvedValueOnce('org'); // later list: limit reset
    const remote = new GitRepoRemote(run, resolveType);

    expect(await remote.getGithubRepo('/p/acme')).toEqual({ owner: 'Acme-Org', repo: 'acme-app' });
    expect(await remote.getGithubRepo('/p/acme')).toEqual({
      owner: 'Acme-Org',
      repo: 'acme-app',
      ownerType: 'org',
    });
    // The git remote is resolved once (cached by path); only the owner-type lookup retried.
    expect(run).toHaveBeenCalledTimes(1);
    expect(resolveType).toHaveBeenCalledTimes(2);
  });

  it('does not re-resolve owner type once cached (a success is sticky)', async () => {
    const resolveType = vi.fn().mockResolvedValue('org');
    const remote = new GitRepoRemote(async () => 'git@github.com:Acme-Org/acme-app.git', resolveType);
    await remote.getGithubRepo('/p/acme');
    await remote.getGithubRepo('/p/acme');
    expect(resolveType).toHaveBeenCalledTimes(1);
  });

  it('resolves owner type once per owner across repos that share it', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce('git@github.com:someuser/perch.git')
      .mockResolvedValueOnce('git@github.com:someuser/foo-app.git');
    const resolveType = vi.fn().mockResolvedValue('user');
    const remote = new GitRepoRemote(run, resolveType);
    await remote.getGithubRepo('/p/perch');
    await remote.getGithubRepo('/p/foo');
    expect(resolveType).toHaveBeenCalledTimes(1);
  });

  it('returns null when the git command yields no remote', async () => {
    const remote = new GitRepoRemote(async () => null, async () => undefined);
    expect(await remote.getGithubRepo('/p/no-git')).toBeNull();
  });
});
