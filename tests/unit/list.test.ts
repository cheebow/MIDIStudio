import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { exportSmfBytes } from '../../src/core/project-io/exportSmf';
import { applyCommand } from '../../src/core/editing/history';
import { formatTicks, listRows, type RowCategory } from '../../src/core/list/listRows';
import { parseTicksInput, setAbsoluteTick, setGateTime, setRowValue, setStepTime } from '../../src/core/list/listEdit';
import { followState, lastRowAtOrBefore, topRow } from '../../src/core/list/follow';
import type { MidiProject } from '../../src/core/model/types';
import { build, cc, off, on, program, sysex, timeSig, GS_RESET } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('l')));

function song(ppq = 480): MidiProject {
  const q = ppq;
  const r = openMidiFile(build(1, ppq, [timeSig(0, 4, 2)], [sysex(0, GS_RESET), program(0, 0, 48), on(0, 0, 60), on(0, 0, 64), off(q, 0, 60), off(0, 0, 64), cc(0, 0, 11, 100), on(q, 0, 67), off(q / 2, 0, 67), on(q * 4, 0, 72), off(q, 0, 72)]));
  if (!r.ok) throw new Error();
  return r.project;
}
const apply = (p: MidiProject, c: ReturnType<typeof setStepTime>) => (c ? applyCommand(p, c).project : p);

describe('list rows (REQ-EDT-09/10/11)', () => {
  it('MEAS / STEP / NOTE / K# / ST / GT / VEL for every event kind', () => {
    const p = song();
    const rows = listRows(p, p.tracks[0]);
    expect(rows.map((r) => [r.meas, r.step, r.name, r.key, r.stTicks, r.gtTicks, r.value])).toEqual([
      [1, 1, 'GS Reset', null, 0, null, null],
      [1, 2, 'PC49', null, 0, null, 49],
      [1, 3, 'C4', 60, 0, 480, 100],
      [1, 4, 'E4', 64, 480, 480, 100],
      [1, 5, 'CC11', null, 480, null, 100],
      [1, 6, 'G4', 67, 2160, 240, 100],
      [2, 1, 'C5', 72, null, 480, 100],
    ]);
    expect(rows[0].detail).toBe('GS Reset');
    expect(rows[1].detail).toBe('String Ensemble 1');
  });

  it('E07 / C15: Classic48 changes only the display; inexact values are shown exactly', () => {
    expect(formatTicks(480, 'classic48', 480)).toBe('48');
    expect(formatTicks(240, 'classic48', 480)).toBe('24');
    expect(formatTicks(25, 'classic48', 960)).toBe('1.25');
    expect(formatTicks(1, 'classic48', 1000)).toBe('0.048');
    expect(formatTicks(null, 'native', 480)).toBe('--');
    expect(parseTicksInput('12', 'classic48', 480)).toEqual({ ok: true, ticks: 120 });
    const bad = parseTicksInput('1', 'classic48', 1000);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/125\/6/);
    expect(parseTicksInput('1.5', 'native', 480).ok).toBe(false);
  });

  it('a filtered view keeps ST computed over all events and reports hidden rows (E12)', () => {
    const p = song();
    const onlyNotes = listRows(p, p.tracks[0], new Set<RowCategory>(['note']));
    expect(onlyNotes.map((r) => r.name)).toEqual(['C4', 'E4', 'G4', 'C5']);
    // E4's ST is the distance to the hidden CC11 (480), not to G4 (960)
    expect(onlyNotes[1].stTicks).toBe(480);
    expect(onlyNotes[2].index - onlyNotes[1].index - 1).toBe(1);
  });
});

describe('conductor rows (LIST-14)', () => {
  it('tempo / time signature rows interleave in time order without touching the track ST or STEP numbers', () => {
    const p = song();
    const plain = listRows(p, p.tracks[0]);
    const withCond = listRows(p, p.tracks[0], undefined, undefined, { conductor: true });
    expect(withCond.filter((r) => r.category === 'conductor').map((r) => [r.name, r.tick, r.detail, r.value, r.stTicks, r.step])).toEqual([['TS', 0, '4/4', null, null, 0]]);
    expect(withCond[0].category).toBe('conductor'); // same tick: the conductor comes first
    expect(withCond.filter((r) => r.category !== 'conductor')).toEqual(plain); // track rows unchanged (ST, STEP, index)
    expect(listRows(p, p.tracks[0], undefined, undefined, { conductor: false })).toEqual(plain);
  });
});

describe('list edits', () => {
  it('E05: ST edit ripples only the later events and is undoable', () => {
    const p = song();
    const rows = listRows(p, p.tracks[0]);
    const e4 = rows[3];
    const cmd = setStepTime(p, p.tracks[0].id, e4.id, 960)!;
    const { project: q, inverse } = applyCommand(p, cmd);
    const after = listRows(q, q.tracks[0]);
    expect(after.map((r) => r.tick)).toEqual([0, 0, 0, 0, 960, 1440, 3600]);
    expect(after.slice(0, 4).map((r) => r.tick)).toEqual(rows.slice(0, 4).map((r) => r.tick)); // earlier rows untouched
    expect(after.find((r) => r.name === 'G4')!.gtTicks).toBe(240); // lengths untouched
    expect(applyCommand(q, inverse).project).toEqual(p);
    expect(() => setStepTime(p, p.tracks[0].id, rows[6].id, 10)).toThrow(/最後/);
  });

  it('E06: GT edit changes only that Note Off; nothing else moves', () => {
    const p = song();
    const rows = listRows(p, p.tracks[0]);
    const q = apply(p, setGateTime(p, rows[2].id, 1000));
    const after = listRows(q, q.tracks[0]);
    expect(after.map((r) => r.tick)).toEqual(rows.map((r) => r.tick));
    expect(after[2].gtTicks).toBe(1000);
    const smf = exportSmfBytes(q).bytes;
    const back = openMidiFile(smf);
    if (!back.ok) throw new Error();
    const c4 = back.project.tracks[0].events.find((e) => e.kind === 'note' && e.pitch === 60);
    expect(c4 && c4.kind === 'note' && c4.durationTicks).toBe(1000);
  });

  it('absolute tick edit moves only one event; VEL / program / CC values', () => {
    const p = song();
    const rows = listRows(p, p.tracks[0]);
    let q = apply(p, setAbsoluteTick(p, rows[5].id, 100));
    expect(listRows(q, q.tracks[0]).map((r) => r.name)).toEqual(['GS Reset', 'PC49', 'C4', 'E4', 'G4', 'CC11', 'C5']);
    q = apply(q, setRowValue(q, rows[1].id, 1)); // UI program 1 = MIDI 0
    const pc = q.tracks[0].events.find((e) => e.kind === 'program');
    expect(pc && pc.kind === 'program' && pc.program).toBe(0);
    expect(() => setRowValue(q, rows[2].id, 0)).toThrow(); // velocity 0 refused
    expect(() => setRowValue(q, rows[0].id, 5)).toThrow(); // GS Reset has no editable value
  });
});

describe('visual mode follow (P06 / P07 / P08)', () => {
  const ticks = [0, 0, 0, 480, 960, 960, 5000];

  it('P06: all rows at the current tick are current; long rests show the distance to the next event', () => {
    expect(followState(ticks, 0)).toEqual({ current: [0, 2], next: 3, ticksToNext: 480 });
    expect(followState(ticks, 970)).toEqual({ current: [4, 5], next: 6, ticksToNext: 4030 });
    expect(followState(ticks, 99999)).toEqual({ current: [6, 6], next: null, ticksToNext: null });
    expect(followState([480], 0)).toEqual({ current: null, next: 0, ticksToNext: 480 });
    expect(lastRowAtOrBefore([], 10)).toBe(-1);
  });

  it('P07: panes are pure functions of the same transport tick', () => {
    const a = [0, 240, 480];
    const b = [0, 120, 240, 360, 480];
    for (const pos of [0, 250, 480]) {
      const ta = a[followState(a, pos).current![1]];
      const tb = b[followState(b, pos).current![1]];
      expect(ta).toBeLessThanOrEqual(pos);
      expect(tb).toBeLessThanOrEqual(pos);
    }
  });

  it('P08: page turn / fixed cursor re-sync immediately after a seek or loop back', () => {
    expect(topRow('page-turn', 0, 20, 100)).toBe(0);
    expect(topRow('page-turn', 19, 20, 100)).toBe(0);
    expect(topRow('page-turn', 20, 20, 100)).toBe(20);
    expect(topRow('page-turn', 3, 20, 100)).toBe(0); // looped back
    expect(topRow('fixed-cursor', 50, 21, 100)).toBe(43);
    expect(topRow('fixed-cursor', 2, 21, 100)).toBe(0);
    expect(topRow('fixed-cursor', 99, 21, 100)).toBe(79);
  });
});

import { buildDisplayRows } from '../../src/ui/visual/VisualMonitor';
import { TimeSignatureMap } from '../../src/core/timing/timeSignatureMap';

describe('visual mode list rows (RCM layout)', () => {
  it('MEAS on the first row of a bar, STEP per tick group, a separator row between bars', () => {
    const r = openMidiFile(build(1, 480, [on(0, 0, 69), on(0, 0, 66), off(240, 0, 69), off(0, 0, 66), on(0, 0, 68), off(1680, 0, 68), on(0, 0, 60), off(480, 0, 60)]));
    if (!r.ok) throw new Error();
    const p = r.project;
    const rows = listRows(p, p.tracks[0]);
    const { display, eventToDisplay } = buildDisplayRows(rows, new TimeSignatureMap(480, []));
    expect(display.map((d) => (d.kind === 'bar' ? `bar:${d.lengthTicks}` : `${d.showMeas ? d.row.meas : ''}|${d.step ?? ''}|${d.row.name}`))).toEqual(['1|1|A4', '||F#4', '|2|G#4', 'bar:1920', '2|1|C4']);
    expect(eventToDisplay).toEqual([0, 1, 2, 4]);
  });
});

import { spellPitch } from '../../src/ui/visual/VisualMonitor';

describe('visual mode staff spelling', () => {
  it('sharps without a key, flats in flat keys, key-signature accidentals omitted, naturals when cancelled', () => {
    expect(spellPitch(61, 0)).toEqual({ step: 4 * 7 + 0, accidental: '♯' }); // C#4
    expect(spellPitch(60, 0).accidental).toBe('');
    expect(spellPitch(70, -1)).toEqual({ step: 4 * 7 + 6, accidental: '' }); // Bb4 in F major
    expect(spellPitch(71, -1).accidental).toBe('♮'); // B natural in F major
    expect(spellPitch(66, 1).accidental).toBe(''); // F#4 in G major
    expect(spellPitch(65, 1).accidental).toBe('♮');
    expect(spellPitch(63, -3)).toEqual({ step: 4 * 7 + 2, accidental: '' }); // Eb in Eb major
    expect(spellPitch(68, 3).accidental).toBe(''); // G# in A major
    expect(spellPitch(68, 0).accidental).toBe('♯');
  });
});

import { noteName } from '../../src/core/list/listRows';
import { meta } from '../fixtures/songs';

describe('note names follow the key signature (absolute names, enharmonic by key)', () => {
  it('flat keys name black keys with flats; sharp keys and no key with sharps', () => {
    expect(noteName(70)).toBe('A#4');
    expect(noteName(70, 2)).toBe('A#4');
    expect(noteName(70, -1)).toBe('Bb4');
    expect(noteName(61, -3)).toBe('Db4');
    expect(noteName(60, -1)).toBe('C4');
  });

  it('list rows use the key in effect at each note; drum tracks keep plain names', () => {
    // F major (1 flat) from tick 0, D major (2 sharps) from tick 960
    const r = openMidiFile(build(1, 480, [meta(0, 0x59, [0xff, 0]), on(0, 0, 70), off(480, 0, 70), meta(480, 0x59, [2, 0]), on(0, 0, 70), off(480, 0, 70)]));
    if (!r.ok) throw new Error(r.errors[0].message);
    const p = r.project;
    const notes = listRows(p, p.tracks[0]).filter((x) => x.category === 'note');
    expect(notes.map((x) => x.name)).toEqual(['Bb4', 'A#4']);
  });
});
