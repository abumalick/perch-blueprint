import { test, expect } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;
test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

test('pasting a clipboard image uploads it and types the saved path', async ({ page }) => {
  // Seed the machine (as app.spec does) and stub clipboard.read to surface a PNG so the
  // real paste handler runs (a real image on the clipboard isn't reliably scriptable).
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);
  await page.addInitScript(() => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    Object.defineProperty(navigator.clipboard, 'read', {
      configurable: true,
      value: async () => [
        { types: ['image/png'], getType: async () => new Blob([bytes], { type: 'image/png' }) },
      ],
    });
  });

  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  await page.getByRole('button', { name: 'Paste' }).click();

  // sendPutFile -> fileStored(.tmp/files/pasted-image.png) -> sendInput(path) -> fake agent
  // echoes on input, proving the full round-trip fired.
  await expect(page.locator('.xterm-rows')).toContainText('echoed');
});
