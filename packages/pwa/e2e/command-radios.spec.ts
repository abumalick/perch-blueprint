import { test, expect, type Page } from '@playwright/test';
import { startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

async function openNewWorkspace(page: Page): Promise<void> {
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
  await expect(page.getByRole('heading', { name: /new workspace/i })).toBeVisible();
}

const createButton = (page: Page) => page.getByRole('button', { name: 'Create', exact: true });

test('defaults to Claude + Opus and quotes the model flag', async ({ page }) => {
  await openNewWorkspace(page);
  await expect(page.getByRole('radio', { name: 'Claude' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Opus' })).toBeChecked();
  await page.getByTestId('path').fill('demo');
  await createButton(page).click();
  await expect
    .poll(() => agent.created.at(-1))
    .toEqual({ projectPath: '/home/u/workspace/demo', command: "claude --model 'opus[1m]'" });
});

test('selecting a Claude model passes it through --model', async ({ page }) => {
  await openNewWorkspace(page);
  await page.getByRole('radio', { name: 'Sonnet' }).click();
  await page.getByTestId('path').fill('demo');
  await createButton(page).click();
  await expect.poll(() => agent.created.at(-1)?.command).toBe("claude --model 'sonnet[1m]'");
});

test('selecting Codex creates a workspace running its default model', async ({ page }) => {
  await openNewWorkspace(page);
  await page.getByRole('radio', { name: 'Codex' }).click();
  await page.getByTestId('path').fill('demo');
  await createButton(page).click();
  await expect.poll(() => agent.created.at(-1)?.command).toBe("codex --model 'gpt-5.3-codex'");
});

test('selecting ZSH creates a workspace running plain `zsh`', async ({ page }) => {
  await openNewWorkspace(page);
  await page.getByRole('radio', { name: 'ZSH' }).click();
  // ZSH has no model options.
  await expect(page.getByRole('radio', { name: 'Opus' })).toHaveCount(0);
  await page.getByTestId('path').fill('demo');
  await createButton(page).click();
  await expect.poll(() => agent.created.at(-1)?.command).toBe('zsh');
});

test('selecting Custom… reveals a free-text field and sends the typed command', async ({ page }) => {
  await openNewWorkspace(page);
  // The custom field is hidden until Custom… is chosen.
  await expect(page.getByTestId('custom-command')).toHaveCount(0);
  await page.getByRole('radio', { name: /custom/i }).click();
  await page.getByTestId('custom-command').fill('claude --resume');
  await page.getByTestId('path').fill('demo');
  await createButton(page).click();
  await expect.poll(() => agent.created.at(-1)?.command).toBe('claude --resume');
});
