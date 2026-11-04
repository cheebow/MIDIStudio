import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../../src/core/model/ids';
import { recognizeChord, voiceChords } from '../../../src/core/editing/perform';
import { allForms, formPitches, frettedFrets, QUALITY_INTERVALS, TUNING } from '../../../src/core/editing/perform/chordForms';
import { note, Session } from './helpers';

beforeEach(() => setIdGenerator(createCounterIdGenerator('e')));

describe('chord form library (PT-01)', () => {
  it('every form sounds its chord (sevenths may omit the fifth), uses at most 6 strings and spans at most 4 frets', () => {
    expect(TUNING).toEqual([40, 45, 50, 55, 59, 64]);
    const forms = allForms();
    expect(forms.length).toBeGreaterThan(200);
    for (const f of forms) {
      const pcs = new Set(formPitches(f).map((p) => p % 12));
      const want = QUALITY_INTERVALS[f.quality].map((i) => (f.root + i) % 12);
      const fifth = (f.root + 7) % 12;
      const missing = want.filter((x) => !pcs.has(x));
      const extra = [...pcs].filter((x) => !want.includes(x));
      expect(extra, f.name).toEqual([]);
      expect(missing.length === 0 || (missing.length === 1 && missing[0] === fifth && want.length === 4), f.name).toBe(true);
      expect(pcs.has(f.root), f.name).toBe(true);
      expect(f.frets.length).toBe(6);
      const fr = frettedFrets(f);
      expect(Math.max(...fr) - Math.min(...fr), f.name).toBeLessThanOrEqual(4);
      expect(f.frets.filter((x) => x !== null).length, f.name).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('chord recognition', () => {
  it('reads the supported qualities, with the lowest note as the root when ambiguous', () => {
    expect(recognizeChord([60, 64, 67])).toMatchObject({ root: 0, quality: 'maj', name: 'C' });
    expect(recognizeChord([57, 60, 64])).toMatchObject({ root: 9, quality: 'min', name: 'Am' });
    expect(recognizeChord([55, 59, 62, 65])).toMatchObject({ root: 7, quality: '7' });
    expect(recognizeChord([55, 59, 65])).toMatchObject({ root: 7, quality: '7' }); // no fifth
    expect(recognizeChord([60, 64, 67, 71])).toMatchObject({ quality: 'maj7' });
    expect(recognizeChord([62, 65, 69, 72])).toMatchObject({ root: 2, quality: 'm7' });
    expect(recognizeChord([60, 62, 67])).toMatchObject({ root: 0, quality: 'sus2' });
    expect(recognizeChord([55, 60, 62])).toMatchObject({ root: 7, quality: 'sus4' });
    expect(recognizeChord([59, 62, 65])).toMatchObject({ root: 11, quality: 'dim' });
    expect(recognizeChord([60, 64, 68])).toMatchObject({ root: 0, quality: 'aug' });
    expect(recognizeChord([64, 68, 72])).toMatchObject({ root: 4, quality: 'aug' });
    expect(recognizeChord([64, 67, 72])).toMatchObject({ root: 0, quality: 'maj' }); // inversion
  });
  it('refuses what it cannot name', () => {
    expect(recognizeChord([60, 64])).toBeNull();
    expect(recognizeChord([60, 61, 62])).toBeNull();
    expect(recognizeChord([60, 62, 64, 67, 71])).toBeNull(); // add9 and other tensions are out of scope
    expect(recognizeChord([])).toBeNull();
  });
});

describe('guitar voicing (PT-01)', () => {
  it('C major becomes x32010 (48 52 55 60 64): 3 ids kept, 2 new notes in the clip, one undo step', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(0, 64), note(0, 67)]);
    const r = voiceChords(s.project, ids, { voicing: 'auto' });
    s.run(r.command);
    expect(s.rows()).toEqual([
      [0, 48, 480, 100],
      [0, 52, 480, 100],
      [0, 55, 480, 100],
      [0, 60, 480, 100],
      [0, 64, 480, 100],
    ]);
    const all = s.notes().map((n) => n.id);
    expect(ids.every((id) => all.includes(id))).toBe(true);
    expect(new Set(all).size).toBe(5);
    expect(r.ids.sort()).toEqual([...all].sort());
    expect(s.project.clips.length).toBe(1);
    expect(s.project.clips[0].eventIds).toEqual(expect.arrayContaining(all));
    expect(s.history.past.length).toBe(2);
    s.undo();
    expect(s.rows().map((x) => x[1])).toEqual([60, 64, 67]);
    s.redo();
    expect(s.notes().length).toBe(5);
  });

  it('Am becomes x02210; "open" and "auto" agree, "high" picks a barre form above the 5th fret', () => {
    const s = new Session();
    const ids = s.add([note(0, 57), note(0, 60), note(0, 64)]);
    const auto = voiceChords(s.project, ids, { voicing: 'auto' });
    const open = voiceChords(s.project, ids, { voicing: 'open' });
    s.run(auto.command);
    expect(s.rows().map((x) => x[1])).toEqual([45, 52, 57, 60, 64]);
    s.undo();
    s.run(open.command);
    expect(s.rows().map((x) => x[1])).toEqual([45, 52, 57, 60, 64]);
    s.undo();
    s.run(voiceChords(s.project, ids, { voicing: 'high' }).command);
    expect(s.rows().map((x) => x[1])).toEqual([45, 52, 57, 60, 64, 69]); // E-shape barre at the 5th fret: 5 7 7 5 5 5
  });

  it('C → Am → F → G keeps every chord quality, never exceeds 6 strings, and does not jump far', () => {
    const s = new Session();
    const chords = [
      [60, 64, 67],
      [57, 60, 64],
      [53, 57, 60],
      [55, 59, 62],
    ];
    const ids = s.add(chords.flatMap((c, i) => c.map((p) => note(i * 960, p, 960))));
    const r = voiceChords(s.project, ids, { voicing: 'auto' });
    s.run(r.command);
    expect(r.stats).toEqual({ notes: 12, groups: 4, skipped: 0 });
    for (let i = 0; i < 4; i++) {
      const pitches = s.notes().filter((n) => n.tick === i * 960).map((n) => n.pitch);
      expect(pitches.length).toBeLessThanOrEqual(6);
      expect(new Set(pitches.map((p) => p % 12))).toEqual(new Set(chords[i].map((p) => p % 12)));
    }
    expect(s.notes().filter((n) => n.tick === 1920).map((n) => n.pitch)).toEqual([53, 57, 60, 65]); // F = xx3211
  });

  it('a repeated chord keeps the same form; unknown chords stay and are counted', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(0, 64), note(0, 67), note(480, 60), note(480, 64), note(480, 67), note(960, 60), note(960, 61), note(960, 62)]);
    const r = voiceChords(s.project, ids, { voicing: 'high' });
    s.run(r.command);
    const a = s.notes().filter((n) => n.tick === 0).map((n) => n.pitch);
    const b = s.notes().filter((n) => n.tick === 480).map((n) => n.pitch);
    expect(a).toEqual(b);
    expect(s.notes().filter((n) => n.tick === 960).map((n) => n.pitch)).toEqual([60, 61, 62]);
    expect(r.stats.skipped).toBe(1);
    expect(r.notice).toContain('1');
  });

  it('more input notes than strings are deleted (doubled octaves fold into the form)', () => {
    const s = new Session();
    const ids = s.add([48, 52, 55, 60, 64, 67, 72].map((p) => note(0, p)));
    s.run(voiceChords(s.project, ids, { voicing: 'open' }).command);
    expect(s.rows().map((x) => x[1])).toEqual([48, 52, 55, 60, 64]);
    s.undo();
    expect(s.notes().length).toBe(7);
  });

  it('nothing recognisable: no command, a notice', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(0, 61)]);
    const r = voiceChords(s.project, ids, { voicing: 'auto' });
    expect(r.command).toBeNull();
    expect(r.notice).toBeTruthy();
  });
});
