import { describe, expect, it } from 'vitest';
import { readSmf } from '../../src/core/smf/reader';
import { writeSmf } from '../../src/core/smf/writer';
import { compareSmfSemantics } from '../../src/core/smf/semantic';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { exportSmfBytes, projectToSmf } from '../../src/core/project-io/exportSmf';
import { moveEvents } from '../../src/core/editing/operations';
import type { SmfFile } from '../../src/core/smf/types';
import { bend, build, cc, format0Song, format1Song, meta, off, on, port, program, sysex, sysexF7, tempo, text, timeSig, GS_RESET, GS_RHYTHM_PART_11 } from '../fixtures/songs';

function parse(bytes: Uint8Array): SmfFile {
  const r = readSmf(bytes);
  if (!r.ok) throw new Error(r.errors[0].message);
  return r.smf;
}

function roundtrip(bytes: Uint8Array) {
  const opened = openMidiFile(bytes);
  if (!opened.ok) throw new Error(opened.errors[0].message);
  const { bytes: out, warnings } = exportSmfBytes(opened.project);
  return { original: parse(bytes), exported: parse(out), project: opened.project, warnings };
}

const cases: [string, Uint8Array][] = [
  ['Format 1 song with GS SysEx and unknown metas', format1Song()],
  ['Format 1 at PPQ 960', format1Song(960)],
  ['Format 0 with running status (PPQ 96)', format0Song()],
  ['retriggered overlapping notes', build(1, 480, [on(0, 0, 60), on(240, 0, 60, 90), off(240, 0, 60), off(240, 0, 60)])],
  ['unpaired / zero-length notes', build(1, 480, [off(0, 0, 50), on(0, 0, 51), off(0, 0, 51), on(10, 0, 52)])],
  ['two ports, same channel', build(1, 480, [port(0, 0), on(0, 0, 60), off(480, 0, 60)], [port(0, 1), on(0, 0, 60), off(480, 0, 60)])],
  ['RPN/NRPN and pitch bend extremes', build(1, 480, [cc(0, 3, 101, 0), cc(0, 3, 100, 0), cc(0, 3, 6, 12), cc(0, 3, 99, 1), cc(0, 3, 98, 8), cc(0, 3, 6, 64), bend(0, 3, -8192), bend(10, 3, 8191), bend(10, 3, 0)])],
  ['GS SysEx (F0 and F7 continuation)', build(1, 480, [sysex(0, GS_RESET), sysex(10, GS_RHYTHM_PART_11), sysexF7(10, [0x01, 0x02, 0xf7])])],
  ['note-off ordering at the same tick as a new note', build(1, 480, [on(0, 0, 60), off(480, 0, 60), on(0, 0, 60), off(480, 0, 60), program(0, 0, 5), on(0, 0, 61), off(10, 0, 61)])],
  ['multi-channel track with mid-track port change', build(1, 480, [on(0, 0, 60), on(0, 5, 62), off(10, 0, 60), off(0, 5, 62), port(0, 2), cc(0, 5, 7, 90)])],
  ['meta events in a music track', build(1, 480, [text(0, 0x03, 'Vox'), meta(0, 0x05, [0x6c, 0x61]), on(0, 0, 60), meta(0, 0x01, [0x41]), off(480, 0, 60), meta(0, 0x7f, [0, 0, 0x41])])],
  ['trailing silence after the last note', build(1, 480, [tempo(0, 500000), timeSig(0, 4, 2)], [on(0, 0, 60), off(480, 0, 60), meta(1920, 0x01, [0x20])])],
];

describe('SMF semantic round trip (C13, C08, REQ-MIDI-03)', () => {
  it.each(cases)('%s: import -> export (no edit) is semantically equal', (_name, bytes) => {
    const { original, exported, warnings } = roundtrip(bytes);
    const diff = compareSmfSemantics(original, exported);
    expect(diff.differences).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('C08: GS SysEx payload and tick survive import -> save -> export', () => {
    const { exported } = roundtrip(format1Song());
    const sx = exported.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'sysex');
    expect(sx).toHaveLength(1);
    expect(sx[0].tick).toBe(0);
    expect([...(sx[0] as { data: Uint8Array }).data]).toEqual(GS_RESET);
  });

  it('writes Format 1 with the conductor in track 0 and preserves PPQ', () => {
    const { exported, project } = roundtrip(format0Song());
    expect(exported.format).toBe(1);
    expect(exported.ppq).toBe(96);
    expect(exported.tracks).toHaveLength(project.tracks.length + 1);
    expect(exported.tracks[0].events.some((e) => e.kind === 'meta' && e.metaType === 0x51)).toBe(true);
  });

  it('a second round trip is stable (export -> import -> export)', () => {
    const first = roundtrip(format1Song());
    const again = roundtrip(writeSmf(first.exported));
    expect(compareSmfSemantics(first.exported, again.exported).differences).toEqual([]);
  });

  it('the comparator detects real differences', () => {
    const a = parse(build(1, 480, [on(0, 0, 60), off(480, 0, 60)]));
    const b = parse(build(1, 480, [on(0, 0, 60), off(481, 0, 60)]));
    expect(compareSmfSemantics(a, b).equal).toBe(false);
    const c = parse(build(1, 480, [program(0, 0, 1), cc(0, 0, 0, 1)]));
    const d = parse(build(1, 480, [cc(0, 0, 0, 1), program(0, 0, 1)]));
    expect(compareSmfSemantics(c, d).equal).toBe(false);
  });

  it('MIDI_GS_SPEC 3: UI 1..16 / 1..128 never leak into the file (channel 9 = CH10, program 0 = Piano 1)', () => {
    const { exported } = roundtrip(build(1, 480, [program(0, 9, 0), on(0, 9, 36), off(10, 9, 36)]));
    const ch = exported.tracks[1].events.filter((e) => e.kind === 'channel');
    expect(ch.map((e) => e.kind === 'channel' && e.status)).toEqual([0xc9, 0x99, 0x89]);
    expect(ch[0].kind === 'channel' && ch[0].data).toEqual([0]);
  });

  it('projectToSmf emits generated Note Offs before Note Ons at the same tick for edited notes', () => {
    const opened = openMidiFile(build(1, 480, [on(0, 0, 60), off(480, 0, 60)]));
    if (!opened.ok) throw new Error();
    const p = opened.project;
    const n = p.tracks[0].events[0];
    if (n.kind !== 'note') throw new Error();
    const { releaseOrder: _r, ...edited } = n;
    void _r;
    const next = {
      ...p,
      tracks: [{ ...p.tracks[0], events: [edited, { ...edited, id: 'x', tick: 480, originOrder: 99 }] }],
    };
    const t = projectToSmf(next).smf.tracks[1].events.filter((e) => e.kind === 'channel');
    expect(t.map((e) => e.kind === 'channel' && [e.tick, e.status])).toEqual([
      [0, 0x90],
      [480, 0x80],
      [480, 0x90],
      [960, 0x80],
    ]);
  });

  it('ADR-082: a note moved onto the end of an imported note of the same pitch is not cut by its kept Note Off', () => {
    const opened = openMidiFile(build(1, 480, [on(0, 0, 60), off(480, 0, 60), on(480, 0, 60), off(480, 0, 60)]));
    if (!opened.ok) throw new Error();
    const p = opened.project;
    const notes = p.tracks[0].events.filter((e) => e.kind === 'note');
    const moved = moveEvents(p, [notes[0].id], 1440);
    if (!moved) throw new Error();
    const next = { ...p, ...moved.patch };
    const t = projectToSmf(next).smf.tracks[1].events.filter((e) => e.kind === 'channel');
    expect(t.map((e) => e.kind === 'channel' && [e.tick, e.status])).toEqual([
      [960, 0x90],
      [1440, 0x80],
      [1440, 0x90],
      [1920, 0x80],
    ]);
    const again = openMidiFile(exportSmfBytes(next).bytes);
    if (!again.ok) throw new Error();
    expect(again.issues.map((i) => i.code)).not.toContain('W_IMPORT_NOTE_OVERLAP');
  });
});
