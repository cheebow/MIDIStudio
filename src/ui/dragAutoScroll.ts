// Edge auto-scroll while dragging in a scrolled editor (ADR-068): box selection, moving or
// resizing notes and the loop range keep going past the visible area. The editors keep their
// drag coordinates in content space (scroll offset included), and re-apply the drag on every
// scroll event, so a wheel scroll during a drag works the same way as the auto-scroll.
import { useEffect, useRef, type RefObject } from 'react';

/** Width of the band inside each edge where the auto-scroll starts. */
export const AUTO_SCROLL_EDGE_PX = 24;
/** Speed gained per px the pointer goes into the edge band (and past it), in px per second. */
export const AUTO_SCROLL_RAMP = 12;
/** Fastest scroll, in px per second (reached well past the edge). */
export const AUTO_SCROLL_MAX_PX_PER_S = 800;

/**
 * Scroll speed (px per second, signed) for a pointer at `pos` on an axis whose visible area is
 * [start, end]: 0 in the middle, growing as the pointer nears an edge and keeps growing past it.
 * Per second, not per frame, so a 120 Hz display scrolls as fast as a 60 Hz one.
 */
export function edgeScrollSpeed(pos: number, start: number, end: number, edge = AUTO_SCROLL_EDGE_PX, max = AUTO_SCROLL_MAX_PX_PER_S): number {
  if (end - start <= edge * 2) return 0; // too small to have a calm middle
  // about 290 px/s at the edge itself (a maximised window cannot go much further), up to `max` ~40 px past it
  const speed = (depth: number) => Math.min(max, depth * AUTO_SCROLL_RAMP);
  if (pos < start + edge) return -speed(start + edge - pos);
  if (pos > end - edge) return speed(pos - (end - edge));
  return 0;
}

/** The parts of a pointer event a drag needs, kept to re-apply the drag when the view scrolls. */
export type PointerLike = Pick<PointerEvent, 'clientX' | 'clientY' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>;
export const pointerOf = (e: PointerLike): PointerLike => ({ clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey });

/** Longest frame gap counted, in seconds: a stalled tab does not jump on return. */
export const AUTO_SCROLL_MAX_DT = 0.1;

/**
 * One frame of auto-scroll: adds `speed` (px/s) × the elapsed time to `carry` and returns the whole
 * px to scroll now; the fraction stays in `carry` for the next frame (scroll positions are whole
 * px in some browsers), so the distance per second does not depend on the frame rate.
 */
export function autoScrollStep(carry: { x: number; y: number }, speedX: number, speedY: number, elapsedMs: number): { dx: number; dy: number } {
  const dt = Math.min(AUTO_SCROLL_MAX_DT, Math.max(0, elapsedMs / 1000));
  carry.x += speedX * dt;
  carry.y += speedY * dt;
  const dx = Math.trunc(carry.x);
  const dy = Math.trunc(carry.y);
  carry.x -= dx;
  carry.y -= dy;
  return { dx, dy };
}

/** How far the pointer must move after pressing before the auto-scroll can start. */
const ARM_PX = 4;

export interface AutoScrollOptions {
  /** px at the top of the area that are not scrolled content (the ruler) */
  top?: number;
  /** false: horizontal only (loop drags on the ruler) */
  vertical?: boolean;
}

/**
 * While `active`, scrolls `scrollRef` every frame when the last pointer position (reported through
 * the returned function, in client coordinates) is near or past an edge of `areaRef`. Changing the
 * scroll position fires the container's scroll event, where the editor re-applies the drag.
 */
export function useDragAutoScroll(scrollRef: RefObject<HTMLElement | null>, areaRef: RefObject<HTMLElement | null>, active: boolean, opts: AutoScrollOptions = {}): (clientX: number, clientY: number) => void {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** where the drag started: the scroll waits until the pointer has really moved, so a click near an edge does not scroll */
  const origin = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);
  const { top = 0, vertical = true } = opts;
  useEffect(() => {
    if (!active) {
      pointer.current = null;
      origin.current = null;
      armed.current = false;
      return;
    }
    let raf = 0;
    let last = performance.now();
    const carry = { x: 0, y: 0 };
    const frame = (now: number) => {
      const elapsed = now - last;
      last = now;
      const el = scrollRef.current;
      const area = areaRef.current;
      const p = pointer.current;
      if (el && area && p && armed.current) {
        const r = area.getBoundingClientRect();
        const { dx, dy } = autoScrollStep(carry, edgeScrollSpeed(p.x, r.left, r.right), vertical ? edgeScrollSpeed(p.y, r.top + top, r.bottom) : 0, elapsed);
        if (dx) el.scrollLeft += dx;
        if (dy) el.scrollTop += dy;
      } else {
        carry.x = 0;
        carry.y = 0;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, scrollRef, areaRef, top, vertical]);
  return (x, y) => {
    if (!origin.current) origin.current = { x, y };
    else if (Math.abs(x - origin.current.x) + Math.abs(y - origin.current.y) > ARM_PX) armed.current = true;
    pointer.current = { x, y };
  };
}
