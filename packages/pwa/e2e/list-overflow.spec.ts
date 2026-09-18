import { test, expect, type Page } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

// A workspace whose name is far longer than a phone screen. The row's `.name` ellipsizes,
// but only if every flex/grid ancestor can shrink — a missing `min-width: 0` on `.name-line`
// lets the name push the row past the viewport and the whole page scrolls sideways.
test.beforeAll(async () => {
  agent = await startFakeAgent([
    {
      machineId: 'agent-machine-id',
      id: 'perch-long',
      name: 'a-very-long-workspace-session-name-that-keeps-going-and-going-forever',
      projectPath: '/home/u/workspace/a/deeply/nested/and/quite/long/project/path/here',
      command: 'bash',
      createdAt: 1,
      lastActivityAt: 1,
      status: 'needs-feedback',
    },
  ]);
});
test.afterAll(async () => {
  await agent.close();
});

async function seed(page: Page, port: number): Promise<void> {
  await page.addInitScript((p) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([
        { id: 'test', name: 'Test', url: `ws://127.0.0.1:${p}`, token: 'secret', defaultPath: '/home/u/workspace' },
      ]),
    );
  }, port);
}

// iPhone-class viewport: the single-pane mobile layout (wide sidebar kicks in at ≥1024px).
test.use({ viewport: { width: 390, height: 844 } });

test('workspace list does not scroll horizontally with a long-named session', async ({ page }) => {
  await seed(page, agent.port);
  await page.goto('/');

  await expect(page.locator('li .name')).toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
