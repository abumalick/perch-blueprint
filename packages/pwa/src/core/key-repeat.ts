// Auto-repeat for a held key: after an initial delay, fire and then keep firing at a
// steady interval until stopped. OS-style key repeat (delay, then a faster cadence).
// The first hit at the end of the delay is this module's, not the caller's — a tap
// commits on release (see `press` in KeyboardBar), so nothing is sent before then.
export const KEY_REPEAT_DELAY_MS = 300;
export const KEY_REPEAT_INTERVAL_MS = 50;

export function startKeyRepeat(fire: () => void): { stop: () => void } {
  let intervalId: ReturnType<typeof setInterval> | undefined;
  const timeoutId = setTimeout(() => {
    fire();
    intervalId = setInterval(fire, KEY_REPEAT_INTERVAL_MS);
  }, KEY_REPEAT_DELAY_MS);

  return {
    stop() {
      clearTimeout(timeoutId);
      if (intervalId !== undefined) clearInterval(intervalId);
    },
  };
}
