import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { buildVersionJson, VERSION_FILE } from './src/core/version-file';

const buildLabel = process.env.PERCH_BUILD_LABEL ?? 'main';
// A per-build id (timestamp) that changes on every build, even a rebuild of the same
// commit, written to version.json — the label alone can't distinguish two `main` builds.
const buildId = process.env.PERCH_BUILD_ID ?? String(Date.now());

// Emit version.json at the site root with the build label and id, so a running PWA can
// read the *incoming* build's identity when an update is waiting. Kept out of the SW
// precache (json is not in workbox's default globPatterns) so the fetch always hits the
// network.
function emitVersionFile(label: string, id: string): Plugin {
  return {
    name: 'perch-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: VERSION_FILE, source: buildVersionJson(label, id) });
    },
  };
}

export default defineConfig({
  plugins: [
    svelte(),
    emitVersionFile(buildLabel, buildId),
    VitePWA({
      // 'prompt', not 'autoUpdate': the new worker waits instead of reloading on its own.
      // main.ts surfaces a banner and reloads only on the user's tap (see UpdateBanner).
      registerType: 'prompt',
      // We register the SW ourselves in main.ts so we can poll for updates
      // (detect a new build in an OPEN app, not just on next launch).
      injectRegister: false,
      // Add one imported script to the Workbox-generated SW: it claims the Web Share Target
      // POST (`/share-target`) and lets every other request fall through to Workbox's router
      // (a POST is never a navigation GET, so they don't contend). Keeps `generateSW` and the
      // existing precache/update machinery untouched. Android-only in effect; inert on iOS.
      workbox: {
        importScripts: ['share-target-sw.js'],
      },
      manifest: {
        name: 'Perch',
        short_name: 'Perch',
        theme_color: '#111111',
        background_color: '#111111',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Register Perch as an Android share target so "Share → Perch" from any app POSTs the
        // image to the SW helper (share-target-sw.js). Ignored by iOS WebKit (no Web Share Target).
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{ name: 'file', accept: ['*/*'] }],
          },
        },
      },
    }),
  ],
  // Slug of the build being produced, surfaced in the UI so we know which build a
  // device is serving. 'main' for normal builds; `pnpm serve:build` sets it to a
  // worktree slug when temporarily serving a test build (see docs/WORKTREES.md).
  define: {
    __PERCH_BUILD_LABEL__: JSON.stringify(buildLabel),
  },
  // Svelte 5's mount() needs the 'browser' export condition under vitest/jsdom; vitest does not honor test.resolve.conditions, so this must stay top-level. Harmless for the production build (a browser app already resolves the browser condition).
  resolve: {
    conditions: ['browser'],
  },
  // `vite preview` (used by deploy/run-pwa.sh) is fronted by `tailscale serve` and bound to
  // loopback, so the tailnet Host header must be allowed (vite's anti-DNS-rebinding check would
  // otherwise 403 it). Safe here: only localhost + tailscale serve reach the loopback listener.
  preview: {
    allowedHosts: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest-setup.ts'],
    include: ['src/**/*.test.ts'],
    globals: true,
    // Bound the worker count. Uncapped, vitest runs one fork per core and each jsdom+Svelte+
    // xterm worker holds over a gigabyte, so the suite alone can claim most of a machine's
    // memory. The gate runs on every commit and is not the only thing running, so a
    // predictable ceiling is worth more than the last few seconds of wall-clock.
    // Guarded by deploy/parallelism-caps.test.sh.
    maxWorkers: 4,
  },
});
