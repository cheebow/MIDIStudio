// Recorded chords are not exactly simultaneous (ADR-077 追記): every tool treats a chord whose
// notes start a few ticks apart as one chord, while fast single-note passages stay separate.
import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../../src/core/model/ids';
import { arpeggiateChords, legatoNotes, shapeVelocities, strumChords, voiceChords } from '../../../src/core/editing/perform';
import { chordGroups } from '../../../src/core/editing/perform/chords';
import { note, Session } from './helpers';

beforeEach(() => setIdGenerator(createCounterIdGenerator('e')));

/** a chord as a keyboard take records it: the notes 0 / 4 / 9 / 13 ticks apart (≈ 0–14 ms at 120 BPM) */
const played = (tick: number, pitches: number[], len = 200) => pitches.map((p, i) => note(tick + [0, 4, 9, 13, 17, 21][i], p, len - [0, 4, 9, 13, 17, 21][i]));
const progression = [
  [65, 69, 72, 76],
  [64, 67, 71, 74],
  [64, 67, 69, 72],
  [62, 65, 69, 72],
  [62, 65, 67, 71],
];

describe('played (slightly spread) chords', () => {
  it('group into chords; 32nd-note runs and repeated pitches do not', () => {
    const s = new Session();
    const ids = s.add([...played(0, [60, 64, 67]), ...[480, 540, 600, 660].map((t, i) => note(t, 60 + i, 60)), note(960, 60, 10), note(970, 60, 10)]);
    const groups = chordGroups(s.project, ids)[0];
    expect(groups.map((g) => g.notes.length)).toEqual([3, 1, 1, 1, 1, 1, 1]);
    expect(groups[0].tick).toBe(0);
  });

  it('guitar voicing recognises every chord of a recorded take (the screenshot case)', () => {
    const s = new Session();
    const ids = s.add(progression.flatMap((c, i) => played(i * 960, c)));
    const r = voiceChords(s.project, ids, { voicing: 'auto' });
    expect(r.stats).toEqual({ notes: 20, groups: 5, skipped: 0 });
    expect(r.notice).toBeNull();
    expect(r.command).not.toBeNull();
    s.run(voiceChords(s.project, ids, { voicing: 'open' }).command);
    // the onsets the player recorded are kept; the open Fmaj7 102210 has 6 strings: 2 new notes at the chord start
    expect(s.notes().filter((n) => n.tick < 960).length).toBe(6);
  });

  it('legato connects each chord to the next chord, not to its own next note', () => {
    const s = new Session();
    const ids = s.add([...played(0, [60, 64, 67]), ...played(480, [62, 65, 69])]);
    s.run(legatoNotes(s.project, ids, { mode: 'connect' }).command);
    expect(s.notes().filter((n) => n.tick < 480).map((n) => n.tick + n.durationTicks)).toEqual([480, 480, 480]);
  });

  it('the velocity shaper gives one factor per played chord', () => {
    const s = new Session();
    const ids = s.add([...played(0, [60, 64, 67]), ...played(480, [62, 65, 69])]);
    s.run(shapeVelocities(s.project, ids, { shape: 'alternate' }).command);
    expect(s.notes().map((n) => n.velocity)).toEqual([110, 110, 110, 90, 90, 90]);
  });

  it('arpeggio spreads a played chord from its first note', () => {
    const s = new Session();
    const ids = s.add(played(0, [60, 64, 67], 480));
    s.run(arpeggiateChords(s.project, ids, { pattern: 'up' }).command);
    expect(s.notes().map((n) => [n.tick, n.pitch])).toEqual([
      [0, 60],
      [160, 64],
      [320, 67],
    ]);
  });

  it('strum treats a played chord as one stroke', () => {
    const s = new Session();
    const ids = s.add(played(0, [48, 52, 55, 60], 480));
    const r = strumChords(s.project, ids, { stroke: 'auto', speed: 'normal', natural: false });
    expect(r.stats.groups).toBe(1);
    expect(r.notice).toBeNull(); // a played chord is not "already strummed"
    s.run(r.command);
    expect(s.notes().map((n) => n.tick)).toEqual([0, 14, 29, 43]);
  });
});
