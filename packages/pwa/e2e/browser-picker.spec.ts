import { test, expect } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';
import { openWorkspaceMenu, isWideViewport } from './drawer';

// Two agent-browser sessions attached to the demo workspace: a bare-name one (shown as
// "main") and a `<wsid>__<slug>` one (shown as "login"). The browser icon must then offer a
// picker instead of opening one directly.
let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent(undefined, [{ name: 'perch-demo' }, { name: 'perch-demo__login' }]);
});
test.afterAll(async () => {
  await agent.close();
});

test('the browser icon opens a picker when the workspace has several sessions', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  if (!isWideViewport(page)) {
    await openWorkspaceMenu(page);
  }
  // Two sessions → the trigger drops a menu rather than opening one directly.
  await page.getByRole('button', { name: /browser \(2\)/i }).click();

  const menu = page.getByRole('menu', { name: 'Browser sessions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'main' })).toBeVisible();
  await expect(page.getByLabel('URL')).toHaveCount(0);

  // Choosing one opens its browser view.
  await menu.getByRole('menuitem', { name: 'login' }).click();
  await expect(page.getByLabel('URL')).toHaveValue('https://example.com/');
});
