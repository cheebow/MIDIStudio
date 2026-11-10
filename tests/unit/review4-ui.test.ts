/* eslint-disable react-hooks/rules-of-hooks -- the hooks run under the stand-in for React below, outside components */
// Regression tests of the 4th review (ADR-094): UI helpers of the arrangement / piano roll / drum editor.
// The hooks are run with a minimal stand-in for React (refs, effects, memo) so they work in node.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => {
  interface Slot {
    value?: unknown;
    deps?: readonly unknown[];
    cleanup?: (() => void) | void;
  }
  const state = { slots: [] as Slot[], i: 0, pending: [] as (() => void)[] };
  const slot = (): Slot => (state.slots[state.i++] ??= {});
  const changed = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => !a || !b || a.length !== b.length || a.some((v, k) => !Object.is(v, b[k]));
  const effect = (fn: () => (() => void) | void, deps?: readonly unknown[]) => {
    const s = slot();
    if (!changed(s.deps, deps)) return;
    s.deps = deps;
    state.pending.push(() => {
      if (typeof s.cleanup === 'function') s.cleanup();
      s.cleanup = fn();
    });
  };
  return {
    state,
    api: {
      useRef: <T,>(initial: T) => {
        const s = slot();
        if (!('value' in s)) s.value = { current: initial };
        return s.value as { current: T };
      },
      useEffect: effect,
      useLayoutEffect: effect,
      useMemo: <T,>(fn: () => T, deps: readonly unknown[]) => {
        const s = slot();
        if (changed(s.deps, deps)) {
          s.deps = deps;
          s.value = fn();
        }
        return s.value as T;
      },
      useState: <T,>(initial: T | (() => T)) => {
        const s = slot();
        if (!('value' in s)) s.value = typeof initial === 'function' ? (initial as () => T)() : initial;
        return [s.value as T, () => undefined] as const;
      },
    },
    /** one React render: runs the hook body, then its effects */
    render<T>(fn: () => T): T {
      state.i = 0;
      const out = fn();
      for (const run of state.pending.splice(0)) run();
      return out;
    },
    reset() {
      state.slots = [];
      state.pending = [];
    },
  };
});

vi.mock('react', () => rt.api);

import { useDragAutoScroll } from '../../src/ui/dragAutoScroll';
import { useZoomAnchor } from '../../src/ui/hooks';
import { createEmptyProject } from '../../src/core/model/defaults';
import { addEvents } from '../../src/core/editing/operations';
import { duplicateClips } from '../../src/core/editing/clipboard';

beforeEach(() => rt.reset());

describe('useDragAutoScroll: a press near an edge must not scroll before the pointer moved (ADR-068)', () => {
  /** runs the hook like an editor does and returns the scroll after ~0.2 s of holding the button still */
  function pressNearRightEdge(opts: { seekClickFirst: boolean }): number {
    const frames: ((now: number) => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const scroll = { current: { scrollLeft: 0, scrollTop: 0 } as unknown as HTMLElement };
    const area = { current: { getBoundingClientRect: () => ({ left: 0, right: 800, top: 0, bottom: 400 }) } as unknown as HTMLElement };
    const use = (active: boolean) => rt.render(() => useDragAutoScroll(scroll, area, active, { top: 20 }));

    let track = use(false);
    if (opts.seekClickFirst) {
      // PianoRoll / DrumEditor / Arrangement call trackPointer() on every pointerdown; a click on the
      // ruler only seeks (no drag state), so `active` never becomes true for it
      track(300, 10, true);
      track = use(false);
    }
    // pointerdown on a note 10 px from the right edge: the editor reports the pointer, then starts the drag
    track(790, 200, true);
    use(true);
    // the button is held and the pointer does not move
    let now = performance.now();
    for (let i = 0; i < 12; i++) {
      now += 16;
      frames.shift()?.(now);
    }
    vi.unstubAllGlobals();
    return scroll.current.scrollLeft;
  }

  it('control: a first press near the edge does not scroll', () => {
    expect(pressNearRightEdge({ seekClickFirst: false })).toBe(0);
  });

  it('after a click that started no drag (ruler seek), the next press near the edge still does not scroll', () => {
    expect(pressNearRightEdge({ seekClickFirst: true })).toBe(0);
  });
});

describe('useZoomAnchor: a pointer anchor is used only for the zoom it was set for', () => {
  it('a ⌘+wheel that could not zoom (already at the limit) does not anchor a later button zoom', () => {
    const scroll = { current: { scrollLeft: 1000 } as unknown as HTMLElement };
    const viewW = 800;
    const use = (pxPerTick: number) => rt.render(() => useZoomAnchor(scroll, pxPerTick, 0, viewW));

    const anchor = use(1);
    // ⌘+wheel at the zoom limit: the anchor is recorded, the zoom (pxPerTick) stays the same
    anchor(1100, 100);
    use(1);
    // the user scrolls far away, then zooms in with the + button (no pointer anchor): the centre should stay
    scroll.current.scrollLeft = 20000;
    const centreTick = (20000 + viewW / 2) / 1;
    use(2);
    expect(scroll.current.scrollLeft).toBe(Math.round(centreTick * 2 - viewW / 2));
  });
});

describe('duplicateClips with a track offset that cannot be applied', () => {
  it('Alt+drag straight down from the last track does not stack a copy on the original', () => {
    let p = createEmptyProject({ ppq: 96 });
    const trackId = p.tracks[0].id;
    const r = addEvents(p, trackId, [{ kind: 'note', tick: 0, pitch: 60, velocity: 100, durationTicks: 96, releaseVelocity: 64 }]);
    p = { ...p, ...r!.command.patch };
    const clip = p.clips[0];
    // Arrangement.onPointerUp: d.dx === 0, d.trackOffset === 1 (pointer one row below the last track)
    const dup = duplicateClips(p, [clip.id], { deltaTick: 0, trackOffset: 1 });
    const after = dup ? { ...p, ...dup.command.patch } : p;
    const stacked = after.clips.filter((c) => c.trackId === clip.trackId && c.startTick === clip.startTick && c.endTick === clip.endTick);
    expect(stacked.length).toBe(1);
    expect(after.tracks[0].events.filter((e) => e.kind === 'note').length).toBe(1);
  });
});
