// Snap grid in ticks (REQ-EDT-03, E08). Grid lengths are exact rationals: a 1/16 triplet at
// PPQ 1000 is 500/3 ticks. Snapping to a non-integer grid line is reported as inexact instead of
// being rounded silently.
import { rational, type Rational } from './rational';

export type GridKind = 'straight' | 'triplet' | 'dotted';

export interface GridSpec {
  /** note value denominator: 1 = whole, 4 = quarter, 16 = sixteenth ... */
  division: number;
  kind: GridKind;
}

export const GRID_DIVISIONS = [1, 2, 4, 8, 16, 32, 64] as const;

/** Grid length in ticks as an exact rational. */
export function gridTicks(ppq: number, g: GridSpec): Rational {
  const base = rational(ppq * 4, g.division);
  if (g.kind === 'triplet') return rational(base.num * 2, base.den * 3);
  if (g.kind === 'dotted') return rational(base.num * 3, base.den * 2);
  return base;
}

export function gridLabel(g: GridSpec): string {
  return `1/${g.division}${g.kind === 'triplet' ? 'T' : g.kind === 'dotted' ? '.' : ''}`;
}

export interface SnapResult {
  tick: number;
  /** false when the nearest grid line is not a whole tick (the result was rounded) */
  exact: boolean;
}

/** Snaps to the nearest grid line (mode 'round') or the line at/before the tick ('floor'). */
export function snapTick(tick: number, grid: Rational, mode: 'round' | 'floor' = 'round'): SnapResult {
  // index = tick / grid = tick * den / num
  const raw = (tick * grid.den) / grid.num;
  const index = mode === 'floor' ? Math.floor(raw + 1e-9) : Math.round(raw);
  const num = index * grid.num;
  const exact = num % grid.den === 0;
  return { tick: exact ? num / grid.den : Math.round(num / grid.den), exact };
}

/**
 * Snap with shuffle (swing): every second grid line is moved later. `swing` is the DAW-style
 * percentage of a two-line pair at which the off-beat line sits: 50 = straight, 66.7 ≈ triplet
 * feel, 75 = dotted feel. Off-beat lines rarely fall on whole ticks, so the result is rounded and
 * reported as inexact when it was.
 */
export function snapTickSwing(tick: number, grid: Rational, swing: number): SnapResult {
  if (!(swing > 50)) return snapTick(tick, grid);
  const pair = (2 * grid.num) / grid.den;
  const start = Math.floor(tick / pair + 1e-9) * pair;
  let best = start;
  for (const line of [start + (pair * Math.min(swing, 100)) / 100, start + pair]) if (Math.abs(line - tick) < Math.abs(best - tick)) best = line;
  const rounded = Math.round(best);
  return { tick: rounded, exact: Math.abs(best - rounded) < 1e-9 };
}

/** True when every grid line falls on a whole tick. */
export function isGridExact(grid: Rational): boolean {
  return grid.den === 1;
}
