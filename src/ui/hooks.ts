// Small hooks shared by the editors.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { TransportPosition } from '../playback/Transport';
import { barPageScrollLeft } from './canvas';
import type { MidiProject } from '../core/model/types';
import { TimeSignatureMap } from '../core/timing/timeSignatureMap';
import { analyzeChords, type ChordSegment } from '../core/theory/chords';

/** Bar / beat map of the project, rebuilt only when the PPQ or the conductor track changes. */
export function useSignatureMap(project: MidiProject): TimeSignatureMap {
  return useMemo(() => new TimeSignatureMap(project.ppq, project.conductor.filter((c) => c.kind === 'time-signature')), [project.ppq, project.conductor]);
}

const NO_CHORDS: ChordSegment[] = [];

/**
 * Estimated chord names (ADR-090), recomputed only when the notes, mute / solo, clips or conductor
 * change (not on zoom or scroll). Empty while the display is off.
 */
/**
 * The last analysis, shared by every caller (the piano roll and visual mode both show chords): the
 * same tracks / clips / conductor / PPQ give the same result, so the song is analysed once per change.
 */
let lastChords: { tracks: unknown; clips: unknown; conductor: unknown; ppq: number; segments: ChordSegment[] } | null = null;
export function sharedChords(project: MidiProject): ChordSegment[] {
  const c = lastChords;
  if (c && c.tracks === project.tracks && c.clips === project.clips && c.conductor === project.conductor && c.ppq === project.ppq) return c.segments;
  const segments = analyzeChords(project);
  lastChords = { tracks: project.tracks, clips: project.clips, conductor: project.conductor, ppq: project.ppq, segments };
  return segments;
}

export function useChordSegments(project: MidiProject, enabled: boolean): ChordSegment[] {
  return useMemo(
    () => (enabled ? sharedChords(project) : NO_CHORDS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the analysis reads only these fields of the project
    [enabled, project.tracks, project.clips, project.conductor, project.ppq],
  );
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
  // An anchor is for the zoom of the same event only: one whose zoom did not happen (already at
  // the limit) must not steer a later zoom from a button. Runs after the effect above, every render.
  useLayoutEffect(() => {
    pending.current = null;
  });
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
 * a manual scroll while stopped is left alone. Call update() once per frame.
 * `hold()` keeps a view the user asked for (ADR-085): no paging until the playhead is in view
 * again, playback starts, or the playhead is moved while stopped (loop wraps keep the hold).
 */
export function usePlayheadFollow(): PlayheadFollow {
  const [follow] = useState(() => new PlayheadFollow());
  return follow;
}

export class PlayheadFollow {
  private lastTick = -1;
  private armedUntil = 0;
  private held = false;
  private wasPlaying = false;

  /**
   * `el` is the scroll area and `leadPx` the margin drawn before tick 0: the playhead's x is taken
   * from the live scrollLeft, not from React state, which lags one frame behind a programmatic
   * scroll (a revealed view would otherwise count as "playhead in view" and drop the hold).
   */
  update(pos: TransportPosition, el: HTMLElement | null, viewW: number, leadPx: number, sig: Parameters<typeof barPageScrollLeft>[0], pxPerTick: number, enabled: boolean): void {
    if (!el) return;
    // the first frame of a newly shown editor is neither a seek nor the start of playback
    const first = this.lastTick < 0;
    const jumped = Math.abs(pos.tick - this.lastTick) > 0.5;
    if (!first && ((jumped && !pos.playing) || (pos.playing && !this.wasPlaying))) this.held = false;
    if (jumped && !this.held) this.armedUntil = performance.now() + 1500;
    this.lastTick = pos.tick;
    this.wasPlaying = pos.playing;
    const x = pos.tick * pxPerTick - el.scrollLeft + leadPx;
    const outside = x > viewW - 20 || x < 0;
    if (!outside) {
      this.armedUntil = 0;
      this.held = false;
    }
    if (this.held) return;
    const armed = this.armedUntil > performance.now();
    if (enabled && outside && (pos.playing || armed)) el.scrollLeft = barPageScrollLeft(sig, pos.tick, pxPerTick);
  }

  hold(): void {
    this.held = true;
    this.armedUntil = 0;
  }
}

