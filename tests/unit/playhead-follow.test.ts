// ADR-085: a view the user asked for (double-click on a clip) is kept while playing.
import { describe, expect, it } from 'vitest';
import { PlayheadFollow } from '../../src/ui/hooks';

const PX = 0.1; // px per tick
const sig = { tickToBarBeat: (t: number) => ({ bar: Math.floor(t / 1920) + 1 }), barBeatToTick: (bar: number) => (bar - 1) * 1920 };
const el = () => ({ scrollLeft: 0 }) as HTMLElement;
const VIEW_W = 1920 * 4 * PX; // four bars visible
/** one frame: the playhead's x in the view follows from scrollLeft */
const frame = (f: PlayheadFollow, e: HTMLElement, tick: number, playing = true) => f.update({ tick, playing } as never, tick * PX - e.scrollLeft, VIEW_W, e, sig, PX, true);

describe('PlayheadFollow', () => {
  it('pages to the bar of the playhead when it leaves the view while playing', () => {
    const f = new PlayheadFollow();
    const e = el();
    frame(f, e, 1920 * 2);
    frame(f, e, 1920 * 5);
    expect(e.scrollLeft).toBe(1920 * 5 * PX); // the bar that starts at the playhead
  });

  it('hold() keeps the revealed bar through playback and loop wraps until the playhead comes into view', () => {
    const f = new PlayheadFollow();
    const e = el();
    frame(f, e, 1920 * 2);
    e.scrollLeft = 1920 * 20 * PX; // revealed bar 21
    f.hold();
    frame(f, e, 1920 * 3);
    frame(f, e, 0); // loop wrap
    frame(f, e, 1920 * 3);
    expect(e.scrollLeft).toBe(1920 * 20 * PX);
    // the playhead reaches the revealed view: following resumes and pages on when it leaves
    frame(f, e, 1920 * 21);
    frame(f, e, 1920 * 25);
    expect(e.scrollLeft).toBe(1920 * 25 * PX);
  });

  it('the hold ends when playback starts or the playhead is moved while stopped', () => {
    const f = new PlayheadFollow();
    const e = el();
    frame(f, e, 0, false);
    e.scrollLeft = 1920 * 20 * PX;
    f.hold();
    frame(f, e, 0, false);
    expect(e.scrollLeft).toBe(1920 * 20 * PX);
    frame(f, e, 1920, true); // play
    expect(e.scrollLeft).toBe(1920 * PX);
    const g = new PlayheadFollow();
    const e2 = el();
    frame(g, e2, 0, false);
    e2.scrollLeft = 1920 * 20 * PX;
    g.hold();
    frame(g, e2, 1920 * 8, false); // seek while stopped
    expect(e2.scrollLeft).toBe(1920 * 8 * PX);
  });
});
