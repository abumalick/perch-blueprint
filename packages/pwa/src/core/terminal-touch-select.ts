// Pure touch→cell math for Android terminal character-span selection. The adapter
// (lib/android-select.ts) maps a pointer to a cell via cellFromPoint, offsets the row by
// the buffer's viewportY to get an absolute position, then selects the span between the
// anchor and current cells with spanBetween → term.select(col, row, length).

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export interface Cell {
  col: number;
  row: number;
}

export function cellFromPoint(
  offsetX: number,
  offsetY: number,
  cellWidth: number,
  rowHeight: number,
  cols: number,
  rows: number,
): Cell {
  const col = cellWidth > 0 ? clamp(Math.floor(offsetX / cellWidth), 0, cols - 1) : 0;
  const row = rowHeight > 0 ? clamp(Math.floor(offsetY / rowHeight), 0, rows - 1) : 0;
  return { col, row };
}

// Ordered inclusive span between two cells, linearized by row * cols + col so a selection
// wraps across rows the way xterm's select(col, row, length) expects. Direction-independent.
export function spanBetween(a: Cell, b: Cell, cols: number): { col: number; row: number; length: number } {
  const aP = a.row * cols + a.col;
  const bP = b.row * cols + b.col;
  const startP = Math.min(aP, bP);
  return {
    col: startP % cols,
    row: Math.floor(startP / cols),
    length: Math.abs(bP - aP) + 1,
  };
}
