import '@testing-library/jest-dom/vitest';

// jsdom has no Web Animations API. Svelte's animate:flip directive unconditionally calls
// element.getAnimations() (regardless of transition duration) before repositioning a row,
// so any test that reduces the workspace list needs this stubbed to a no-op.
if (typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = () => [];
}
