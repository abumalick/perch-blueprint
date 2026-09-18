import { test, expect } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

// Desktop copy-on-select: dragging the mouse over terminal text selects it (xterm's
// native selection, since the fake agent isn't in mouse-tracking mode) and on release
// it lands on the clipboard with no keypress. We stub writeText to capture it
// (granting real clipboard permission is flakier than asserting the call).
test('a mouse drag copies the selected text to the clipboard on release', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: (t: string) => {
        (window as unknown as { __copied: string[] }).__copied.push(t);
        return Promise.resolve();
      },
    });
  });

  // The first rendered row holds "PERCH_READY perch-demo"; drag across that exact line.
  const row = page.locator('.xterm-rows > div').first();
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.length))
    .toBeGreaterThan(0);
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied.at(-1)).toContain('PERCH_READY');
  await expect(page.getByText('Copied')).toBeVisible();
});
