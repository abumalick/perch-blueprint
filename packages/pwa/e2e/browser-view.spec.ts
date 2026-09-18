import { test, expect, type Page } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';
import { openWorkspaceMenu, isWideViewport } from './drawer';

// The fake's canned frame metadata — coordinate assertions are bounds-checked against it.
const DEVICE_W = 1280;
const DEVICE_H = 720;

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});
test.beforeEach(() => {
  agent.browserReceived.length = 0;
});

// Opens the demo workspace, then its attached browser session via the header 🌐 chip,
// and waits for the stream to be online (the fake's `url` message fills the URL bar).
async function openBrowserView(page: Page): Promise<void> {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();
  // The single-session BrowserPicker opens the viewer directly. Wide: inline in the header;
  // phone: inside the drawer. Its accessible name is "Browser".
  if (!isWideViewport(page)) {
    await openWorkspaceMenu(page);
  }
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await expect(page.getByLabel('URL')).toHaveValue('https://example.com/');
}

test('browser chip opens the view with a visibly sized canvas', async ({ page }) => {
  await openBrowserView(page);
  const canvas = page.locator('.browser-view canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
});

test('phone-width layout keeps the canvas visibly sized', async ({ page }) => {
  // Guards the known phone-layout collapse: a percentage frame height inside the narrow
  // layout's height-less <main> collapses the canvas to 0.
  await page.setViewportSize({ width: 390, height: 844 });
  await openBrowserView(page);
  const canvas = page.locator('.browser-view canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
});

test('canvas tap sends a mousePressed/mouseReleased pair with in-bounds device coordinates', async ({ page }) => {
  await openBrowserView(page);
  // Click at the canvas center: the letterboxed frame is centered, so the canvas center
  // always maps to the device center regardless of viewport size.
  await page.locator('.browser-view canvas').click();
  await expect
    .poll(() =>
      agent.browserReceived
        .map((r) => r.message)
        .filter((m) => m.type === 'input_mouse')
        .map((m) => m.eventType),
    )
    // The leading mouseMoved settles hover at the tap point before the click lands.
    .toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
  const taps = agent.browserReceived
    .map((r) => r.message as { type: string; x?: number; y?: number })
    .filter((m) => m.type === 'input_mouse');
  for (const tap of taps) {
    expect(tap.x).toBeGreaterThanOrEqual(0);
    expect(tap.x).toBeLessThanOrEqual(DEVICE_W);
    expect(tap.y).toBeGreaterThanOrEqual(0);
    expect(tap.y).toBeLessThanOrEqual(DEVICE_H);
    // Canvas center → device center.
    expect(tap.x).toBeCloseTo(DEVICE_W / 2, 0);
    expect(tap.y).toBeCloseTo(DEVICE_H / 2, 0);
  }
});

test('URL bar submit sends navigate with the normalized URL', async ({ page }) => {
  await openBrowserView(page);
  await page.getByLabel('URL').fill('example.org');
  await page.getByRole('button', { name: 'Go' }).click();
  await expect
    .poll(() => agent.browserReceived.map((r) => r.message).find((m) => m.type === 'navigate'))
    .toEqual({ type: 'navigate', url: 'https://example.org' });
});

test('opening the view sends setViewport matching the canvas region size', async ({ page }) => {
  await openBrowserView(page);
  const box = (await page.locator('.browser-view canvas').boundingBox())!;
  await expect
    .poll(() => agent.browserReceived.map((r) => r.message).find((m) => m.type === 'setViewport'))
    .toBeDefined();
  const vp = agent.browserReceived.map((r) => r.message).find((m) => m.type === 'setViewport') as {
    width: number;
    height: number;
  };
  expect(Number.isInteger(vp.width)).toBe(true);
  expect(Number.isInteger(vp.height)).toBe(true);
  expect(vp.width).toBeGreaterThan(0);
  expect(vp.height).toBeGreaterThan(0);
  expect(Math.abs(vp.width - box.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(vp.height - box.height)).toBeLessThanOrEqual(2);
});

test('browser back button sends back', async ({ page }) => {
  await openBrowserView(page);
  await page.getByRole('button', { name: 'Browser back', exact: true }).click();
  await expect.poll(() => agent.browserReceived.some((r) => r.message.type === 'back')).toBe(true);
});

test('Close session sends closeSession and exits to the workspace', async ({ page }) => {
  await openBrowserView(page);
  await page.getByRole('button', { name: 'Close session', exact: true }).click();
  await expect.poll(() => agent.browserReceived.some((r) => r.message.type === 'closeSession')).toBe(true);
  // Back on the workspace terminal (the view was opened from it).
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();
  await expect(page.getByLabel('URL')).toHaveCount(0);
});

test('phone-width layout keeps the keyboard bar fully on screen', async ({ page }) => {
  // Guards the layout fix: the old fixed-height frame pushed the KeyboardBar below the fold.
  await page.setViewportSize({ width: 390, height: 844 });
  await openBrowserView(page);
  const bar = page.locator('.browser-view [role="toolbar"]');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('opening the session on a second device kicks the first with opened-elsewhere', async ({ page, browser }) => {
  await openBrowserView(page);
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await openBrowserView(otherPage);
  // The first viewer is evicted (same UX as the terminal's opened-elsewhere, incl. Retry
  // to take the session back); the second streams fine.
  await expect(page.getByText('Opened on another device.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(otherPage.getByLabel('URL')).toHaveValue('https://example.com/');
  await other.close();
});

test('a transient stream drop reconnects automatically, no ended overlay', async ({ page }) => {
  await openBrowserView(page);
  const authCount = () => agent.browserReceived.filter((r) => r.message.type === 'auth').length;
  const before = authCount();
  agent.closeBrowserSockets();
  // A bare socket drop (idle-proxy timeout, network blip) is transient: the viewer never
  // shows the dead-end overlay and never needs a manual Retry — it re-auths on a fresh
  // socket on its own and comes back online.
  await expect.poll(authCount).toBeGreaterThan(before);
  await expect(page.getByText('Browser session ended.')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeHidden();
  await expect(page.getByLabel('URL')).toHaveValue('https://example.com/');
});
