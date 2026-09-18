// Desktop "copy on select": when a mouse selection settles, copy it to the
// clipboard with no keypress — the macOS terminal behaviour. We copy on mouse
// pointer-up (the selection is final by then), not on every selection change
// (which fires continuously mid-drag).
//
// Touch is excluded: there is no desktop-style copy-on-select on a phone, and the
// iOS select flow is the ⌶ toggle's native selection. xterm only makes a local
// selection when no foreground app is grabbing the mouse, or — inside a mouse-mode
// app like Claude Code — when ⌥ is held (Terminal option macOptionClickForcesSelection).

type CopyOnSelectTerm = {
  hasSelection: () => boolean;
  getSelection: () => string;
};

export type CopyOnSelect = { destroy: () => void };

export function attachCopyOnSelect(
  container: HTMLElement,
  term: CopyOnSelectTerm,
  onCopy: (text: string) => void,
): CopyOnSelect {
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (term.hasSelection()) onCopy(term.getSelection());
  };
  container.addEventListener('pointerup', onPointerUp);
  return {
    destroy() {
      container.removeEventListener('pointerup', onPointerUp);
    },
  };
}
