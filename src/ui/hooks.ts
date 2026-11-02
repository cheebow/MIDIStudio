// Small hooks shared by the editors.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { TransportPosition } from '../playback/Transport';
import { barPageScrollLeft } from './canvas';
import type { MidiProject } from '../core/model/types';
import { TimeSignatureMap } from '../core/timing/timeSignatureMap';

/** Bar / beat map of the project, rebuilt only when the PPQ or the conductor track changes. */
export function useSignatureMap(project: MidiProject): TimeSignatureMap {
  return useMemo(() => new TimeSignatureMap(project.ppq, project.conductor.filter((c) => c.kind === 'time-signature')), [project.ppq, project.conductor]);
}

/**
 * Drag state kept both in React state (for rendering) and in a ref (for handlers): pointerup can
 * arrive before React re-renders after the last pointermove, so handlers must read the ref.
 */
export function useDragState<T>(): [T | null, RefObject<T | null>, (d: T | null) => void] {
  const [drag, setDragState] = useState<T | null>(null);
  const ref = useRef<T | null>(null);
  const set = (d: T | null) => {
    ref.current = d;
    setDragState(d);
  };
  return [drag, ref, set];
}

/** Client size of an element, kept up to date with a ResizeObserver. */
export function useElementSize(ref: RefObject<HTMLElement | null>, initial = { w: 800, h: 200 }): { w: number; h: number } {
  const [size, setSize] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * Keeps a musical position on the same screen x across a horizontal zoom change. Call the returned
 * function with the tick under the pointer (and its x inside the scrolled area) right before
 * changing the zoom (⌘+wheel); without it the tick at the view centre stays put (buttons, menu).
 * `leadPx` is the margin before bar 1, which scales with the zoom too.
 */
export function useZoomAnchor(scrollRef: RefObject<HTMLElement | null>, pxPerTick: number, leadPx: number, viewW: number): (tick: number, x: number) => void {
  const pending = useRef<{ tick: number; x: number } | null>(null);
  const prev = useRef({ pxPerTick, leadPx });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const p = prev.current;
    prev.current = { pxPerTick, leadPx };
    if (!el || p.pxPerTick === pxPerTick) {
      pending.current = null;
      return;
    }
    const a = pending.current ?? { tick: (el.scrollLeft - p.leadPx + viewW / 2) / p.pxPerTick, x: viewW / 2 };
    pending.current = null;
    el.scrollLeft = Math.max(0, Math.round(a.tick * pxPerTick + leadPx - a.x));
  }, [scrollRef, pxPerTick, leadPx, viewW]);
  return (tick, x) => {
    pending.current = { tick, x };
  };
}

/** Runs `frame` on every animation frame while mounted; `deps` restart the loop (like useEffect). */
export function useAnimationLoop(frame: () => void, deps: readonly unknown[]): void {
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      frame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // the caller's dependency list is the effect's dependency list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Follow-playback for a horizontally scrolling editor: pages the view by whole bars when the
 * playhead leaves it while playing, and after a seek while stopped (a seek arms the follow for a
 * short time, so it still lands when the scroll area was not yet wide enough on the first frame);
 * a manual scroll while stopped is left alone. Call the returned function once per frame.
 */
export function usePlayheadFollow(): (pos: TransportPosition, x: number, viewW: number, el: HTMLElement | null, sig: Parameters<typeof barPageScrollLeft>[0], pxPerTick: number, enabled: boolean) => void {
  const lastTick = useRef(-1);
  const armedUntil = useRef(0);
  return (pos, x, viewW, el, sig, pxPerTick, enabled) => {
    if (Math.abs(pos.tick - lastTick.current) > 0.5) armedUntil.current = performance.now() + 1500;
    lastTick.current = pos.tick;
    const outside = x > viewW - 20 || x < 0;
    if (!outside) armedUntil.current = 0;
    const armed = armedUntil.current > performance.now();
    if (enabled && el && outside && (pos.playing || armed)) el.scrollLeft = barPageScrollLeft(sig, pos.tick, pxPerTick);
  };
}

