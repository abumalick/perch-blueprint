import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These tests are light (zod schemas + pure domain), but vitest still defaults to one fork
    // per core. Capped for the same reason as the PWA's -- the whole gate has to stay within a
    // memory budget. See deploy/parallelism-caps.test.sh.
    maxWorkers: 4,
  },
});
