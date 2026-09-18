import { test, expect } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';

// Boot- and reload-gated assertions can be slow when many WebKit workers cold-start at once
// (the gate runs the whole suite in parallel). The default 5s is a false-negative risk under
// that contention, so give these a generous ceiling — the assertions still resolve fast when
// the app is warm; this only prevents a spurious timeout under peak load.
const BOOT = { timeout: 15_000 };

let agent: FakeAgent;
test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);
});

// The Android Web Share Target path, tested app-side: the SW helper (Blink-only, not
// exercisable on the WebKit gate) merely stashes the shared file in the Cache API, so we
// seed that cache directly and assert the app picks it up on boot.
test('a shared file surfaces a Home banner and attaches to the session that is opened', async ({ page }) => {
  await page.goto('/');
  // Wait for the app to boot+connect. With mount deferred until the boot-time cache read
  // settles (see main.ts), 'demo' being visible proves that read has run — so the seed below
  // cannot be consumed by a still-in-flight first-boot read, and the "no banner yet" check
  // isn't trivially true pre-render.
  await expect(page.getByText('demo', { exact: true })).toBeVisible(BOOT);
  await expect(page.getByTestId('shared-file-banner')).toHaveCount(0);

  // Wait for the service worker to finish installing (it precaches ~600 KB into CacheStorage
  // on first load). Seeding our tiny entry *concurrently* with that bulk write races WebKit's
  // CacheStorage and the entry can be lost across the reload — so let the precache settle first.
  await page.evaluate(() => navigator.serviceWorker?.ready);

  // Stash a shared file exactly as the share-target SW would, then reload so the app reads it.
  await page.evaluate(async () => {
    const cache = await caches.open('perch-shared');
    await cache.put(
      '/shared-file',
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'content-type': 'image/png', 'x-filename': 'shared.png' },
      }),
    );
  });
  await page.reload();

  // Gate on the same boot milestone: once 'demo' is listed the boot-time cache read has run,
  // so the banner is deterministically present regardless of load.
  await expect(page.getByText('demo', { exact: true })).toBeVisible(BOOT);
  await expect(page.getByTestId('shared-file-banner')).toBeVisible(BOOT);

  // Open a session: the pending file flushes via putFile -> fileStored -> input, and the fake
  // agent echoes on input, proving the round-trip. The banner then clears.
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows')).toContainText('echoed', BOOT);
  await expect(page.getByTestId('shared-file-banner')).toHaveCount(0);

  // Attaching consumes the cache entry (deleted on flush, not on read), so a later boot
  // won't offer the same file again.
  const stillCached = await page.evaluate(async () => !!(await (await caches.open('perch-shared')).match('/shared-file')));
  expect(stillCached).toBe(false);
});

test('the attach-file button uploads a picked file and types the saved path', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('demo', { exact: true })).toBeVisible(BOOT);
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible(BOOT);

  await page.setInputFiles('input[type="file"]', {
    name: 'pic.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71]),
  });

  await expect(page.locator('.xterm-rows')).toContainText('echoed');
});

// The whole point of the change: an archive is not an image and must still upload. The
// picker carries no `accept`, so nothing filters it out on the way in.
test('the attach-file button uploads a non-image file', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('demo', { exact: true })).toBeVisible(BOOT);
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible(BOOT);

  await expect(page.locator('input[type="file"]')).not.toHaveAttribute('accept', /.*/);

  await page.setInputFiles('input[type="file"]', {
    name: 'bundle.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  });

  await expect(page.locator('.xterm-rows')).toContainText('echoed');
});
