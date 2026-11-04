import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../../src/core/model/ids';
import { recognizeChord, voiceChords } from '../../../src/core/editing/perform';
import { allForms, formPitches, formsFor, frettedFrets, QUALITY_INTERVALS, TUNING } from '../../../src/core/editing/perform/chordForms';
import { note, Session } from './helpers';

beforeEach(() => setIdGenerator(createCounterIdGenerator('e')));

describe('chord form library (PT-01, ADR-079)', () => {
  it('every generated form sounds its chord (sevenths may omit the fifth), on adjacent strings, holdable with four fingers', () => {
    expect(TUNING).toEqual([40, 45, 50, 55, 59, 64]);
    const forms = allForms();
    expect(forms.length).toBeGreaterThan(1000);
    for (const f of forms) {
      const p = formPitches(f);
      const pcs = new Set(p.map((x) => x % 12));
      const want = QUALITY_INTERVALS[f.quality].map((i) => (f.root + i) % 12);
      const fifth = (f.root + 7) % 12;
      const missing = want.filter((x) => !pcs.has(x));
      expect([...pcs].filter((x) => !want.includes(x)), f.name).toEqual([]);
      expect(missing.length === 0 || (missing.length === 1 && missing[0] === fifth && want.length === 4), f.name).toBe(true);
      expect(new Set(p).size, `${f.name}: no unison`).toBe(p.length);
      const played = f.frets.map((x, i) => (x === null ? -1 : i)).filter((i) => i >= 0);
      expect(played.length, f.name).toBeGreaterThanOrEqual(3);
      expect(played[played.length - 1] - played[0] + 1, `${f.name}: adjacent strings`).toBe(played.length);
      const fr = frettedFrets(f);
      if (fr.length) {
        expect(Math.max(...fr) - Math.min(...fr), f.name).toBeLessThanOrEqual(3);
        expect(Math.max(...fr), f.name).toBeLessThanOrEqual(15);
        expect(fr.length <= 4 || fr.filter((x) => x > Math.min(...fr)).length <= 3, `${f.name}: four fingers`).toBe(true);
      }
    }
  });
  it('contains the familiar shapes', () => {
    const has = (root: number, q: Parameters<typeof formsFor>[1], frets: (number | null)[]) => formsFor(root, q).some((f) => f.frets.join() === frets.join());
    const X = null;
    expect(has(0, 'maj', [X, 3, 2, 0, 1, 0])).toBe(true); // C x32010
    expect(has(9, 'min', [X, 0, 2, 2, 1, 0])).toBe(true); // Am x02210
    expect(has(5, 'maj', [1, 3, 3, 2, 1, 1])).toBe(true); // F barre
    expect(has(7, 'maj', [3, 2, 0, 0, 0, 3])).toBe(true); // G 320003
    expect(has(5, 'maj7', [X, X, 3, 2, 1, 0])).toBe(true); // Fmaj7 xx3210
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
  it('auto keeps the register: C4 E4 G4 becomes C4 E4 G4 C5 (4 strings on top); ids kept, the new note joins the clip, one undo step', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(0, 64), note(0, 67)]);
    const r = voiceChords(s.project, ids, { voicing: 'auto' });
    s.run(r.command);
    expect(s.rows().map((x) => x[1])).toEqual([60, 64, 67, 72]);
    const all = s.notes().map((n) => n.id);
    expect(ids.every((id) => all.includes(id))).toBe(true);
    expect(new Set(all).size).toBe(4);
    expect([...r.ids].sort()).toEqual([...all].sort());
    expect(s.project.clips.length).toBe(1);
    expect(s.project.clips[0].eventIds).toEqual(expect.arrayContaining(all));
    expect(s.notes().every((n) => n.tick === 0 && n.durationTicks === 480)).toBe(true);
    expect(s.history.past.length).toBe(2);
    s.undo();
    expect(s.rows().map((x) => x[1])).toEqual([60, 64, 67]);
    s.redo();
    expect(s.notes().length).toBe(4);
  });

  it('"open" moves to the open strings with the root in the bass: C = x32013, Am = x02210', () => {
    const s = new Session();
    const c = s.add([note(0, 60), note(0, 64), note(0, 67)]);
    s.run(voiceChords(s.project, c, { voicing: 'open' }).command);
    expect(s.rows().map((x) => x[1])).toEqual([48, 52, 55, 60, 67]);
    const t = new Session();
    const am = t.add([note(0, 57), note(0, 60), note(0, 64)]);
    t.run(voiceChords(t.project, am, { voicing: 'open' }).command);
    expect(t.rows().map((x) => x[1])).toEqual([45, 52, 57, 60, 64]);
    t.undo();
    t.run(voiceChords(t.project, am, { voicing: 'auto' }).command);
    expect(t.rows().map((x) => x[1])).toEqual([57, 60, 64, 69]);
  });

  it('a high close voicing stays high and moves smoothly (Fmaj7 - Em7 - Am7 - Dm7 - G7 around C5)', () => {
    const s = new Session();
    const chords = [
      [65, 69, 72, 76],
      [64, 67, 71, 74],
      [64, 67, 69, 72],
      [62, 65, 69, 72],
      [62, 65, 67, 71],
    ];
    const ids = s.add(chords.flatMap((c, i) => c.map((p) => note(i * 960, p, 200))));
    s.run(voiceChords(s.project, ids, { voicing: 'auto' }).command);
    const out = chords.map((_, i) => s.notes().filter((n) => n.tick === i * 960).map((n) => n.pitch));
    expect(out).toEqual([
      [65, 69, 72, 76], // F4 A4 C5 E5 is already playable (D-G-B-E strings, frets 15-14-13-12)
      [64, 67, 74, 76],
      [57, 60, 67, 72],
      [62, 65, 72, 74],
      [62, 67, 71, 77],
    ]);
    for (let i = 0; i < 5; i++) {
      expect(out[i].length).toBe(4); // the string count does not jump
      expect(recognizeChord(out[i])?.quality).toBe(recognizeChord(chords[i])?.quality); // Em7 may drop its fifth
    }
    // and with "open" the same progression is played with the familiar open shapes
    s.undo();
    s.run(voiceChords(s.project, ids, { voicing: 'open' }).command);
    expect(chords.map((_, i) => s.notes().filter((n) => n.tick === i * 960).map((n) => n.pitch))).toEqual([
      [41, 45, 52, 57, 60, 64], // Fmaj7 102210
      [40, 47, 50, 55, 59, 64], // Em7 020000
      [45, 52, 55, 60, 64], // Am7 x02010
      [50, 57, 60, 65], // Dm7 xx0211
      [43, 47, 50, 55, 59, 65], // G7 320001
    ]);
  });

  it('C → Am → F → G keeps every chord quality and never exceeds 6 strings', () => {
    const s = new Session();
    const chords = [
      [60, 64, 67],
      [57, 60, 64],
      [53, 57, 60],
      [55, 59, 62],
    ];
    const ids = s.add(chords.flatMap((c, i) => c.map((p) => note(i * 960, p, 960))));
    for (const preset of ['auto', 'open', 'high'] as const) {
      const r = voiceChords(s.project, ids, { voicing: preset });
      expect(r.stats).toEqual({ notes: 12, groups: 4, skipped: 0 });
      s.run(r.command);
      for (let i = 0; i < 4; i++) {
        const pitches = s.notes().filter((n) => n.tick === i * 960).map((n) => n.pitch);
        expect(pitches.length).toBeLessThanOrEqual(6);
        expect(new Set(pitches.map((p) => p % 12))).toEqual(new Set(chords[i].map((p) => p % 12)));
      }
      s.undo();
    }
  });

  it('"high" never goes below a low input', () => {
    const s = new Session();
    const ids = s.add([note(0, 48), note(0, 52), note(0, 55)]);
    s.run(voiceChords(s.project, ids, { voicing: 'high' }).command);
    const low = Math.min(...s.notes().map((n) => n.pitch));
    expect(low).toBeGreaterThanOrEqual(48);
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
    expect(s.rows().map((x) => x[1])).toEqual([48, 52, 55, 60, 67]);
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
