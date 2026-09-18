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

// Desktop / macOS path: the link is opened by clicking a synthetic external <a> (which
// Safari's macOS web app hands off to the default browser). We can't observe that OS
// handoff in CI, so we capture the href of the anchor the handler builds and clicks.
async function spyOnAnchorOpens(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      (window as unknown as { __opened: string[] }).__opened.push(this.href);
    };
  });
  return () => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
}

// iOS path: the handler uses window.open() with no args, then sets location.href on the
// returned window. The spy returns a window-like object and captures the href.
async function spyOnOpenedLinks(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = (() => {
      const fake = { opener: {} as unknown, location: {} as { href?: string } };
      Object.defineProperty(fake.location, 'href', {
        set(v: string) {
          (window as unknown as { __opened: string[] }).__opened.push(v);
        },
      });
      return fake as unknown as Window;
    }) as typeof window.open;
  });
  return () => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
}

// OSC 8 hyperlinks (a short label carrying a hidden URL, e.g. Claude Code's file/doc
// links) are inert in xterm unless the terminal is given a linkHandler. This guards that
// tapping such a link opens its URL — the real-device regression that motivated the fix.
test('OSC 8 hyperlink opens via an external anchor on desktop', async ({ page }) => {
  await seedMachine(page, agent.port);
  const opened = await spyOnAnchorOpens(page);

  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();

  const link = page.locator('.xterm-rows').getByText('OSC8LINK', { exact: false });
  await expect(link).toBeVisible();
  await link.click();

  await expect.poll(opened).toContain('https://example.com/osc8');
});

// The iPhone path: an iOS user agent makes the handler take the window.open() route (the
// popup-safe pattern), via a real touch tap — where the terminal's custom touch-scroll
// handling could otherwise swallow the tap.
test.describe('touch (iOS)', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });

  test('OSC 8 hyperlink opens on a touch tap', async ({ page }) => {
    await seedMachine(page, agent.port);
    const opened = await spyOnOpenedLinks(page);

    await page.goto('/');
    await page.getByText('demo', { exact: true }).tap();

    const link = page.locator('.xterm-rows').getByText('OSC8LINK', { exact: false });
    await expect(link).toBeVisible();
    await link.tap();

    await expect.poll(opened).toContain('https://example.com/osc8');
  });
});
