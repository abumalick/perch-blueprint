import { test, expect } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

// The select-mode toggle must actually re-enable text selection on xterm's rows —
// a CSS effect jsdom can't verify, so it's asserted here in a real browser.
test('select-mode toggle flips user-select on the terminal rows', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);

  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  // WebKit's getComputedStyle doesn't expose the camelCase `userSelect` key (returns
  // undefined); it reflects the effective value under the prefixed property, which the
  // component sets alongside the standard one. Read the prefixed one first.
  const userSelect = () =>
    page.locator('.xterm-rows').evaluate((el) => {
      const s = getComputedStyle(el);
      return s.getPropertyValue('-webkit-user-select') || s.getPropertyValue('user-select');
    });
  const toggle = page.getByRole('button', { name: /select text/i });

  expect(await userSelect()).toBe('none');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await userSelect()).toBe('text');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await userSelect()).toBe('none');
});
