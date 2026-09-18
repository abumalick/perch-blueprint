import { describe, it, expect } from 'vitest';
import { githubLinks } from './github-links';

describe('githubLinks', () => {
  it('builds the Issues URL from owner/repo', () => {
    expect(githubLinks({ owner: 'someuser', repo: 'perch' }).issues).toBe(
      'https://github.com/someuser/perch/issues',
    );
  });

  it('uses the org board list for org owners', () => {
    expect(
      githubLinks({ owner: 'Acme-Org', repo: 'acme-app', ownerType: 'org' }).projects,
    ).toBe('https://github.com/orgs/Acme-Org/projects');
  });

  it('uses the user projects page for user owners', () => {
    expect(githubLinks({ owner: 'someuser', repo: 'perch', ownerType: 'user' }).projects).toBe(
      'https://github.com/users/someuser/projects',
    );
  });

  it('falls back to the user form when ownerType is unknown', () => {
    expect(githubLinks({ owner: 'someuser', repo: 'perch' }).projects).toBe(
      'https://github.com/users/someuser/projects',
    );
  });
});
