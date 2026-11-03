// Edge auto-scroll while dragging in a scrolled editor (ADR-068): box selection, moving or
// resizing notes and the loop range keep going past the visible area. The editors keep their
// drag coordinates in content space (scroll offset included), and re-apply the drag on every
// scroll event, so a wheel scroll during a drag works the same way as the auto-scroll.
import { useEffect, useRef, type RefObject } from 'react';

/** Width of the band inside each edge where the auto-scroll starts. */
export const AUTO_SCROLL_EDGE_PX = 24;
/** Fastest scroll, in px per frame (reached a little past the edge). */
export const AUTO_SCROLL_MAX_PX = 40;

/**
 * Scroll speed (px per frame, signed) for a pointer at `pos` on an axis whose visible area is
 * [start, end]: 0 in the middle, growing as the pointer nears an edge and keeps growing past it.
 */
export function edgeScrollSpeed(pos: number, start: number, end: number, edge = AUTO_SCROLL_EDGE_PX, max = AUTO_SCROLL_MAX_PX): number {
  if (end - start <= edge * 2) return 0; // too small to have a calm middle
  // about 20 px per frame at the edge itself (a maximised window cannot go much further), then up to `max`
  const speed = (depth: number) => Math.min(max, Math.ceil(depth * 0.8));
  if (pos < start + edge) return -speed(start + edge - pos);
  if (pos > end - edge) return speed(pos - (end - edge));
  return 0;
}

/** The parts of a pointer event a drag needs, kept to re-apply the drag when the view scrolls. */
export type PointerLike = Pick<PointerEvent, 'clientX' | 'clientY' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>;
export const pointerOf = (e: PointerLike): PointerLike => ({ clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey });

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
    const frame = () => {
      const el = scrollRef.current;
      const area = areaRef.current;
      const p = pointer.current;
      if (el && area && p && armed.current) {
        const r = area.getBoundingClientRect();
        const dx = edgeScrollSpeed(p.x, r.left, r.right);
        const dy = vertical ? edgeScrollSpeed(p.y, r.top + top, r.bottom) : 0;
        if (dx) el.scrollLeft += dx;
        if (dy) el.scrollTop += dy;
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
