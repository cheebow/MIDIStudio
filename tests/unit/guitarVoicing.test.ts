// Guitar-voicing input assistant (ADR-091, TEST_PLAN U-GTR-*): chord symbols, the curated form
// catalog, frets → MIDI notes, the chord-analysis adapter and the insert command (undo / redo, PPQ,
// time-signature changes, SMF round trip).
import { describe, expect, it } from 'vitest';
import { formatChordSymbol, parseChordSymbol, type ChordSymbol } from '../../src/core/guitar/chordSymbol';
import { GUITAR_FORMS, GUITAR_QUALITIES } from '../../src/core/guitar/voicingCatalog';
import { formLabel, formsFor, fretsToPitches, pitchNames, MAX_FORMS, diagramBaseFret } from '../../src/core/guitar/voicing';
import { chordCandidatesAt } from '../../src/core/guitar/chordContext';
import { buildVoicingCommand, GUITAR_PROGRAM, NO_FREE_CHANNEL, overlappingNotes } from '../../src/core/guitar/insertVoicing';
import { barsEnd, defaultProgressionRange, parseProgression, rowsFromChords } from '../../src/core/guitar/progression';
import { createEmptyProject } from '../../src/core/model/defaults';
import { createHistory, execute, redo, undo } from '../../src/core/editing/history';
import { analyzeChords, chordName, type ChordSegment } from '../../src/core/theory/chords';
import { exportSmfBytes } from '../../src/core/project-io/exportSmf';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { TimeSignatureMap } from '../../src/core/timing/timeSignatureMap';
import { addEvents, addTrack, freeChannel } from '../../src/core/editing/operations';
import type { MidiProject, NoteEvent } from '../../src/core/model/types';
import { looseNoteIds } from '../../src/core/model/looseNotes';

const chord = (text: string): ChordSymbol => {
  const r = parseChordSymbol(text);
  if (!r.ok) throw new Error(`not a chord: ${text}`);
  return r.chord;
};
const notesOf = (p: MidiProject, trackId: string) => p.tracks.find((t) => t.id === trackId)!.events.filter((e): e is NoteEvent => e.kind === 'note');
const QUALITY_TONES: Record<string, number[]> = { maj: [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };

describe('U-GTR-01: frets → sounding MIDI notes (spec 5.2 table)', () => {
  it.each([
    ['x32000', [-1, 3, 2, 0, 0, 0], [48, 52, 55, 59, 64]],
    ['x35453', [-1, 3, 5, 4, 5, 3], [48, 55, 59, 64, 67]],
    ['8-10-9-9-8-8', [8, 10, 9, 9, 8, 8], [48, 55, 59, 64, 67, 72]],
    ['x02210', [-1, 0, 2, 2, 1, 0], [45, 52, 57, 60, 64]],
    ['320001', [3, 2, 0, 0, 0, 1], [43, 47, 50, 55, 59, 65]],
  ])('%s', (label, frets, pitches) => {
    expect(fretsToPitches(frets)).toEqual(pitches);
    expect(formLabel(frets)).toBe(label);
  });
  it('the three Cmaj7 forms and Am / G7 of the table are in the catalog', () => {
    const labels = (c: string) => {
      const r = formsFor(chord(c));
      return r.kind === 'forms' ? r.forms.map((f) => formLabel(f.frets)) : [];
    };
    expect(labels('Cmaj7')).toEqual(expect.arrayContaining(['x32000', 'x35453', '8-10-9-9-8-8']));
    expect(labels('Am')).toContain('x02210');
    expect(labels('G7')).toContain('320001');
  });
  it('MIDI 60 is C4; names are sounding pitch', () => {
    expect(pitchNames(fretsToPitches([-1, 3, 2, 0, 0, 0]))).toBe('C3 E3 G3 B3 E4');
  });
  it('rejects a form that is not six strings', () => {
    expect(() => fretsToPitches([0, 2, 2])).toThrow();
  });
  it('the diagram start fret: 0 near the nut, the lowest fret higher up', () => {
    expect(diagramBaseFret([-1, 3, 2, 0, 0, 0])).toBe(0);
    expect(diagramBaseFret([-1, 3, 5, 4, 5, 3])).toBe(3);
    expect(diagramBaseFret([8, 10, 9, 9, 8, 8])).toBe(8);
  });
});

describe('U-GTR-02: every catalog form is verified', () => {
  it('covers maj / m / 7 / maj7 / m7 on all 12 roots with 2..5 forms each', () => {
    for (const q of GUITAR_QUALITIES) {
      for (let root = 0; root < 12; root++) {
        const r = formsFor({ root, rootName: 'X', quality: q, bass: null, bassName: null });
        expect(r.kind, `${root} ${q}`).toBe('forms');
        if (r.kind === 'forms') {
          expect(r.forms.length, `${root} ${q}`).toBeGreaterThanOrEqual(2);
          expect(r.forms.length).toBeLessThanOrEqual(MAX_FORMS);
        }
      }
    }
  });
  it.each(GUITAR_FORMS.map((f) => [`${chordName(f.root, f.quality, null)} ${formLabel(f.frets)}`, f] as const))('%s', (_name, f) => {
    expect(f.verified).toBe(true);
    const pitches = fretsToPitches(f.frets);
    expect(pitches.length).toBeGreaterThanOrEqual(3);
    const tones = QUALITY_TONES[f.quality].map((i) => (f.root + i) % 12);
    // only chord tones, every tone present except possibly the fifth, the root in the bass
    for (const p of pitches) expect(tones).toContain(p % 12);
    for (const i of QUALITY_TONES[f.quality]) if (i !== 7) expect(pitches.map((p) => p % 12)).toContain((f.root + i) % 12);
    expect(Math.min(...pitches) % 12).toBe(f.root);
    // a hand's reach: pressed frets within four frets, nothing above the 15th fret
    const pressed = f.frets.filter((x) => x > 0);
    if (pressed.length) expect(Math.max(...pressed) - Math.min(...pressed)).toBeLessThanOrEqual(3);
    expect(Math.max(...f.frets)).toBeLessThanOrEqual(15);
  });
  it('no duplicate forms, unique ids', () => {
    const keys = GUITAR_FORMS.map((f) => `${f.root}:${f.quality}:${f.frets.join(',')}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(GUITAR_FORMS.map((f) => f.id)).size).toBe(GUITAR_FORMS.length);
  });
  it('open forms come first, then up the neck', () => {
    const r = formsFor(chord('C'));
    expect(r.kind === 'forms' && r.forms[0].positionLabel).toBe('open');
    expect(r.kind === 'forms' && formLabel(r.forms[0].frets)).toBe('x32010');
  });
});

describe('U-GTR-03: chord symbols', () => {
  it.each([
    ['Cmaj7', 0, 'maj7'],
    ['CM7', 0, 'maj7'],
    ['CΔ7', 0, 'maj7'],
    ['Am7', 9, 'm7'],
    ['Amin7', 9, 'm7'],
    ['A-7', 9, 'm7'],
    ['F#m7b5', 6, 'm7b5'],
    ['F#m7(b5)', 6, 'm7b5'],
    ['Gb', 6, 'maj'],
    ['Bbm', 10, 'm'],
    ['E♭7', 3, '7'],
    ['Em7(11)', 4, 'm11'],
    [' g7 ', 7, '7'],
  ])('%s', (text, root, quality) => {
    const c = chord(text);
    expect(c.root).toBe(root);
    expect(c.quality).toBe(quality);
  });
  it('keeps the spelling for display and writes the analysis form', () => {
    expect(formatChordSymbol(chord('CM7'))).toBe('Cmaj7');
    expect(formatChordSymbol(chord('Gbmaj7'))).toBe('Gbmaj7');
    expect(formatChordSymbol(chord('F#m7b5'))).toBe('F#m7(b5)');
    expect(formatChordSymbol(chord('C/E'))).toBe('C/E');
  });
  it('slash chords: the bass is kept; C/C is C', () => {
    expect(chord('C/E').bass).toBe(4);
    expect(chord('C/C').bass).toBe(null);
  });
  it('an unreadable text is invalid, an empty one is empty', () => {
    expect(parseChordSymbol('H7')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseChordSymbol('Cxyz')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseChordSymbol('C/H')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseChordSymbol('  ')).toEqual({ ok: false, reason: 'empty' });
  });
  it('every name the chord analysis writes parses back to the same chord', () => {
    for (const q of ['maj', 'm', '5', '7', 'maj7', 'm7', 'dim', 'aug', 'sus4', 'sus2', 'm7b5', 'dim7', '6', 'm6', '7sus4', 'add9', '9', 'm9', 'maj9', 'm11'] as const) {
      for (let root = 0; root < 12; root++) {
        const c = chord(chordName(root, q, null));
        expect([c.root, c.quality]).toEqual([root, q]);
      }
    }
    expect(chord(chordName(0, 'maj', 4)).bass).toBe(4);
  });
});

describe('U-GTR-04: searching forms (typed name = picked root + type; nothing approximated)', () => {
  it('typing Cmaj7 and picking C + maj7 give the same forms', () => {
    const typed = formsFor(chord('Cmaj7'));
    const picked = formsFor({ root: 0, rootName: 'C', quality: 'maj7', bass: null, bassName: null });
    expect(typed).toEqual(picked);
  });
  it('a valid chord without forms is "no forms", not invalid', () => {
    expect(formsFor(chord('Csus4')).kind).toBe('no-forms');
    expect(formsFor(chord('Cm7(b5)')).kind).toBe('no-forms');
  });
  it('a slash chord only matches forms with that bass; none means no forms (no plain C)', () => {
    expect(formsFor(chord('C/E')).kind).toBe('no-bass-forms');
    expect(formsFor(chord('Am7/G')).kind).toBe('no-bass-forms');
  });
});

describe('U-GTR-05: the chord-analysis adapter', () => {
  const seg = (tick: number, endTick: number, name: string): ChordSegment => ({ tick, endTick, root: 0, quality: 'maj7', bass: null, name });
  it('finds the span holding the tick (start inclusive, end exclusive)', () => {
    const segs = [seg(0, 1920, 'Cmaj7'), seg(1920, 3840, 'Am7')];
    expect(chordCandidatesAt(segs, 0).map((c) => c.chordSymbol)).toEqual(['Cmaj7']);
    expect(chordCandidatesAt(segs, 1919).map((c) => c.chordSymbol)).toEqual(['Cmaj7']);
    expect(chordCandidatesAt(segs, 1920).map((c) => c.chordSymbol)).toEqual(['Am7']);
    expect(chordCandidatesAt(segs, 3840)).toEqual([]);
    expect(chordCandidatesAt(segs, 960)[0]).toMatchObject({ startTick: 0, endTick: 1920 });
  });
  it('no analysis, an empty one or a bad tick is not an error', () => {
    expect(chordCandidatesAt(null, 0)).toEqual([]);
    expect(chordCandidatesAt([], 0)).toEqual([]);
    expect(chordCandidatesAt([seg(0, 10, 'C')], Number.NaN)).toEqual([]);
  });
  it('several results at one tick are all returned (the dialog asks which)', () => {
    expect(chordCandidatesAt([seg(0, 1920, 'Cmaj7'), seg(0, 1920, 'Em/C')], 100).map((c) => c.chordSymbol)).toEqual(['Cmaj7', 'Em/C']);
  });
  it('works on a real analysis: a Cmaj7 bar is found from its middle', () => {
    let p = createEmptyProject();
    const tr = p.tracks[0].id;
    const r = addEvents(p, tr, [48, 52, 55, 59, 64].map((pitch) => ({ kind: 'note' as const, tick: 0, pitch, velocity: 100, durationTicks: 1920, releaseVelocity: 64 })))!;
    p = { ...p, ...r.command.patch };
    const c = chordCandidatesAt(analyzeChords(p), 480);
    expect(c.map((x) => x.chordSymbol)).toEqual(['Cmaj7']);
    expect(c[0].endTick - 480).toBe(1440);
  });
});

describe('U-GTR-06: inserting a form', () => {
  const cmaj7 = fretsToPitches([-1, 3, 2, 0, 0, 0]);
  it('into an existing track: the notes at the tick and length, one undo step, redo restores', () => {
    const p0 = createEmptyProject();
    const tr = p0.tracks[0].id;
    const r = buildVoicingCommand(p0, { target: { trackId: tr }, chords: [{ tick: 960, length: 1920, pitches: cmaj7 }], velocity: p0.inputPresets.defaultVelocity });
    let h = createHistory();
    const s1 = execute(p0, h, r.command);
    h = s1.history;
    const notes = notesOf(s1.project, tr);
    expect(notes.map((n) => n.pitch).sort((a, b) => a - b)).toEqual([48, 52, 55, 59, 64]);
    expect(notes.every((n) => n.tick === 960 && n.durationTicks === 1920 && n.velocity === 100)).toBe(true);
    // the notes join a clip (they would be silent and not exported otherwise: ADR-064)
    expect(looseNoteIds(s1.project, s1.project.tracks[0]).size).toBe(0);
    const u = undo(s1.project, h);
    expect(notesOf(u.project, tr)).toEqual([]);
    expect(u.project.clips).toEqual(p0.clips);
    const re = redo(u.project, u.history);
    expect(notesOf(re.project, tr).length).toBe(5);
  });
  it('a new guitar track + Program 25 + notes is one undo step', () => {
    const p0 = createEmptyProject();
    const r = buildVoicingCommand(p0, { target: { newTrack: { name: 'ギター' } }, chords: [{ tick: 0, length: 480, pitches: cmaj7 }], velocity: 100 });
    const s1 = execute(p0, createHistory(), r.command);
    const t = s1.project.tracks.find((x) => x.id === r.trackId)!;
    expect(t.name).toBe('ギター');
    expect(t.channel).toBe(1); // Track 1 is on channel 1 (index 0)
    expect(t.events.find((e) => e.kind === 'program')).toMatchObject({ tick: 0, program: GUITAR_PROGRAM });
    expect(notesOf(s1.project, r.trackId).length).toBe(5);
    expect(r.ids.length).toBe(5);
    const u = undo(s1.project, s1.history);
    expect(u.project.tracks.map((x) => x.id)).toEqual(p0.tracks.map((x) => x.id));
    expect(u.project.clips).toEqual(p0.clips);
    const re = redo(u.project, u.history);
    expect(notesOf(re.project, r.trackId).length).toBe(5);
  });
  it('never replaces existing notes; overlaps are only counted', () => {
    let p = createEmptyProject();
    const tr = p.tracks[0].id;
    p = { ...p, ...addEvents(p, tr, [{ kind: 'note', tick: 0, pitch: 48, velocity: 90, durationTicks: 960, releaseVelocity: 64 }])!.command.patch };
    expect(overlappingNotes(p, tr, 480, 480)).toBe(1);
    expect(overlappingNotes(p, tr, 960, 480)).toBe(0);
    const r = buildVoicingCommand(p, { target: { trackId: tr }, chords: [{ tick: 480, length: 480, pitches: cmaj7 }], velocity: 100 });
    p = { ...p, ...r.command.patch };
    expect(notesOf(p, tr).length).toBe(6);
    expect(notesOf(p, tr).find((n) => n.velocity === 90)).toMatchObject({ tick: 0, pitch: 48, durationTicks: 960 });
  });
  it('refuses a zero / negative length or a bad tick', () => {
    const p = createEmptyProject();
    const target = { trackId: p.tracks[0].id };
    expect(() => buildVoicingCommand(p, { target, chords: [{ tick: 0, length: 0, pitches: cmaj7 }], velocity: 100 })).toThrow();
    expect(() => buildVoicingCommand(p, { target, chords: [{ tick: -1, length: 10, pitches: cmaj7 }], velocity: 100 })).toThrow();
    expect(() => buildVoicingCommand(p, { target, chords: [{ tick: 0, length: 10, pitches: [] }], velocity: 100 })).toThrow();
  });
});

describe('U-GTR-07: other PPQs, time-signature changes, mid-song bars, SMF round trip', () => {
  it.each([96, 480, 960])('PPQ %i with a 3/4 change: one bar from bar 6 is exact and survives SMF export + import', (ppq) => {
    let p = createEmptyProject({ ppq });
    // 4/4 for bars 1-4, then 3/4
    p = { ...p, conductor: [...p.conductor, { id: 'ts2', kind: 'time-signature', tick: ppq * 16, numerator: 3, denominator: 4, originOrder: 5 }] };
    const sig = new TimeSignatureMap(p.ppq, p.conductor.filter((c) => c.kind === 'time-signature'));
    const tick = sig.barBeatToTick(6, 2);
    const length = sig.ticksPerBar(tick);
    expect(tick).toBe(ppq * 16 + ppq * 3 + ppq);
    expect(length).toBe(ppq * 3);
    const tr = p.tracks[0].id;
    const r = buildVoicingCommand(p, { target: { trackId: tr }, chords: [{ tick, length, pitches: fretsToPitches([3, 2, 0, 0, 0, 1]) }], velocity: 100 });
    p = { ...p, ...r.command.patch };
    const back = openMidiFile(exportSmfBytes(p).bytes);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.project.ppq).toBe(ppq);
    const notes = back.project.tracks.flatMap((t) => t.events).filter((e): e is NoteEvent => e.kind === 'note');
    expect(notes.map((n) => n.pitch).sort((a, b) => a - b)).toEqual([43, 47, 50, 55, 59, 65]);
    expect(notes.every((n) => n.tick === tick && n.durationTicks === length)).toBe(true);
  });
  it('a new guitar track exports its Program Change 25', () => {
    const p0 = createEmptyProject();
    const r = buildVoicingCommand(p0, { target: { newTrack: { name: 'Guitar' } }, chords: [{ tick: 0, length: 480, pitches: [48, 52] }], velocity: 100 });
    const back = openMidiFile(exportSmfBytes({ ...p0, ...r.command.patch }).bytes);
    expect(back.ok && back.project.tracks.flatMap((t) => t.events).some((e) => e.kind === 'program' && e.program === GUITAR_PROGRAM)).toBe(true);
  });
});

describe('U-GTR-08: slash chords without a matching form: ignoring the bass is the user\'s choice', () => {
  it('Am7/E has no form starting on E; with ignoreBass the Am7 forms come, those containing E first', () => {
    expect(formsFor(chord('Am7/E')).kind).toBe('no-bass-forms');
    const r = formsFor(chord('Am7/E'), { ignoreBass: true });
    expect(r.kind).toBe('forms');
    if (r.kind !== 'forms') return;
    const am7 = formsFor(chord('Am7'));
    expect(am7.kind === 'forms' && [...r.forms].map((f) => f.id).sort()).toEqual(am7.kind === 'forms' && am7.forms.map((f) => f.id).sort());
    const hasE = r.forms.map((f) => fretsToPitches(f.frets).some((p) => p % 12 === 4));
    expect(hasE.indexOf(false) === -1 || hasE.slice(hasE.indexOf(false)).every((x) => !x)).toBe(true);
  });
  it('ignoreBass changes nothing for a chord without a bass, and a matching slash form still wins without it', () => {
    expect(formsFor(chord('Am7'), { ignoreBass: true })).toEqual(formsFor(chord('Am7')));
  });
});

describe('U-GTR-09: progressions', () => {
  const sig44 = new TimeSignatureMap(480, [{ tick: 0, numerator: 4, denominator: 4 }]);
  it('bars split by |, two chords in a bar get half each', () => {
    expect(parseProgression('Am7 | Dm7 G7 | Cmaj7', 0, sig44)).toEqual([
      { tick: 0, length: 1920, text: 'Am7' },
      { tick: 1920, length: 960, text: 'Dm7' },
      { tick: 2880, length: 960, text: 'G7' },
      { tick: 3840, length: 1920, text: 'Cmaj7' },
    ]);
  });
  it('without |, one chord per bar; from a mid-bar start; % repeats; an empty bar holds', () => {
    expect(parseProgression('C G', 480, sig44)).toEqual([
      { tick: 480, length: 1920, text: 'C' },
      { tick: 2400, length: 1920, text: 'G' },
    ]);
    expect(parseProgression('| C | % | | F |', 0, sig44)).toEqual([
      { tick: 0, length: 1920 * 3, text: 'C' },
      { tick: 1920 * 3, length: 1920, text: 'F' },
    ]);
    expect(parseProgression('  ', 0, sig44)).toEqual([]);
    // a bad name stays as written (shown on its row, never replaced)
    expect(parseProgression('C | Hm', 0, sig44)[1].text).toBe('Hm');
  });
  it('follows time-signature changes, three chords split a 3/4 bar exactly', () => {
    const sig = new TimeSignatureMap(480, [
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 1920, numerator: 3, denominator: 4 },
    ]);
    const rows = parseProgression('C | D E F', 0, sig);
    expect(rows.map((r) => [r.tick, r.length])).toEqual([[0, 1920], [1920, 480], [2400, 480], [2880, 480]]);
    expect(barsEnd(sig, 0, 3)).toBe(1920 + 1440 * 2);
  });
  it('rows from the analysis are clipped to the range', () => {
    const segs: ChordSegment[] = [
      { tick: 0, endTick: 1920, root: 0, quality: 'maj7', bass: null, name: 'Cmaj7' },
      { tick: 1920, endTick: 3840, root: 7, quality: '7', bass: null, name: 'G7' },
      { tick: 3840, endTick: 5760, root: 0, quality: 'maj', bass: null, name: 'C' },
    ];
    expect(rowsFromChords(segs, 960, 3840)).toEqual([
      { tick: 960, length: 960, text: 'Cmaj7' },
      { tick: 1920, length: 1920, text: 'G7' },
    ]);
    expect(rowsFromChords([], 0, 100)).toEqual([]);
  });
  it('the range opens on the loop range when the right-click is inside it, else four bars from the click', () => {
    const loop = { startTick: 0, endTick: 7680 };
    expect(defaultProgressionRange(960, loop, 960 + 7680)).toEqual({ start: 0, end: 7680 });
    expect(defaultProgressionRange(7680, loop, 7680 * 2)).toEqual({ start: 7680, end: 15360 });
    expect(defaultProgressionRange(0, { startTick: 100, endTick: 100 }, 7680)).toEqual({ start: 0, end: 7680 });
  });
  it('a whole progression is one undo step', () => {
    const p0 = createEmptyProject();
    const tr = p0.tracks[0].id;
    const chords = parseProgression('C | G7', 0, sig44).map((r) => {
      const f = formsFor(chord(r.text));
      if (f.kind !== 'forms') throw new Error('no forms');
      return { tick: r.tick, length: r.length, pitches: fretsToPitches(f.forms[0].frets) };
    });
    const r = buildVoicingCommand(p0, { target: { trackId: tr }, chords, velocity: 100 });
    const s1 = execute(p0, createHistory(), r.command);
    const notes = notesOf(s1.project, tr);
    expect(notes.filter((n) => n.tick === 0).map((n) => n.pitch).sort((a, b) => a - b)).toEqual([48, 52, 55, 60, 64]);
    expect(notes.filter((n) => n.tick === 1920).map((n) => n.pitch).sort((a, b) => a - b)).toEqual([43, 47, 50, 55, 59, 65]);
    expect(notesOf(undo(s1.project, s1.history).project, tr)).toEqual([]);
  });
});

describe('U-GTR-10: review fixes (ADR-092 review)', () => {
  const cmaj7 = fretsToPitches([-1, 3, 2, 0, 0, 0]);
  it('a new guitar track inserted far into the song gets a clip around the chord, not from bar 1', () => {
    const p0 = createEmptyProject();
    const bar33 = 1920 * 32;
    const r = buildVoicingCommand(p0, { target: { newTrack: { name: 'ギター' } }, chords: [{ tick: bar33, length: 1920, pitches: cmaj7 }], velocity: 100 });
    const p = { ...p0, ...r.command.patch };
    const clips = p.clips.filter((c) => c.trackId === r.trackId);
    expect(clips.map((c) => [c.startTick, c.endTick])).toEqual([[bar33, bar33 + 1920]]);
    expect(clips[0].eventIds.sort()).toEqual([...r.ids].sort());
    // the Program Change is still at tick 0, and it is one undo step
    expect(p.tracks.find((t) => t.id === r.trackId)!.events.find((e) => e.kind === 'program')).toMatchObject({ tick: 0, program: GUITAR_PROGRAM });
    const s1 = execute(p0, createHistory(), r.command);
    expect(undo(s1.project, s1.history).project.tracks.length).toBe(p0.tracks.length);
  });
  it('no free port-A channel: a new track is refused instead of sharing one (which would change that track\'s sound)', () => {
    let p = createEmptyProject();
    for (let ch = 1; ch < 16; ch++) if (ch !== 9) p = { ...p, ...addTrack(p, { name: `T${ch}`, channel: ch }).command.patch };
    expect(freeChannel(p)).toBeNull();
    expect(() => buildVoicingCommand(p, { target: { newTrack: { name: 'ギター' } }, chords: [{ tick: 0, length: 480, pitches: cmaj7 }], velocity: 100 })).toThrow(NO_FREE_CHANNEL);
    // an existing track still works
    expect(() => buildVoicingCommand(p, { target: { trackId: p.tracks[0].id }, chords: [{ tick: 0, length: 480, pitches: cmaj7 }], velocity: 100 })).not.toThrow();
  });
  it('bar lines before the first chord never move the progression', () => {
    const sig44 = new TimeSignatureMap(480, [{ tick: 0, numerator: 4, denominator: 4 }]);
    expect(parseProgression('| | C | G', 0, sig44).map((r) => [r.tick, r.text])).toEqual([
      [0, 'C'],
      [1920, 'G'],
    ]);
    expect(parseProgression('C | G | | |', 0, sig44).map((r) => [r.tick, r.length])).toEqual([
      [0, 1920],
      [1920, 1920],
    ]);
    // an empty bar between chords still holds the previous one
    expect(parseProgression('C | | G', 0, sig44).map((r) => [r.tick, r.length, r.text])).toEqual([
      [0, 3840, 'C'],
      [3840, 1920, 'G'],
    ]);
  });
});
