import { test, expect } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

test('New workspace → Browse → descend → Use this folder fills the path', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([
        { id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret', defaultPath: '/home/u/workspace' },
      ]),
    );
  }, agent.port);

  await page.goto('/');
  // Open the New-workspace form from the list header.
  await page.getByRole('button', { name: /^new$/i }).click();
  await expect(page.getByRole('heading', { name: /new workspace/i })).toBeVisible();

  // Open the folder picker; the fake agent answers browseDir with a `src` subfolder.
  // Exact name: the wide layout keeps the home list visible beside the form, so a loose
  // /browse/i could match a stray browser-related control there.
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page.getByRole('button', { name: /use this folder/i })).toBeVisible();
  // At the root there is no Up row.
  await expect(page.getByRole('button', { name: /up one level/i })).toHaveCount(0);

  // Descend into src/, then pick it.
  await page.getByRole('button', { name: 'src', exact: true }).click();
  await expect(page.getByRole('button', { name: /up one level/i })).toBeVisible();
  await page.getByRole('button', { name: /use this folder/i }).click();

  // Back on the form: the path is filled relative to the default, and the preview resolves.
  await expect(page.getByTestId('path')).toHaveValue('src');
  await expect(page.getByTestId('resolved-preview')).toHaveText('→ /home/u/workspace/src');
});

test('New workspace → Browse → New folder creates it, browses in, and fills the path', async ({ page }) => {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([
        { id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret', defaultPath: '/home/u/workspace' },
      ]),
    );
  }, agent.port);

  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).click();
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page.getByRole('button', { name: /use this folder/i })).toBeVisible();

  // Create a new folder in the current directory; the fake agent replies with a dirEntries
  // for the new folder, so the picker browses into it.
  await page.getByRole('button', { name: /new folder/i }).click();
  await page.getByRole('textbox', { name: /folder name/i }).fill('fresh');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  // We are now inside the new folder (Up row appears); pick it.
  await expect(page.getByRole('button', { name: /up one level/i })).toBeVisible();
  await page.getByRole('button', { name: /use this folder/i }).click();

  await expect(page.getByTestId('path')).toHaveValue('fresh');
  await expect(page.getByTestId('resolved-preview')).toHaveText('→ /home/u/workspace/fresh');
});
