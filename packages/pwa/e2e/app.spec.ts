import { test, expect, type Page } from '@playwright/test';
import { openWorkspaceMenu } from './drawer';
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

test('list → open terminal → input echo → close', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);

  await page.goto('/');
  await expect(page.getByText('demo', { exact: true })).toBeVisible();

  await page.getByText('demo', { exact: true }).click();
  // xterm renders terminal output as multiple DOM spans; assert via .xterm-rows container.
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  // Opening an existing workspace leaves the terminal unfocused by design (keyboard stays
  // closed while reading — see store.autoFocus); tap it to type, as a user would.
  await page.locator('.xterm-screen').click();
  await page.keyboard.type('ls\n');
  await expect(page.locator('.xterm-rows').filter({ hasText: 'echoed' })).toBeVisible();

  await page.getByRole('button', { name: /close/i }).click();
  await expect(page.getByText('demo', { exact: true })).toBeVisible();
});

// At >=1024px the workspace list is a persistent sidebar, so a session can be switched
// while another terminal is open. The terminal must re-attach to the newly selected
// workspace and show ITS content — not stay on the previous one. (Playwright's default
// 1280px viewport exercises the wide layout.)
test('wide layout: switching workspace swaps the terminal content', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);

  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'perch-demo' })).toBeVisible();

  // The sidebar stays visible in the wide layout; pick the other workspace from it.
  await page.getByText('other', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'perch-other' })).toBeVisible();
  // The previous session's content is gone — the terminal swapped, not appended.
  await expect(page.locator('.xterm-rows').filter({ hasText: 'perch-demo' })).toHaveCount(0);
});

// When a second device attaches to the same workspace, the agent evicts the first with
// `detached: opened-elsewhere`. The first device must show an actionable overlay, not a
// dead-end: a "Take over" button reclaims the session, and the sidebar stays usable so the
// user can switch to another workspace instead.
test('opened-elsewhere overlay: take over reclaims the session', async ({ page, browser }) => {
  await seedMachine(page, agent.port);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY perch-demo' })).toBeVisible();

  // A second device attaches to the same workspace, evicting the first.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await seedMachine(otherPage, agent.port);
  await otherPage.goto('/');
  await otherPage.getByText('demo', { exact: true }).click();
  await expect(otherPage.locator('.xterm-rows').filter({ hasText: 'PERCH_READY perch-demo' })).toBeVisible();

  // The first device now shows the overlay with both actions.
  await expect(page.getByText('Opened on another device.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to list' })).toBeVisible();

  // Take over re-attaches and clears the overlay; the session is live again.
  await page.getByRole('button', { name: 'Take over' }).click();
  await expect(page.getByText('Opened on another device.')).toHaveCount(0);
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY perch-demo' })).toBeVisible();

  await other.close();
});

test('opened-elsewhere overlay: sidebar stays usable to switch workspaces', async ({ page, browser }) => {
  await seedMachine(page, agent.port);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY perch-demo' })).toBeVisible();

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await seedMachine(otherPage, agent.port);
  await otherPage.goto('/');
  await otherPage.getByText('demo', { exact: true }).click();
  await expect(page.getByText('Opened on another device.')).toBeVisible();

  // The overlay is confined to the terminal pane: clicking a workspace in the sidebar
  // still works (a full-screen overlay would intercept this click and time it out).
  await page.getByText('other', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY perch-other' })).toBeVisible();
  await expect(page.getByText('Opened on another device.')).toHaveCount(0);

  await other.close();
});

test('refresh clears the wedged display and re-attaches', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);

  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  // Put distinct output on screen, then refresh: reset() clears it and the re-attach
  // makes the (fake) agent redraw PERCH_READY again.
  await page.locator('.xterm-screen').click();
  await page.keyboard.type('ls\n');
  await expect(page.locator('.xterm-rows').filter({ hasText: 'echoed' })).toBeVisible();

  await openWorkspaceMenu(page);
  await page.getByRole('button', { name: /refresh/i }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'echoed' })).toHaveCount(0);
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();
});
