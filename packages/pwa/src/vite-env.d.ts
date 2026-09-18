/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected at build time by vite's `define` (see vite.config.ts). The slug of the
// build currently being served, or 'main' for a normal production build.
declare const __PERCH_BUILD_LABEL__: string;
