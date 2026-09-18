import { test, expect, type Page } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';
import { openWorkspaceMenu } from './drawer';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

async function seedMachine(page: Page, port: number): Promise<void> {
  await page.addInitScript((p) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${p}`, token: 'secret' }]),
    );
  }, port);
}

// The New workspace row is phone-only: the wide layout's persistent sidebar already has a ＋.
test.use({ viewport: { width: 390, height: 844 } });

test('the drawer creates a new workspace from inside an existing one, and Back returns to it', async ({ page }) => {
  await seedMachine(page, agent.port);
  await page.goto('/');

  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  await openWorkspaceMenu(page);
  await page.getByRole('button', { name: /new workspace/i }).click();

  await expect(page.getByRole('heading', { name: 'New workspace' })).toBeVisible();

  // Backing out returns to the workspace we came from — not the home list — and the
  // terminal remounts against the still-live attachment.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();
});

test('the wide layout omits the drawer row, keeping the sidebar ＋ as the single entry point', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await seedMachine(page, agent.port);
  await page.goto('/');

  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  await openWorkspaceMenu(page);
  await expect(page.getByRole('button', { name: /new workspace/i })).toHaveCount(0);
});
