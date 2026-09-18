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

test('open browser → descend → up → back to terminal', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);

  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  // Open the file browser from the terminal header. demo's projectPath is /home/u/workspace/demo.
  await page.getByRole('button', { name: /files/i }).click();
  await expect(page.getByText('README.md')).toBeVisible();
  // At the root there is no Up row.
  await expect(page.getByRole('button', { name: /up one level/i })).toHaveCount(0);

  // Descend into src/.
  await page.getByRole('button', { name: 'src', exact: true }).click();
  await expect(page.getByRole('button', { name: /up one level/i })).toBeVisible();

  // Ascend back to the root.
  await page.getByRole('button', { name: /up one level/i }).click();
  await expect(page.getByRole('button', { name: /up one level/i })).toHaveCount(0);

  // Open a file → the viewer shows its contents → Back returns to the browser.
  await page.getByRole('button', { name: /README\.md/ }).click();
  await expect(page.getByText(/contents of .*README\.md/)).toBeVisible();
  await page.getByRole('button', { name: /back/i }).click();
  await expect(page.getByRole('button', { name: /README\.md/ })).toBeVisible();

  // Return to the terminal.
  await page.getByRole('button', { name: /back/i }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();
});

test('open an image → image viewer renders it', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);

  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  await page.getByRole('button', { name: /files/i }).click();
  await page.getByRole('button', { name: /logo\.png/ }).click();

  const img = page.locator('.frame img');
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('src', /^blob:/);

  // Back returns to the browser, not the text viewer.
  await page.getByRole('button', { name: /back/i }).click();
  await expect(page.getByRole('button', { name: /logo\.png/ })).toBeVisible();
});

test('open a markdown file → rendered prose on a phone, with a raw toggle', async ({ page }) => {
  // Same sizing trap as the image viewer: the narrow layout's <main> has no height, so the
  // prose frame is viewport-sized. jsdom has no layout, so only this catches a collapse.
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
  await page.getByRole('button', { name: /README\.md/ }).click();

  const heading = page.locator('.prose h1');
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(/contents of .*README\.md/);
  const box = await page.locator('.prose').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(50);

  // Raw shows the markdown source, hashes and all.
  await page.getByRole('button', { name: /raw source/i }).click();
  await expect(page.locator('.prose')).toHaveCount(0);
  await expect(page.locator('.content')).toContainText('# contents of');
});

test('image viewer fills real height on a phone-width viewport', async ({ page }) => {
  // The narrow layout's <main> has no explicit height, so a percentage-height frame would
  // collapse to 0 (image invisible). Guard the viewport-based sizing that fixes it.
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
  const box = await page.locator('.frame').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(200);
});

test('open an audio file → audio viewer mounts an <audio> player with a blob URL', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);

  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  await page.getByRole('button', { name: /files/i }).click();
  await page.getByRole('button', { name: /clip\.mp3/ }).click();

  const audio = page.locator('audio');
  await expect(audio).toHaveAttribute('src', /^blob:/);

  // Back returns to the browser, not the text viewer.
  await page.getByRole('button', { name: /back/i }).click();
  await expect(page.getByRole('button', { name: /clip\.mp3/ })).toBeVisible();
});

test('audio player steps to the next/previous track by filename', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);

  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  await page.getByRole('button', { name: /files/i }).click();
  // Audio files sorted by name: clip.mp3, song-a.mp3, song-b.mp3 → clip is 1 / 3.
  await page.getByRole('button', { name: /clip\.mp3/ }).click();
  await expect(page.getByText('1 / 3')).toBeVisible();
  await expect(page.getByRole('button', { name: /previous track/i })).toBeDisabled();

  await page.getByRole('button', { name: /next track/i }).click();
  await expect(page.getByText('2 / 3')).toBeVisible();
  await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);

  await page.getByRole('button', { name: /previous track/i }).click();
  await expect(page.getByText('1 / 3')).toBeVisible();
});

test('open a pdf → pdf viewer mounts an iframe with a blob URL, sized on a phone', async ({ page }) => {
  // Phone-width to also guard the viewport-based sizing (a percentage-height iframe would
  // collapse to 0 in the narrow layout's height-less <main>).
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
  await page.getByRole('button', { name: /report\.pdf/ }).click();

  const frame = page.locator('iframe.frame');
  await expect(frame).toHaveAttribute('src', /^blob:/);
  const box = await frame.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(200);

  // Back returns to the browser, not the text viewer.
  await page.getByRole('button', { name: /back/i }).click();
  await expect(page.getByRole('button', { name: /report\.pdf/ })).toBeVisible();
});
