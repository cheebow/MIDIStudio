// Dragging the loop range on a ruler or the seek bar (ADR-053): grab an end to resize, the band
// to move. Pure helpers shared by the track view, the piano roll, the drum editor and the seek bar.
import type { LoopRange } from '../core/model/types';
import type { TimeSignatureMap } from '../core/timing/timeSignatureMap';

export type LoopHit = 'start' | 'end' | 'move';
export const LOOP_EDGE_PX = 6;

export interface LoopDrag {
  kind: 'loop';
  hit: LoopHit;
  startX: number;
  origin: LoopRange;
  /** range shown while dragging; committed on pointer up */
  preview: LoopRange;
}

/** Height of the handle strip at the bottom of a ruler that moves the whole range. */
export const LOOP_BAND_PX = 7;

/**
 * What a pointer at (x, y) (px inside the scrolled view, y from the ruler top) would grab: an end
 * anywhere in the ruler's height, the whole range only on the handle strip at the bottom — so a
 * plain click on the ruler still seeks even when the loop spans the view.
 */
export function hitLoop(x: number, y: number, loop: LoopRange, pxPerTick: number, viewX: number, rulerH: number, edgePx = LOOP_EDGE_PX): LoopHit | null {
  if (loop.endTick <= loop.startTick) return null;
  const x0 = loop.startTick * pxPerTick - viewX;
  const x1 = loop.endTick * pxPerTick - viewX;
  if (Math.abs(x - x0) <= edgePx) return 'start';
  if (Math.abs(x - x1) <= edgePx) return 'end';
  return x > x0 && x < x1 && y >= rulerH - LOOP_BAND_PX ? 'move' : null;
}

export const loopCursor = (hit: LoopHit | null): string => (hit === 'move' ? 'grab' : hit ? 'ew-resize' : '');

/** The range after dragging `hit` by `dTick` from `origin`; the range keeps at least `minLen` ticks. */
export function draggedLoop(origin: LoopRange, hit: LoopHit, dTick: number, snap: (tick: number) => number, minLen: number): LoopRange {
  if (hit === 'move') {
    const len = origin.endTick - origin.startTick;
    const startTick = Math.max(0, snap(origin.startTick + dTick));
    return { ...origin, startTick, endTick: startTick + len };
  }
  if (hit === 'start') return { ...origin, startTick: Math.max(0, Math.min(origin.endTick - minLen, snap(origin.startTick + dTick))) };
  return { ...origin, endTick: Math.max(origin.startTick + minLen, snap(origin.endTick + dTick)) };
}

/** Snap to the nearest bar line, or the nearest beat when `fine` (Shift). */
export function loopSnap(sig: TimeSignatureMap, fine: boolean): (tick: number) => number {
  return (tick) => {
    const t = Math.max(0, tick);
    const bb = sig.tickToBarBeat(t);
    const nearest = (a: number, b: number) => Math.round(t - a < b - t ? a : b);
    if (fine) {
      const beats = sig.signatureAt(t).numerator;
      const here = sig.barBeatToTick(bb.bar, bb.beat);
      const next = bb.beat < beats ? sig.barBeatToTick(bb.bar, bb.beat + 1) : sig.barBeatToTick(bb.bar + 1);
      return nearest(here, next);
    }
    return nearest(sig.barBeatToTick(bb.bar), sig.barBeatToTick(bb.bar + 1));
  };
}
