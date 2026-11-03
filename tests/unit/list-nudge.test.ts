// LIST-04 / LIST-12: +/- increments of list cells and their undo merging (ADR-066).
import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { applyCommand, createHistory, execute, undo } from '../../src/core/editing/history';
import { listRows } from '../../src/core/list/listRows';
import { nudgeCell, nudgedValue } from '../../src/core/list/listNudge';
import type { MidiProject } from '../../src/core/model/types';
import { bend, build, cc, off, on, program, sysex, timeSig } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('n')));

const MASTER_VOLUME_100 = [0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x04, 0x64, 0x58, 0xf7];

function song(ppq = 480): MidiProject {
  const q = ppq;
  const r = openMidiFile(build(1, ppq, [timeSig(0, 4, 2)], [sysex(0, MASTER_VOLUME_100), program(0, 0, 0), on(0, 0, 60), off(q, 0, 60), cc(0, 0, 7, 127), bend(0, 0, 0), on(q, 0, 67), off(q, 0, 67)]));
  if (!r.ok) throw new Error();
  return r.project;
}
const rowsOf = (p: MidiProject) => listRows(p, p.tracks[0]);
const byName = (p: MidiProject, name: string) => rowsOf(p).find((r) => r.name === name)!;
const run = (p: MidiProject, r: ReturnType<typeof nudgeCell>) => (r && 'command' in r && r.command ? applyCommand(p, r.command).project : p);
const opts = (steps: number, unit: 'native' | 'classic48' = 'native', ppq = 480) => ({ steps, unit, ppq });

describe('cell increments (LIST-04)', () => {
  it('clamps to the range of each cell and does nothing at the bound', () => {
    const p = song();
    expect(nudgedValue(byName(p, 'C4'), 'key', opts(1), 0)).toEqual({ ok: true, value: 61 });
    expect(nudgedValue(byName(p, 'C4'), 'key', opts(12), 0)).toEqual({ ok: true, value: 72 });
    expect(nudgedValue(byName(p, 'G4'), 'vel', opts(10), 0)).toEqual({ ok: true, value: 110 });
    expect(nudgedValue(byName(p, 'CC7'), 'vel', opts(1), 0)).toBeNull(); // 127 is the top
    expect(nudgedValue(byName(p, 'CC7'), 'vel', opts(-10), 0)).toEqual({ ok: true, value: 117 });
    expect(nudgedValue(byName(p, 'PC1'), 'vel', opts(-1), 0)).toBeNull(); // program UI 1..128
    expect(nudgedValue(byName(p, 'PC1'), 'vel', opts(200), 0)).toEqual({ ok: true, value: 128 });
    expect(nudgedValue(byName(p, 'PB'), 'vel', opts(1), 0)).toEqual({ ok: true, value: 1 });
    expect(nudgedValue(byName(p, 'PB'), 'vel', opts(10), 0)).toEqual({ ok: true, value: 128 }); // big step on a 14-bit value
    expect(nudgedValue(byName(p, 'PB'), 'vel', opts(-10), 0)).toEqual({ ok: true, value: -128 });
    expect(nudgedValue(byName(p, 'GS'), 'vel', opts(1), 0)).toEqual({ ok: true, value: 101 }); // GS Master Volume 0..127
    expect(nudgedValue(byName(p, 'GS'), 'key', opts(1), 0)).toBeNull();
    expect(nudgedValue(byName(p, 'GS'), 'ch', opts(1), 0)).toBeNull();
    expect(nudgedValue(byName(p, 'C4'), 'ch', opts(1), 0)).toEqual({ ok: true, value: 1 });
    expect(nudgedValue(byName(p, 'C4'), 'ch', opts(-1), 0)).toBeNull();
    expect(nudgedValue(byName(p, 'C4'), 'gt', opts(-1), 0)).toEqual({ ok: true, value: 479 });
    expect(nudgedValue(byName(p, 'G4'), 'st', opts(1), 0)).toBeNull(); // last row has no ST
    expect(nudgedValue(byName(p, 'C4'), 'tick', opts(-1), 0)).toBeNull();
  });

  it('ST / GT / TICK step by 1 tick natively and by ppq/48 in Classic 48; an inexact PPQ is refused', () => {
    const p = song();
    expect(nudgedValue(byName(p, 'C4'), 'gt', opts(1), 0)).toEqual({ ok: true, value: 481 });
    expect(nudgedValue(byName(p, 'C4'), 'gt', opts(1, 'classic48'), 0)).toEqual({ ok: true, value: 490 });
    expect(nudgedValue(byName(p, 'C4'), 'gt', opts(-10, 'classic48'), 0)).toEqual({ ok: true, value: 380 });
    const r = nudgedValue(byName(p, 'C4'), 'gt', opts(1, 'classic48', 1000), 0);
    expect(r && !r.ok && r.message).toMatch(/1000/);
  });

  it('nudgeCell issues the same commands as typing the value', () => {
    const p = song();
    let q = run(p, nudgeCell(p, p.tracks[0].id, byName(p, 'C4'), 'key', opts(1)));
    expect(byName(q, 'C#4')).toBeDefined();
    q = run(q, nudgeCell(q, q.tracks[0].id, byName(q, 'C#4'), 'st', opts(10)));
    expect(byName(q, 'G4').tick).toBe(970); // C4's ST 480 -> 490: the later events ripple by 10
    q = run(q, nudgeCell(q, q.tracks[0].id, byName(q, 'C#4'), 'ch', opts(2)));
    expect(byName(q, 'C#4').event).toMatchObject({ channelOverride: 2 });
    expect(nudgeCell(q, q.tracks[0].id, byName(q, 'G4'), 'st', opts(1))).toBeNull();
    const bad = nudgeCell(q, q.tracks[0].id, byName(q, 'G4'), 'gt', opts(1, 'classic48', 1000));
    expect(bad && 'message' in bad).toBe(true);
  });
});

describe('undo merging of repeated presses (LIST-12)', () => {
  it('three presses with the same mergeKey are one undo step', () => {
    const p = song();
    let h = createHistory();
    let q = p;
    for (let i = 0; i < 3; i++) {
      const r = nudgeCell(q, q.tracks[0].id, byName(q, 'G4'), 'vel', opts(1));
      if (!r || !('command' in r) || !r.command) throw new Error();
      ({ project: q, history: h } = execute(q, h, r.command, { mergeKey: 'list-nudge:x:vel' }));
    }
    expect(byName(q, 'G4').value).toBe(103);
    expect(h.past.length).toBe(1);
    const back = undo(q, h);
    expect(byName(back.project, 'G4').value).toBe(100);
    expect(back.project).toEqual(p);
  });
});
