import { describe, it, expect } from 'vitest';
import { cellFromPoint, spanBetween } from './terminal-touch-select';

describe('cellFromPoint', () => {
  it('maps an offset to its cell by flooring per dimension', () => {
    expect(cellFromPoint(0, 0, 10, 20, 80, 24)).toEqual({ col: 0, row: 0 });
    expect(cellFromPoint(25, 45, 10, 20, 80, 24)).toEqual({ col: 2, row: 2 });
  });

  it('clamps below zero to the first cell', () => {
    expect(cellFromPoint(-5, -5, 10, 20, 80, 24)).toEqual({ col: 0, row: 0 });
  });

  it('clamps past the grid to the last col/row', () => {
    expect(cellFromPoint(9999, 9999, 10, 20, 80, 24)).toEqual({ col: 79, row: 23 });
  });

  it('returns 0 for a non-positive cell dimension', () => {
    expect(cellFromPoint(100, 100, 0, 20, 80, 24)).toEqual({ col: 0, row: 5 });
    expect(cellFromPoint(100, 100, 10, 0, 80, 24)).toEqual({ col: 10, row: 0 });
  });
});

describe('spanBetween', () => {
  const cols = 80;

  it('selects a single cell when anchor and current are the same', () => {
    expect(spanBetween({ col: 5, row: 2 }, { col: 5, row: 2 }, cols)).toEqual({
      col: 5,
      row: 2,
      length: 1,
    });
  });

  it('selects left-to-right on the same row inclusively', () => {
    expect(spanBetween({ col: 3, row: 1 }, { col: 6, row: 1 }, cols)).toEqual({
      col: 3,
      row: 1,
      length: 4,
    });
  });

  it('normalizes a right-to-left drag to the same span', () => {
    expect(spanBetween({ col: 6, row: 1 }, { col: 3, row: 1 }, cols)).toEqual({
      col: 3,
      row: 1,
      length: 4,
    });
  });

  it('wraps the length across rows using cols', () => {
    // row 1 col 78 → row 2 col 1: (78,79) on row1 + (0,1) on row2 = 4 cells.
    expect(spanBetween({ col: 78, row: 1 }, { col: 1, row: 2 }, cols)).toEqual({
      col: 78,
      row: 1,
      length: 4,
    });
  });

  it('starts from the earlier cell when dragging up across rows', () => {
    expect(spanBetween({ col: 1, row: 3 }, { col: 78, row: 1 }, cols)).toEqual({
      col: 78,
      row: 1,
      length: cols - 78 + cols + 1 + 1,
    });
  });
});
