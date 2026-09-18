import { test, expect, type Page } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';

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

// This covers the one seam the unit tests structurally cannot: the field has to survive the
// zod parse on the way in. The schema strips unknown keys, so an omission there deletes an
// agent-sent field silently — green unit tests on both sides, no badge in the browser.
// The `demo` workspace carries an address from the fake agent; `other` carries none.
test('a workspace shows the agent address its agent sent, and none when there is none', async ({
  page,
}) => {
  await seedMachine(page, agent.port);
  await page.goto('/');

  const demoRow = page.locator('li', { hasText: 'demo' }).first();
  await expect(demoRow.getByTestId('agent-address')).toHaveText('demo-7f');

  const otherRow = page.locator('li', { hasText: 'other' }).first();
  await expect(otherRow.getByTestId('agent-address')).toHaveCount(0);
});
