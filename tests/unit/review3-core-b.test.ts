// ADR-087: core bugs found in the third review (whole-codebase pass).
import { describe, expect, it } from 'vitest';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { projectToSmf } from '../../src/core/project-io/exportSmf';
import { upsertConductorEvent } from '../../src/core/editing/conductorOps';
import { applyFieldInput } from '../../src/core/editing/noteInfo';
import { applyCommand } from '../../src/core/editing/history';
import { bpmFromUs } from '../../src/core/timing/tempoMap';
import { build, on, meta, tempo, smf, trackBytes, sysex } from '../fixtures/songs';

describe('r3 core b', () => {
  it('moving a Shift_JIS marker keeps its original bytes', () => {
    const sjis = [0x83, 0x65, 0x83, 0x58, 0x83, 0x67]; // "テスト" in Shift_JIS
    const bytes = build(1, 480, [meta(0, 0x06, sjis)], [on(0, 0, 60), [480, 0x80, 60, 64]]);
    const o = openMidiFile(bytes, { decodeText: () => 'テスト' });
    if (!o.ok) throw new Error();
    const m = o.project.conductor.find((c) => c.kind === 'marker')!;
    // TempoEditor row: only the position changes, text unchanged
    const p = applyCommand(o.project, upsertConductorEvent(o.project, 1920, { kind: 'marker', text: 'テスト' }, m.id)).project;
    const ev = projectToSmf(p).smf.tracks[0].events.find((e) => e.kind === 'meta' && e.metaType === 0x06)!;
    expect(Array.from((ev as { data: Uint8Array }).data)).toEqual(sjis);
  });

  it('moving a tempo event keeps its µs value', () => {
    const bytes = build(1, 480, [tempo(0, 500000), tempo(1920, 450000)], [on(0, 0, 60), [480, 0x80, 60, 64]]);
    const o = openMidiFile(bytes);
    if (!o.ok) throw new Error();
    const te = o.project.conductor.find((c) => c.kind === 'tempo' && c.tick === 1920)!;
    if (te.kind !== 'tempo') throw new Error();
    const shown = Math.round(bpmFromUs(te.usPerQuarter) * 100) / 100; // TempoEditor fieldText
    const p = applyCommand(o.project, upsertConductorEvent(o.project, 3840, { kind: 'tempo', bpm: shown }, te.id)).project;
    const moved = p.conductor.find((c) => c.id === te.id)!;
    expect((moved as { usPerQuarter: number }).usPerQuarter).toBe(450000);
  });

  it('release velocity edit on a note-on-zero note reaches the export', () => {
    const bytes = build(1, 480, [tempo(0, 500000)], [on(0, 0, 60), [480, 0x90, 60, 0]]);
    const o = openMidiFile(bytes);
    if (!o.ok) throw new Error();
    const n = o.project.tracks.flatMap((t) => t.events).find((e) => e.kind === 'note')!;
    const p = applyCommand(o.project, applyFieldInput(o.project, [n.id], 'release', { kind: 'set', value: 100 })!).project;
    const evs = projectToSmf(p).smf.tracks[1].events.filter((e) => e.kind === 'channel' && e.tick === 480);
    expect(evs.some((e) => e.kind === 'channel' && e.data[1] === 100)).toBe(true);
  });

  it('format 0: a malformed conductor meta gives one warning', () => {
    const b = new Uint8Array(smf(0, 480, [trackBytes([meta(0, 0x58, [4]), on(0, 0, 60), [480, 0x80, 60, 64]])]));
    const o = openMidiFile(b);
    if (!o.ok) throw new Error();
    expect(o.issues.filter((i) => i.code === 'W_IMPORT_BAD_CONDUCTOR_META').length).toBe(1);
  });
  void sysex;
});
