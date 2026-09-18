import { test, expect, type Page } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

// Seed a machine with a default path so the fake agent's two workspaces
// (/home/u/workspace/demo, /home/u/workspace/other) render as the project folders 'demo'
// and 'other' — and therefore as two filter pills.
async function seed(page: Page, port: number): Promise<void> {
  await page.addInitScript((p) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([
        { id: 'test', name: 'Test', url: `ws://127.0.0.1:${p}`, token: 'secret', defaultPath: '/home/u/workspace' },
      ]),
    );
  }, port);
}

test('project filter dropdown narrows the workspace list', async ({ page }) => {
  await seed(page, agent.port);
  await page.goto('/');

  // The workspace name lives in `.name`; the relative path also reads "demo", so scope to it.
  const rowName = (name: string) => page.locator('li .name', { hasText: name });

  // Both sessions show before any filter is applied; the control summarizes "All projects".
  await expect(rowName('demo')).toBeVisible();
  await expect(rowName('other')).toBeVisible();
  const filter = page.locator('summary[aria-label="Filter by project"]');
  await expect(filter).toContainText('All projects');

  // Open the dropdown and select the 'demo' project — the 'other' session is hidden.
  await filter.click();
  await page.getByRole('checkbox', { name: /demo/ }).check();
  await expect(rowName('demo')).toBeVisible();
  await expect(rowName('other')).toHaveCount(0);
  await expect(filter).toContainText('demo');

  // Unchecking it restores the full list.
  await page.getByRole('checkbox', { name: /demo/ }).uncheck();
  await expect(rowName('other')).toBeVisible();
  await expect(filter).toContainText('All projects');
});

test.describe('nested project folders', () => {
  let nested: FakeAgent;
  const at = (id: string, rel: string, createdAt: number) => ({
    machineId: 'agent-machine-id',
    id,
    name: id,
    projectPath: `/home/u/workspace/${rel}`,
    command: 'bash',
    createdAt,
    lastActivityAt: createdAt,
    status: 'idle',
  });

  test.beforeAll(async () => {
    nested = await startFakeAgent([
      at('baz-a', 'bar/baz', 1),
      at('qux-b', 'bar/qux/qux-content', 2),
      at('foo-c', 'foo', 3),
    ]);
  });
  test.afterAll(async () => {
    await nested.close();
  });

  test('selecting a parent folder shows every session in its subfolders', async ({ page }) => {
    await seed(page, nested.port);
    await page.goto('/');
    const rowName = (name: string) => page.locator('li .name', { hasText: name });
    await expect(rowName('foo-c')).toBeVisible();

    const filter = page.locator('summary[aria-label="Filter by project"]');
    await filter.click();
    await page.getByRole('checkbox', { name: /^bar\b/ }).check();
    await expect(rowName('baz-a')).toBeVisible();
    await expect(rowName('qux-b')).toBeVisible();
    await expect(rowName('foo-c')).toHaveCount(0);
    await expect(filter).toContainText('bar');
  });
});
