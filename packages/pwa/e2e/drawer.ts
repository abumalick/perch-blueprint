import { type Page } from '@playwright/test';

// The terminal header collapses its actions into the ☰ drawer. On phones the drawer
// holds everything (Refresh, Font, Files, Browser, Status, Close); on wide viewports
// Files/Browser/Status/Close stay inline in the header and only Refresh + Font live in
// the drawer. Open the drawer when the control you want isn't in the header.
export async function openWorkspaceMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu' }).click();
}

export function isWideViewport(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) >= 980;
}
