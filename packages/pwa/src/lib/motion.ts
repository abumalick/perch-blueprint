// Animation timings for the workspace list. Centralized so the
// prefers-reduced-motion gate lives in one tested place instead of being
// scattered through the markup. Durations are read at the moment each
// flip/transition starts, so honoring the OS setting needs no subscription.

export const REORDER_MS = 200;
export const ENTER_LEAVE_MS = 180;

export function prefersReducedMotion(): boolean {
  const mm = typeof window !== 'undefined' ? window.matchMedia : undefined;
  return mm ? mm.call(window, '(prefers-reduced-motion: reduce)').matches : false;
}

export function motionDuration(baseMs: number): number {
  return prefersReducedMotion() ? 0 : baseMs;
}
