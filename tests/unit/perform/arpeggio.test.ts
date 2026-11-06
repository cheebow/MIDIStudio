import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../../src/core/model/ids';
import { arpeggiateChords, arpeggioStepLengths, arpeggioStepTicks, noteValueName } from '../../../src/core/editing/perform';
import { note, Session } from './helpers';

beforeEach(() => setIdGenerator(createCounterIdGenerator('e')));

describe('arpeggio (PT-03)', () => {
  it('up: a 3-note chord of 480 ticks becomes 3 steps of 160 with 80 % gates, ids kept', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(0, 64), note(0, 67)]);
    const r = arpeggiateChords(s.project, ids, { pattern: 'up' });
    s.run(r.command);
    expect(s.rows()).toEqual([
      [0, 60, 128, 100],
      [160, 64, 128, 100],
      [320, 67, 128, 100],
    ]);
    expect(s.notes().map((n) => n.id)).toEqual(ids);
    expect(r.ids).toEqual(ids);
    s.undo();
    expect(s.rows().map((x) => x[0])).toEqual([0, 0, 0]);
  });

  it('down reverses the order', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(0, 64), note(0, 67)]);
    s.run(arpeggiateChords(s.project, ids, { pattern: 'down' }).command);
    expect(s.rows().map((x) => [x[0], x[1]])).toEqual([
      [0, 67],
      [160, 64],
      [320, 60],
    ]);
  });

  it('up and down: 2n-2 steps without repeating the turning notes; the extra notes are new ids in the clip', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 960), note(0, 64, 960), note(0, 67, 960)]);
    const r = arpeggiateChords(s.project, ids, { pattern: 'updown' });
    s.run(r.command);
    expect(s.rows()).toEqual([
      [0, 60, 192, 100],
      [240, 64, 192, 100],
      [480, 67, 192, 100],
      [720, 64, 192, 100],
    ]);
    const all = s.notes().map((n) => n.id);
    expect(new Set(all).size).toBe(4);
    expect(r.ids).toEqual(all.filter((id) => ids.includes(id)).concat(all.filter((id) => !ids.includes(id))));
    const clip = s.project.clips.find((c) => c.trackId === s.track.id)!;
    expect(clip.eventIds).toEqual(expect.arrayContaining(all));
    expect(s.project.clips.length).toBe(1);
    s.undo();
    expect(s.notes().length).toBe(3);
    expect(s.history.past.length).toBe(1);
    s.redo();
    expect(s.notes().length).toBe(4);
  });

  it('two notes up and down is just up', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(0, 64)]);
    s.run(arpeggiateChords(s.project, ids, { pattern: 'updown' }).command);
    expect(s.rows().map((x) => x[0])).toEqual([0, 240]);
  });

  it('the span ends at the next chord when it comes before the chord end; the next chord is untouched', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 1920), note(0, 64, 1920), note(480, 65, 480), note(480, 69, 480)]);
    s.run(arpeggiateChords(s.project, ids, { pattern: 'up' }).command);
    expect(s.rows()).toEqual([
      [0, 60, 192, 100],
      [240, 64, 192, 100],
      [480, 65, 192, 100],
      [720, 69, 192, 100],
    ]);
  });

  it('4- and 5-note chords, odd spans: every step is at least one tick and inside the span', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 7), note(0, 62, 7), note(0, 64, 7), note(0, 65, 7), note(0, 67, 7)]);
    s.run(arpeggiateChords(s.project, ids, { pattern: 'up' }).command);
    expect(s.rows().map((x) => [x[0], x[2]])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [4, 1],
      [5, 1],
    ]);
  });

  it('single notes and chords shorter than their step count are left alone with a notice', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(480, 60, 2), note(480, 64, 2), note(480, 67, 2)]);
    const r = arpeggiateChords(s.project, ids, { pattern: 'up' });
    expect(r.command).toBeNull();
    expect(r.stats.skipped).toBe(2);
    expect(r.notice).toBeTruthy();
    const single = arpeggiateChords(s.project, [ids[0]], { pattern: 'up' });
    expect(single.command).toBeNull();
    expect(single.notice).toBeTruthy();
  });
});

describe('arpeggio rhythm and ends (ADR-092)', () => {
  it('8th notes: steps every 240 ticks from the chord start, the pattern repeating to the end of the span', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 1920), note(0, 64, 1920), note(0, 67, 1920)]);
    const r = arpeggiateChords(s.project, ids, { pattern: 'up', rhythm: '8' });
    s.run(r.command);
    expect(s.rows().map((x) => [x[0], x[1], x[2]])).toEqual([
      [0, 60, 192],
      [240, 64, 192],
      [480, 67, 192],
      [720, 60, 192],
      [960, 64, 192],
      [1200, 67, 192],
      [1440, 60, 192],
      [1680, 64, 192],
    ]);
    // the originals keep their ids, the repeats are new notes
    expect(r.ids.slice(0, 3)).toEqual(ids);
    expect(r.ids.length).toBe(8);
    s.undo();
    expect(s.rows().length).toBe(3);
  });

  it('triplet 8ths and 16ths follow the PPQ', () => {
    expect(arpeggioStepTicks('8t', 480)).toBe(160);
    expect(arpeggioStepTicks('16', 96)).toBe(24);
    expect(arpeggioStepTicks('32', 480)).toBe(60);
    expect(arpeggioStepTicks('4', 480)).toBe(480);
  });

  it('hold: every step sounds to the end of the span (a slow strum); the even split keeps its onsets', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 960), note(0, 64, 960), note(0, 67, 960)]);
    s.run(arpeggiateChords(s.project, ids, { pattern: 'up', ends: 'hold' }).command);
    expect(s.rows().map((x) => [x[0], x[1], x[2]])).toEqual([
      [0, 60, 960],
      [320, 64, 640],
      [640, 67, 320],
    ]);
  });

  it('hold with a repeating rhythm: a note ends where its pitch is struck again', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 960), note(0, 64, 960)]);
    s.run(arpeggiateChords(s.project, ids, { pattern: 'up', rhythm: '8', ends: 'hold' }).command);
    expect(s.rows().map((x) => [x[0], x[1], x[2]])).toEqual([
      [0, 60, 480],
      [240, 64, 480],
      [480, 60, 480],
      [720, 64, 240],
    ]);
  });

  it('hold with up and down: the turning note is cut where it comes back', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 960), note(0, 64, 960), note(0, 67, 960)]);
    s.run(arpeggiateChords(s.project, ids, { pattern: 'updown', ends: 'hold' }).command);
    // steps 0 / 240 / 480 / 720: 60 64 67 64 — the first 64 ends at 720
    expect(s.rows().map((x) => [x[0], x[1], x[2]])).toEqual([
      [0, 60, 960],
      [240, 64, 480],
      [480, 67, 480],
      [720, 64, 240],
    ]);
  });

  it('a note value too long for every note of the chord leaves the chord alone with a notice', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 960), note(0, 64, 960), note(0, 67, 960)]);
    const r = arpeggiateChords(s.project, ids, { pattern: 'up', rhythm: '4' });
    expect(r.command).toBeNull();
    expect(r.notice).toBeTruthy();
  });
});

describe('naming the automatic note length (ADR-092)', () => {
  it('a 3-note chord over 2 beats comes to quarter triplets; 4 notes over 2 beats to 8ths; up and down counts the turning notes', () => {
    const s = new Session();
    const three = s.add([note(0, 60, 960), note(0, 64, 960), note(0, 67, 960)]);
    const four = s.add([note(1920, 60, 960), note(1920, 64, 960), note(1920, 67, 960), note(1920, 72, 960)]);
    expect(arpeggioStepLengths(s.project, three, { pattern: 'up' }).map((x) => noteValueName(x, 480))).toEqual(['3 連 4 分']);
    expect(arpeggioStepLengths(s.project, four, { pattern: 'up' }).map((x) => noteValueName(x, 480))).toEqual(['8 分']);
    // C E G E over 2 beats: 4 steps = 8ths
    expect(arpeggioStepLengths(s.project, three, { pattern: 'updown' }).map((x) => noteValueName(x, 480))).toEqual(['8 分']);
    // a note value is that value; chords left alone are not listed
    expect(arpeggioStepLengths(s.project, [...three, ...four], { pattern: 'up', rhythm: '16' })).toEqual([120, 120]);
    expect(arpeggioStepLengths(s.project, three, { pattern: 'up', rhythm: '4' })).toEqual([]);
  });

  it('names the usual note values at any PPQ, and nothing else', () => {
    expect(noteValueName(480, 480)).toBe('4 分');
    expect(noteValueName(320, 480)).toBe('3 連 4 分');
    expect(noteValueName(360, 480)).toBe('付点 8 分');
    expect(noteValueName(48, 96)).toBe('8 分');
    expect(noteValueName(1920, 480)).toBe('全音符');
    expect(noteValueName(213.33, 480)).toBeNull();
  });
});

describe('a 6-string chord up and down in 8ths (the open Em7 022030 in one bar, user report)', () => {
  it('is spread: every note sounds, the pattern turns and stops where the bar ends', () => {
    const s = new Session();
    const ids = s.add([40, 47, 50, 55, 59, 64].map((p) => note(0, p, 1920)));
    const r = arpeggiateChords(s.project, ids, { pattern: 'updown', rhythm: '8', ends: 'hold' });
    expect(r.notice).toBeNull();
    s.run(r.command);
    // up E2 B2 D3 G3 B3 E4, down B3 G3; held to the bar end, or to where the pitch comes back
    expect(s.rows().map((x) => [x[0], x[1], x[2]])).toEqual([
      [0, 40, 1920],
      [240, 47, 1680],
      [480, 50, 1440],
      [720, 55, 960],
      [960, 59, 480],
      [1200, 64, 720],
      [1440, 59, 480],
      [1680, 55, 240],
    ]);
  });
  it('a note value too long for every note to sound once is left alone, with its own reason', () => {
    const s = new Session();
    const ids = s.add([40, 47, 50, 55, 59, 64].map((p) => note(0, p, 1920)));
    const r = arpeggiateChords(s.project, ids, { pattern: 'up', rhythm: '4' });
    expect(r.command).toBeNull();
    expect(r.notice).toContain('音符が長すぎて');
  });
});
