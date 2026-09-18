import { openWorkspaceMenu } from './drawer';
import { test, expect } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

// Drags the .frame horizontally past the 60px commit threshold.
async function swipe(page: import('@playwright/test').Page, dir: 'left' | 'right') {
  const box = (await page.locator('.frame').boundingBox())!;
  const y = box.y + box.height / 2;
  const from = dir === 'left' ? box.x + box.width - 30 : box.x + 30;
  const to = dir === 'left' ? box.x + 30 : box.x + box.width - 30;
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move(to, y, { steps: 8 });
  await page.mouse.up();
}

test('swipe navigates between images and updates the counter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);

  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  await openWorkspaceMenu(page);
  await page.getByRole('button', { name: /files/i }).click();
  await page.getByRole('button', { name: /logo\.png/ }).click();

  await expect(page.locator('.frame img')).toBeVisible();
  // Folder has README.md + logo.png + photo.png → two images; logo is the first.
  await expect(page.locator('.counter')).toHaveText('1 / 2');

  // Swipe left → next image.
  await swipe(page, 'left');
  await expect(page.locator('.counter')).toHaveText('2 / 2');

  // At the last image, swiping further left is a no-op (stop at ends).
  await swipe(page, 'left');
  await expect(page.locator('.counter')).toHaveText('2 / 2');

  // Swipe right → back to the first image.
  await swipe(page, 'right');
  await expect(page.locator('.counter')).toHaveText('1 / 2');
});
