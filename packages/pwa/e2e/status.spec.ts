import { test, expect, type Page } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';

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

// Switching a workspace's status from the terminal header picker re-sorts the list: setting
// it to "Blocked" parks it at the bottom; setting it back to "Needs you" restores the top.
// (Default 1280px viewport keeps the list visible as a sidebar while the terminal is open.)
test('status picker re-sorts the workspace; blocked parks it last', async ({ page }) => {
  await seedMachine(page, agent.port);
  await page.goto('/');

  const rowNames = page.locator('.row .name');
  // Initial order: demo (needs-feedback) is first, other (idle) last.
  await expect(rowNames).toHaveText(['demo', 'other']);

  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  // The header pill shows the current status; open it and pick Blocked.
  await page.getByRole('button', { name: /status: needs you/i }).click();
  await page.getByRole('option', { name: /blocked/i }).click();

  // demo is now parked: it shows the Blocked badge and sinks below the idle workspace.
  await expect(page.locator('.badge', { hasText: 'Blocked' })).toBeVisible();
  await expect(rowNames).toHaveText(['other', 'demo']);

  // The pill now reads Blocked; switch back to Needs you to restore demo to the top.
  await page.getByRole('button', { name: /status: blocked/i }).click();
  await page.getByRole('option', { name: /needs you/i }).click();
  await expect(page.locator('.badge', { hasText: 'Blocked' })).toHaveCount(0);
  await expect(rowNames).toHaveText(['demo', 'other']);
});
