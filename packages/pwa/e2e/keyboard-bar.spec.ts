import { test, expect, type Page } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';
import { NOTCH_PX } from '../src/core/cursor-pad';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

// Seed a machine config and open the terminal so the keyboard bar is mounted.
async function openTerminal(page: Page) {
  await page.addInitScript((port) => {
    localStorage.setItem(
      'perch.machines',
      JSON.stringify([{ id: 'test', name: 'Test', url: `ws://127.0.0.1:${port}`, token: 'secret' }]),
    );
  }, agent.port);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'PERCH_READY' })).toBeVisible();
  // Opening an existing workspace intentionally leaves the terminal unfocused (keyboard
  // closed while reading — see store.autoFocus). A real user taps the terminal to start
  // typing; do the same so the bar's focus/typing behaviour is exercised with the
  // "keyboard open".
  await page.locator('.xterm-screen').click();
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
}

function bar(page: Page) {
  return page.getByRole('toolbar', { name: 'Terminal keys' });
}

test('renders the modifier and navigation keys', async ({ page }) => {
  await openTerminal(page);
  const toolbar = bar(page);
  for (const label of ['Control', 'Option', 'Command', '⎋', '⇥', 'Cursor pad', '⌫', '⏎']) {
    await expect(toolbar.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  // The iOS coding-character keys were removed; ensure they are gone.
  for (const label of ['`', '~', '@', '$', '|']) {
    await expect(toolbar.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
});

test('tapping a key sends input to the agent', async ({ page }) => {
  await openTerminal(page);
  await bar(page).getByRole('button', { name: '⏎', exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'echoed' })).toBeVisible();
});

test('tapping a key keeps focus on the terminal (keyboard stays open)', async ({ page }) => {
  await openTerminal(page);
  await bar(page).getByRole('button', { name: '⏎', exact: true }).click();
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
});

test('Ctrl cycles off → armed → locked → off on tap', async ({ page }) => {
  await openTerminal(page);
  const ctrl = bar(page).getByRole('button', { name: 'Control', exact: true });

  await expect(ctrl).toHaveAttribute('aria-pressed', 'false');

  await ctrl.click(); // armed
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
  await expect(ctrl).not.toHaveClass(/locked/);

  await ctrl.click(); // locked (double-tap)
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
  await expect(ctrl).toHaveClass(/locked/);

  await ctrl.click(); // off
  await expect(ctrl).toHaveAttribute('aria-pressed', 'false');
});

test('armed Ctrl is consumed (one-shot) after the next character is typed', async ({ page }) => {
  await openTerminal(page);
  const ctrl = bar(page).getByRole('button', { name: 'Control', exact: true });

  await ctrl.click();
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.type('c');
  await expect(ctrl).toHaveAttribute('aria-pressed', 'false');
});

test('locked Ctrl persists after a character is typed', async ({ page }) => {
  await openTerminal(page);
  const ctrl = bar(page).getByRole('button', { name: 'Control', exact: true });

  await ctrl.click();
  await ctrl.click(); // locked
  await expect(ctrl).toHaveClass(/locked/);

  await page.keyboard.type('c');
  await expect(ctrl).toHaveClass(/locked/);
});

// The whole chain: listCommands on connect → the agent's commands reply → the drop-down →
// the bytes on the pty. The unit tests each cover one link; only this covers the protocol.
function inputs(): string[] {
  return agent.received
    .filter((m) => m.type === 'input')
    .map((m) => Buffer.from(String(m.data), 'base64').toString('utf8'));
}

test('a submit shortcut types the command and runs it', async ({ page }) => {
  await openTerminal(page);
  await bar(page).getByRole('button', { name: 'Commands' }).click();
  await page.getByRole('option', { name: '/rename' }).click();
  await expect.poll(inputs).toContain('/rename\r');
});

test('an argument-taking shortcut leaves the command in the prompt', async ({ page }) => {
  await openTerminal(page);
  await bar(page).getByRole('button', { name: 'Commands' }).click();
  await page.getByRole('option', { name: '/myplugin:task' }).click();
  await expect.poll(inputs).toContain('/myplugin:task ');
});

// Only an end-to-end run proves the whole chain: pointer drag → cursor-pad reducer →
// applyEditKey → websocket → pty bytes.
test('dragging the cursor pad sends one arrow per notch', async ({ page }) => {
  await openTerminal(page);
  const pad = bar(page).getByRole('button', { name: 'Cursor pad' });
  const box = await pad.boundingBox();
  if (!box) throw new Error('cursor pad has no bounding box');
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + 3 * NOTCH_PX, y, { steps: 6 });
  await page.mouse.up();

  await expect.poll(() => inputs().filter((i) => i === '\x1b[C').length).toBe(3);
});

// The pad is the only bar control with its own pointer handling and pointer capture, so
// it needs its own proof of the bar's central invariant: never steal focus from the
// terminal textarea, or the soft keyboard closes mid-edit.
test('dragging the cursor pad keeps focus on the terminal (keyboard stays open)', async ({
  page,
}) => {
  await openTerminal(page);
  const pad = bar(page).getByRole('button', { name: 'Cursor pad' });
  const box = await pad.boundingBox();
  if (!box) throw new Error('cursor pad has no bounding box');
  const y = box.y + box.height / 2;

  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 40, y, { steps: 4 });
  await page.mouse.up();

  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
});

// jsdom has no layout, so the unit tests cannot see that the bar is a horizontal
// scroller which would otherwise swallow the drag. `touch-action: none` is the guard.
test('the cursor pad opts out of the touch scrolling of the bar', async ({ page }) => {
  await openTerminal(page);
  await expect(bar(page).getByRole('button', { name: 'Cursor pad' })).toHaveCSS(
    'touch-action',
    'none',
  );
});

// Tapping a shortcut must not close the soft keyboard.
test('picking a command keeps the terminal focused', async ({ page }) => {
  await openTerminal(page);
  await bar(page).getByRole('button', { name: 'Commands' }).click();
  await page.getByRole('option', { name: '/rename' }).click();
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
});
