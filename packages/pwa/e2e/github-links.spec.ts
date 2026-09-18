import { test, expect, type Page } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';
import { openWorkspaceMenu } from './drawer';

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

// The `demo` workspace carries an org github remote (Acme-Org/acme-app) from the fake
// agent, so its drawer offers external Issues and Projects links — and an org owner routes
// Projects to the /orgs board list, not the profile page. The `other` workspace has no github
// remote, so its drawer shows neither.
test('drawer shows GitHub Issues/Projects links, routing an org to its board list', async ({ page }) => {
  await seedMachine(page, agent.port);
  await page.goto('/');

  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  await openWorkspaceMenu(page);

  const issues = page.getByRole('link', { name: /issues/i });
  const projects = page.getByRole('link', { name: /projects/i });
  await expect(issues).toHaveAttribute('href', 'https://github.com/Acme-Org/acme-app/issues');
  await expect(projects).toHaveAttribute('href', 'https://github.com/orgs/Acme-Org/projects');
  await expect(issues).toHaveAttribute('target', '_blank');
});

test('drawer omits the GitHub links for a workspace with no github remote', async ({ page }) => {
  await seedMachine(page, agent.port);
  await page.goto('/');

  await page.getByText('other', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();

  await openWorkspaceMenu(page);

  await expect(page.getByRole('link', { name: /issues/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /projects/i })).toHaveCount(0);
});
