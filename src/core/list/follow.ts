// TM monitor follow logic (REQ-PLAY-03/04, ARCHITECTURE G). Derived only from a Transport tick.

/** Index of the last row whose tick <= position, or -1 (binary search over sorted ticks). */
export function lastRowAtOrBefore(ticks: readonly number[], position: number): number {
  let lo = 0;
  let hi = ticks.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ticks[mid] <= position) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export interface FollowState {
  /** rows sounding "now": every row at the current event tick (P06), [first, last] inclusive, or null */
  current: [number, number] | null;
  /** next row index after the current tick, or null at the end */
  next: number | null;
  /** ticks until the next event (shown during long rests) */
  ticksToNext: number | null;
}

export function followState(ticks: readonly number[], position: number): FollowState {
  const last = lastRowAtOrBefore(ticks, position);
  if (last < 0) return { current: null, next: ticks.length ? 0 : null, ticksToNext: ticks.length ? ticks[0] - position : null };
  const t = ticks[last];
  let first = last;
  while (first > 0 && ticks[first - 1] === t) first--;
  const next = last + 1 < ticks.length ? last + 1 : null;
  return { current: [first, last], next, ticksToNext: next === null ? null : ticks[next] - position };
}

export type FollowMode = 'fixed-cursor' | 'page-turn' | 'smooth';

/**
 * First visible row for a follow mode. fixed-cursor keeps the current row at `anchor` rows from
 * the top; page-turn switches whole pages; smooth returns the fixed-cursor target (the view eases
 * towards it). Purely a function of the current row, so seeks and loops re-sync immediately.
 */
export function topRow(mode: FollowMode, currentRow: number, rowsPerPage: number, totalRows: number, anchor = Math.floor(rowsPerPage / 3)): number {
  const row = Math.max(0, currentRow);
  if (mode === 'page-turn') return Math.floor(row / Math.max(1, rowsPerPage)) * Math.max(1, rowsPerPage);
  return Math.max(0, Math.min(row - anchor, Math.max(0, totalRows - rowsPerPage)));
}
