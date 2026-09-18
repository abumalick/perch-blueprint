import { defineConfig, devices } from '@playwright/test';

// Port is overridable (E2E_PORT) so the suite can run when the default 4173 is
// already taken by a local preview/deployment.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  // Each worker is a full WebKit browser; playwright otherwise defaults to half the cores.
  // Part of keeping the commit gate's total memory bounded -- see deploy/parallelism-caps.test.sh.
  workers: 2,
  webServer: {
    command: `pnpm vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
  use: { baseURL: `http://localhost:${port}` },
  // The Perch client is exclusively WebKit (iPhone/iPad/Safari, all iOS browsers). Run the
  // suite on WebKit only — Chromium would exercise an engine no user actually runs, and it
  // missed a WebKit-specific bug (send on a still-CONNECTING socket throws). Desktop Safari
  // keeps the 1280x720 desktop viewport the specs assume; narrow specs set their own.
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }],
});
