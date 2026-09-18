import { test, expect, type Page } from '@playwright/test';

// These cover the home screen when there are no workspaces to show, for reasons other than
// "a machine is online but empty": no machines configured, and machines that can't be reached
// (the Tailscale-off / agent-down case). No fake agent is needed — the point is the *absence*
// of a reachable agent.

async function seedMachines(page: Page, machines: unknown[]): Promise<void> {
  await page.addInitScript((m) => {
    localStorage.setItem('perch.machines', JSON.stringify(m));
  }, machines);
}

test('with no machines configured, prompts to add a machine (not create a workspace)', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByTestId('home-add-machine')).toBeVisible();
  await expect(page.getByText(/create your first workspace/i)).toHaveCount(0);

  // The CTA opens Settings, where a "+ Add machine" button opens the add-machine screen.
  await page.getByRole('button', { name: /add a machine/i }).click();
  await page.getByRole('button', { name: /add machine/i }).click();
  await expect(page.getByPlaceholder('wss://mac.tailnet.ts.net')).toBeVisible();
});

test('when machines are unreachable, shows the Tailscale/reconnect screen', async ({ page }) => {
  // A machine pointed at a dead port never opens, so it lands in the unreachable state once
  // the connect grace period elapses.
  await seedMachines(page, [
    { id: 'dead', name: 'Dead', url: 'ws://127.0.0.1:59999', token: 'secret' },
  ]);
  await page.goto('/');

  // Grace period (~4s) then the unreachable screen. Never the "create a workspace" prompt.
  await expect(page.getByTestId('home-unreachable')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/tailscale/i)).toBeVisible();
  await expect(page.getByText(/create your first workspace/i)).toHaveCount(0);

  // Reconnect re-attempts: the grace clock resets, so the loading screen returns.
  await page.getByTestId('reconnect-home').click();
  await expect(page.getByTestId('home-connecting')).toBeVisible();
});
