// ADR-086: core regressions / bugs found in the second review.
import { describe, expect, it } from 'vitest';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { projectToSmf } from '../../src/core/project-io/exportSmf';
import { addEvents, moveEvents, updateEvents } from '../../src/core/editing/operations';
import { applyCommand } from '../../src/core/editing/history';
import { build, cc, off, on, program } from '../fixtures/songs';
import { sortEvents } from '../../src/core/events/order';
import { parseProjectFile, serializeProject } from '../../src/core/project-io/projectFile';
import { createEmptyProject } from '../../src/core/model/defaults';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const at480 = (p: any) => projectToSmf(p).smf.tracks[1].events.filter((e: any) => e.kind === 'channel' && e.tick === 480).map((e: any) => (e.status & 0xf0).toString(16) + ':' + e.data[0]);

describe('ADR-086: same-tick renumbering keeps imported Note Offs in place; rank changes re-place', () => {
  it('pedal down before an imported Note Off stays before it after adding a Program at that tick', () => {
    const o = openMidiFile(build(1, 480, [on(0, 0, 60), cc(480, 0, 64, 127), off(0, 0, 60), on(0, 0, 62), off(480, 0, 62)]));
    if (!o.ok) throw new Error();
    const p = o.project;
    expect(at480(p)).toEqual(['b0:64', '80:60', '90:62']);
    const r = addEvents(p, p.tracks[0].id, [{ kind: 'program', tick: 480, program: 5 }])!;
    const q = applyCommand(p, r.command).project;
    expect(at480(q).indexOf('b0:64')).toBeLessThan(at480(q).indexOf('80:60'));
  });
  it('same after moving a program onto that tick', () => {
    const o = openMidiFile(build(1, 480, [cc(0, 0, 7, 100), on(0, 0, 60), cc(480, 0, 64, 127), off(0, 0, 60), on(0, 0, 62), off(480, 0, 62)]));
    if (!o.ok) throw new Error();
    const p0 = o.project;
    const p = applyCommand(p0, addEvents(p0, p0.tracks[0].id, [{ kind: 'program', tick: 960, program: 5 }])!.command).project;
    const pc = p.tracks[0].events.find((e) => e.kind === 'program')!;
    const q = applyCommand(p, moveEvents(p, [pc.id], -480)!).project;
    expect(at480(q).indexOf('b0:64')).toBeLessThan(at480(q).indexOf('80:60'));
  });
  it('changing a CC number to Bank Select on a Program tick keeps Bank before Program', () => {
    const o = openMidiFile(build(1, 480, [program(0, 0, 3), cc(0, 0, 7, 100), on(0, 0, 60), off(480, 0, 60)]));
    if (!o.ok) throw new Error();
    const p = o.project;
    const c = p.tracks[0].events.find((e) => e.kind === 'cc')!;
    const q = applyCommand(p, updateEvents(p, [{ id: c.id, changes: { controller: 0 } }])!).project;
    const kinds = sortEvents(q.tracks[0].events.filter((e) => e.tick === 0)).map((e) => e.kind + (e.kind === 'cc' ? e.controller : ''));
    expect(kinds.indexOf('cc0')).toBeLessThan(kinds.indexOf('program'));
  });
});

describe('ADR-086: projects with 1–3 BPM saved by 0.7.0 open', () => {
  it('a project saved by 0.7.0 or earlier with a 2 BPM tempo opens', () => {
    const p = createEmptyProject();
    const q = { ...p, conductor: p.conductor.map((c) => (c.kind === 'tempo' ? { ...c, usPerQuarter: 30_000_000 } : c)) };
    const r = parseProjectFile(serializeProject(q));
    expect(r.ok).toBe(true);
  });
});
