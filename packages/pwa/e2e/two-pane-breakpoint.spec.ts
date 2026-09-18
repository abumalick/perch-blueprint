import { test, expect } from '@playwright/test';

// The persistent two-pane layout (workspace list as a left sidebar beside the active
// view) turns on at ≥980px. The threshold sits in the gap between the widest phones in
// landscape (~956px) and a small tablet in landscape (~1007px): the tablet gets the
// sidebar, phones stay single-pane.
// The gate is viewport-only (App.svelte `{#if wide}`), so no agent/machine is needed.

test('tablet landscape (1007px) shows the two-pane sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1007, height: 529 });
  await page.goto('/');
  await expect(page.locator('.layout .sidebar')).toBeVisible();
});

test('phone landscape (956px) stays single-pane (no sidebar)', async ({ page }) => {
  await page.setViewportSize({ width: 956, height: 430 });
  await page.goto('/');
  await expect(page.locator('.sidebar')).toHaveCount(0);
});
