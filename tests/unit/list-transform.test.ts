// LIST-09: batch changes over the selected list rows (ADR-066).
import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { applyCommand, type Command } from '../../src/core/editing/history';
import { listRows } from '../../src/core/list/listRows';
import { batchEditRows, batchSummary } from '../../src/core/list/listTransform';
import type { MidiProject } from '../../src/core/model/types';
import { bend, build, cc, off, on, program, sysex, timeSig, GS_RESET } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('b')));

function song(ppq = 480): MidiProject {
  const q = ppq;
  const r = openMidiFile(build(1, ppq, [timeSig(0, 4, 2)], [sysex(0, GS_RESET), program(0, 0, 0), on(0, 0, 60), off(q, 0, 60), cc(0, 0, 7, 100), bend(0, 0, 0), on(q, 0, 67), off(q / 2, 0, 67)]));
  if (!r.ok) throw new Error();
  return r.project;
}
const rowsOf = (p: MidiProject) => listRows(p, p.tracks[0]);
const apply = (p: MidiProject, c: Command | null) => (c ? applyCommand(p, c).project : p);
const allIds = (p: MidiProject) => p.tracks[0].events.map((e) => e.id);

describe('batch edits (LIST-09)', () => {
  it('summary counts rows by what they have', () => {
    const p = song();
    expect(batchSummary(p, allIds(p))).toEqual({ total: 6, notes: 2, valued: 5, channel: 5, keyed: 2 });
  });

  it('shift moves every selected row (clamped at 0) and is one undo step', () => {
    const p = song();
    const cmd = batchEditRows(p, allIds(p), { kind: 'shift', deltaTicks: 100 })!;
    const { project: q, inverse } = applyCommand(p, cmd);
    expect(rowsOf(q).map((r) => r.tick)).toEqual([100, 100, 100, 580, 580, 1060]); // GS / PC / C4 at 0, CC7 / PB at 480, G4 at 960
    expect(applyCommand(q, inverse).project).toEqual(p);
    const back = apply(q, batchEditRows(q, allIds(q), { kind: 'shift', deltaTicks: -500 }));
    expect(rowsOf(back)[0].tick).toBe(0); // the group keeps its shape; nothing goes below 0
    expect(batchEditRows(p, allIds(p), { kind: 'shift', deltaTicks: 0 })).toBeNull();
    expect(() => batchEditRows(p, allIds(p), { kind: 'shift', deltaTicks: 1.5 })).toThrow();
  });

  it('gate set / percent touch notes only, never below 1 tick', () => {
    const p = song();
    let q = apply(p, batchEditRows(p, allIds(p), { kind: 'gate-percent', percent: 50 }));
    expect(rowsOf(q).filter((r) => r.gtTicks !== null).map((r) => r.gtTicks)).toEqual([240, 120]);
    q = apply(q, batchEditRows(q, allIds(q), { kind: 'gate-percent', percent: 0.01 }));
    expect(rowsOf(q).filter((r) => r.gtTicks !== null).map((r) => r.gtTicks)).toEqual([1, 1]);
    q = apply(q, batchEditRows(q, allIds(q), { kind: 'gate-set', ticks: 30 }));
    expect(rowsOf(q).filter((r) => r.gtTicks !== null).map((r) => r.gtTicks)).toEqual([30, 30]);
    expect(rowsOf(q).map((r) => r.tick)).toEqual(rowsOf(p).map((r) => r.tick));
    expect(() => batchEditRows(p, allIds(p), { kind: 'gate-set', ticks: 0 })).toThrow();
  });

  it('value set / add apply the right field per kind and clamp per kind', () => {
    const p = song();
    let q = apply(p, batchEditRows(p, allIds(p), { kind: 'value-set', value: 64 }));
    expect(rowsOf(q).map((r) => [r.name, r.value])).toEqual([
      ['GS Reset', null],
      ['PC64', 64],
      ['C4', 64],
      ['CC7', 64],
      ['PB', 64],
      ['G4', 64],
    ]);
    q = apply(q, batchEditRows(q, allIds(q), { kind: 'value-add', delta: 100 }));
    expect(rowsOf(q).map((r) => r.value)).toEqual([null, 128, 127, 127, 164, 127]);
    q = apply(q, batchEditRows(q, allIds(q), { kind: 'value-add', delta: -300 }));
    expect(rowsOf(q).map((r) => r.value)).toEqual([null, 1, 1, 0, -136, 1]);
    expect(batchEditRows(q, allIds(q), { kind: 'value-set', value: -9000 })).not.toBeNull(); // PB clamps to -8192, program to 1
    const notes = p.tracks[0].events.filter((e) => e.kind === 'note').map((e) => e.id);
    const cmd = batchEditRows(p, notes, { kind: 'value-add', delta: 5 })!;
    expect(applyCommand(applyCommand(p, cmd).project, applyCommand(p, cmd).inverse).project).toEqual(p);
  });

  it('channel and key set skip rows without them', () => {
    const p = song();
    let q = apply(p, batchEditRows(p, allIds(p), { kind: 'channel', channel: 9 }));
    expect(q.tracks[0].events.filter((e) => 'channelOverride' in e && e.channelOverride === 9).length).toBe(5);
    q = apply(q, batchEditRows(q, allIds(q), { kind: 'channel', channel: null }));
    expect(q.tracks[0].events.some((e) => 'channelOverride' in e && e.channelOverride !== undefined)).toBe(false);
    q = apply(q, batchEditRows(q, allIds(q), { kind: 'key-set', pitch: 72 }));
    expect(rowsOf(q).map((r) => r.name)).toEqual(['GS Reset', 'PC1', 'C5', 'CC7', 'PB', 'C5']);
    expect(() => batchEditRows(p, allIds(p), { kind: 'key-set', pitch: 128 })).toThrow();
    expect(batchEditRows(q, allIds(q), { kind: 'key-set', pitch: 72 })).toBeNull();
  });
});
