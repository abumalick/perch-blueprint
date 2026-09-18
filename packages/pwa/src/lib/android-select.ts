// Android terminal touch selection adapter.
//
// On Android the OS never enters native text selection over xterm (long-press just
// refocuses the hidden textarea and reopens the keyboard), so in select mode we drive
// xterm's own selection from touch:
//   - a tap (press, no drag)  → select the whole line under the finger (selectLines)
//   - a drag                  → select the character span from the anchor cell to the
//                               cell now under the finger (select, wrapping across rows)
// The Copy button then reads term.getSelection(). iOS keeps its native path — this adapter
// never attaches there.
//
// Pointer events + setPointerCapture, not touch events: capture keeps every move arriving
// here for the whole drag. Capture-phase + stopPropagation shields xterm (no refocus);
// preventDefault + touch-action:none block native panning. The touch→cell math is pure
// (core/terminal-touch-select.ts). An optional InputLog records the gesture for the
// Settings → Diagnostics panel so a misbehaving drag can be inspected on-device.

import { cellFromPoint, spanBetween, type Cell } from '../core/terminal-touch-select';
import type { InputLog } from '../core/terminal-input-log';

// A press that never moves more than this (px) is a tap (whole-line), not a drag (span).
// Below one cell so a deliberate character drag registers, above finger jitter on a tap.
const DRAG_THRESHOLD_PX = 8;

export interface TouchSelectTerm {
  readonly cols: number;
  readonly rows: number;
  readonly buffer: { active: { viewportY: number } };
  select(column: number, row: number, length: number): void;
  selectLines(start: number, end: number): void;
}

export interface AndroidTouchSelect {
  destroy(): void;
}

export function attachAndroidTouchSelect(
  container: HTMLElement,
  term: TouchSelectTerm,
  opts: {
    isActive: () => boolean;
    rowHeight: () => number;
    cellWidth: () => number;
    log?: InputLog;
  },
): AndroidTouchSelect {
  let anchor: Cell | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false; // moved past the threshold → character-span mode
  let moves = 0;

  // Absolute-buffer cell under a pointer: viewport cell + the buffer's scrollback offset.
  const cellAt = (clientX: number, clientY: number): Cell => {
    const rect = container.getBoundingClientRect();
    const cell = cellFromPoint(
      clientX - rect.left,
      clientY - rect.top,
      opts.cellWidth(),
      opts.rowHeight(),
      term.cols,
      term.rows,
    );
    return { col: cell.col, row: term.buffer.active.viewportY + cell.row };
  };

  const onPointerDown = (e: Event): void => {
    if (!opts.isActive()) return;
    const pe = e as PointerEvent;
    if (pe.pointerType === 'mouse' || !pe.isPrimary) return; // desktop mouse stays xterm's
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    try {
      container.setPointerCapture?.(pe.pointerId);
    } catch {
      // no active pointer (synthetic events / unsupported) — capture is best-effort
    }
    anchor = cellAt(pe.clientX, pe.clientY);
    startX = pe.clientX;
    startY = pe.clientY;
    dragging = false;
    moves = 0;
    opts.log?.push({ kind: 'pointerdown', detail: `cell ${anchor.col},${anchor.row}`, out: '' });
  };

  const onPointerMove = (e: Event): void => {
    if (anchor === null) return;
    const pe = e as PointerEvent;
    if (!pe.isPrimary) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    moves++;
    if (!dragging) {
      const far = Math.max(Math.abs(pe.clientX - startX), Math.abs(pe.clientY - startY));
      if (far <= DRAG_THRESHOLD_PX) return; // still a tap
      dragging = true;
    }
    const { col, row, length } = spanBetween(anchor, cellAt(pe.clientX, pe.clientY), term.cols);
    term.select(col, row, length);
  };

  const onPointerUp = (e: Event): void => {
    if (anchor === null) return;
    const pe = e as PointerEvent;
    e.stopPropagation();
    if (!dragging) term.selectLines(anchor.row, anchor.row); // tap → whole line
    opts.log?.push({
      kind: 'pointerup',
      detail: dragging ? `span from ${anchor.col},${anchor.row}; moves=${moves}` : `line ${anchor.row}; moves=${moves}`,
      out: '',
    });
    anchor = null;
    try {
      container.releasePointerCapture?.(pe.pointerId);
    } catch {
      // nothing captured — best-effort release
    }
  };

  container.addEventListener('pointerdown', onPointerDown, true);
  container.addEventListener('pointermove', onPointerMove, true);
  container.addEventListener('pointerup', onPointerUp, true);
  container.addEventListener('pointercancel', onPointerUp, true);

  return {
    destroy() {
      container.removeEventListener('pointerdown', onPointerDown, true);
      container.removeEventListener('pointermove', onPointerMove, true);
      container.removeEventListener('pointerup', onPointerUp, true);
      container.removeEventListener('pointercancel', onPointerUp, true);
    },
  };
}
