// ADR-087: core bugs found in the third review (whole-codebase pass).
import { describe, expect, it } from 'vitest';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { readSmf } from '../../src/core/smf/reader';
import { projectToSmf } from '../../src/core/project-io/exportSmf';
import { compareSmfSemantics } from '../../src/core/smf/semantic';
import { setTempo } from '../../src/core/editing/conductorOps';
import { applyCommand } from '../../src/core/editing/history';
import { TempoMap } from '../../src/core/timing/tempoMap';
import { build, on, off, smf, trackBytes, tempo, port } from '../fixtures/songs';

describe('r3 core', () => {
  it('format 0 with 2 MTrk: the second track is not dropped', () => {
    const bytes = new Uint8Array(smf(0, 480, [trackBytes([on(0, 0, 60), off(480, 0, 60)]), trackBytes([on(0, 1, 64), off(480, 1, 64)])]));
    const r = readSmf(bytes);
    expect(r.ok).toBe(true);
    const o = openMidiFile(bytes);
    if (!o.ok) throw new Error();
    const notes = o.project.tracks.flatMap((t) => t.events.filter((e) => e.kind === 'note'));
    expect(notes.length).toBe(2);
  });

  it('format 0: a port change (FF 21) in the middle is kept at its tick', () => {
    const bytes = new Uint8Array(smf(0, 480, [trackBytes([on(0, 0, 60), off(480, 0, 60), port(0, 1), on(0, 0, 62), off(480, 0, 62)])]));
    const r = readSmf(bytes);
    if (!r.ok) throw new Error();
    const o = openMidiFile(bytes);
    if (!o.ok) throw new Error();
    const d = compareSmfSemantics(r.smf, projectToSmf(o.project).smf);
    expect(d.differences).toEqual([]);
  });

  it('setTempo on two tempos at one tick changes the effective one', () => {
    const bytes = build(1, 480, [tempo(0, 500000), tempo(0, 600000)], [on(0, 0, 60), off(480, 0, 60)]);
    const o = openMidiFile(bytes);
    if (!o.ok) throw new Error();
    const p = applyCommand(o.project, setTempo(o.project, 0, 150)).project;
    const map = new TempoMap(p.ppq, p.conductor.filter((c) => c.kind === 'tempo') as never);
    expect(Math.round(map.bpmAt(0))).toBe(150);
  });
});
