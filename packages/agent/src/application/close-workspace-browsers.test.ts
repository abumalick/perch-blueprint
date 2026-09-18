import { describe, it, expect } from 'vitest';
import { closeWorkspaceBrowserSessions } from './close-workspace-browsers';
import type { BrowserDiscoveryPort } from '../ports/browser-discovery-port';

function discovery(names: string[]): BrowserDiscoveryPort {
  return { listSessions: async () => names.map((name, i) => ({ name, streamPort: 4000 + i })) };
}

describe('closeWorkspaceBrowserSessions', () => {
  it('stops only the sessions belonging to the workspace', async () => {
    const stopped: string[] = [];
    await closeWorkspaceBrowserSessions(
      {
        discovery: discovery(['perch-a', 'perch-a__login', 'perch-b', 'github']),
        commands: { stop: async (n) => void stopped.push(n) },
      },
      'perch-a',
    );
    expect(stopped).toEqual(['perch-a', 'perch-a__login']);
  });

  it('is best-effort: a failed stop does not reject or block the others', async () => {
    const stopped: string[] = [];
    await expect(
      closeWorkspaceBrowserSessions(
        {
          discovery: discovery(['perch-a__one', 'perch-a__two']),
          commands: {
            stop: async (n) => {
              if (n === 'perch-a__one') throw new Error('stop failed');
              stopped.push(n);
            },
          },
        },
        'perch-a',
      ),
    ).resolves.toBeUndefined();
    expect(stopped).toEqual(['perch-a__two']);
  });

  it('does nothing when discovery fails', async () => {
    const stopped: string[] = [];
    await expect(
      closeWorkspaceBrowserSessions(
        {
          discovery: { listSessions: async () => { throw new Error('no agent-browser'); } },
          commands: { stop: async (n) => void stopped.push(n) },
        },
        'perch-a',
      ),
    ).resolves.toBeUndefined();
    expect(stopped).toEqual([]);
  });

  it('stops nothing when no session matches', async () => {
    const stopped: string[] = [];
    await closeWorkspaceBrowserSessions(
      { discovery: discovery(['perch-b', 'github']), commands: { stop: async (n) => void stopped.push(n) } },
      'perch-a',
    );
    expect(stopped).toEqual([]);
  });
});
