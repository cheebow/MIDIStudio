import { beforeEach, describe, expect, it } from 'vitest';
import { setIdGenerator, createCounterIdGenerator } from '../../src/core/model/ids';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import type { MidiProject, NoteEvent } from '../../src/core/model/types';
import { bend, build, cc, format0Song, format1Song, meta, off, on, port, program, sysex, tempo, text, timeSig, GS_RESET } from '../fixtures/songs';

beforeEach(() => {
  setIdGenerator(createCounterIdGenerator('t'));
});

function open(bytes: Uint8Array) {
  const r = openMidiFile(bytes);
  if (!r.ok) throw new Error(r.errors[0].message);
  return r;
}
const notes = (p: MidiProject, track = 0) => p.tracks[track].events.filter((e): e is NoteEvent => e.kind === 'note');

import { validateProject } from '../../src/core/project-io/projectFile';
import { smf, trackBytes } from '../fixtures/songs';

describe('SMF import: robustness', () => {
  it('imports a track with 150,000 events (no argument spreading over huge arrays)', () => {
    const ev = [] as ReturnType<typeof cc>[];
    for (let i = 0; i < 150_000; i++) ev.push(cc(1, 0, 11, i % 128));
    const { project } = open(smf(1, 480, [trackBytes(ev)]));
    expect(project.tracks[0].events).toHaveLength(150_000);
    expect(project.loop.endTick).toBe(150_000);
  });

  it('out-of-range key / time signatures stay raw metas, and the project still validates (what the importer accepts, the file format accepts)', () => {
    const { project, issues } = open(build(1, 480, [meta(0, 0x59, [9, 0]), meta(0, 0x58, [0, 2, 24, 8]), tempo(0, 500000), on(0, 0, 60), off(480, 0, 60)]));
    expect(project.conductor.map((c) => c.kind)).toEqual(['tempo']);
    const kept = [...project.conductorMeta.map((m) => m.metaType), ...project.tracks.flatMap((t) => t.events.filter((e) => e.kind === 'meta').map((e) => (e.kind === 'meta' ? e.metaType : -1)))].sort();
    expect(kept).toEqual([0x58, 0x59]); // kept as raw metas for export, not dropped
    expect(issues.length).toBeGreaterThan(0);
    expect(validateProject(project)).toEqual([]);
  });
});

describe('SMF import', () => {
  it('C01: Format 1 conductor track becomes tempo/time/marker data; tracks keep name and channel', () => {
    const { project } = open(format1Song());
    expect(project.title).toBe('Test Song');
    expect(project.tracks.map((t) => [t.name, t.channel, t.displayMode])).toEqual([
      ['Piano', 0, 'melodic'],
      ['Drums', 9, 'drum'],
    ]);
    expect(project.conductor.map((c) => c.kind)).toEqual(['tempo', 'time-signature', 'tempo', 'time-signature', 'marker']);
    expect(project.conductor.filter((c) => c.kind === 'tempo').map((c) => c.tick)).toEqual([0, 1920]);
    expect(project.conductorMeta.map((m) => m.metaType)).toEqual([0x02]); // copyright kept for export
  });

  it('C01: Format 0 is split per channel; SysEx goes to a leading System track', () => {
    const { project, issues } = open(format0Song());
    expect(project.ppq).toBe(96);
    expect(project.title).toBe('F0 Song');
    expect(project.tracks.map((t) => [t.name, t.channel])).toEqual([
      ['System', 0],
      ['Ch 1', 0],
      ['Ch 2', 1],
    ]);
    expect(project.tracks[0].events.map((e) => e.kind)).toEqual(['sysex']);
    expect(notes(project, 1).map((n) => [n.pitch, n.durationTicks])).toEqual([
      [60, 96],
      [62, 96],
    ]);
    expect(issues.some((i) => i.code === 'I_IMPORT_FORMAT0_SPLIT')).toBe(true);
  });

  it('C05: same-tick chords keep their order; a retriggered note is not lost', () => {
    const { project, issues } = open(build(1, 480, [on(0, 0, 60), on(0, 0, 64), on(0, 0, 67), on(240, 0, 60, 90), off(240, 0, 60), off(0, 0, 64), off(0, 0, 67), off(240, 0, 60)]));
    const ns = notes(project);
    expect(ns.map((n) => [n.tick, n.pitch, n.velocity, n.durationTicks])).toEqual([
      [0, 60, 100, 480],
      [0, 64, 100, 480],
      [0, 67, 100, 480],
      [240, 60, 90, 480],
    ]);
    expect(issues.some((i) => i.code === 'W_IMPORT_NOTE_OVERLAP')).toBe(true);
  });

  it('C06: Note On velocity 0 becomes a Note Off and keeps its encoding; release velocity is kept', () => {
    const { project } = open(build(1, 480, [on(0, 0, 60), on(480, 0, 60, 0), on(0, 0, 62), off(480, 0, 62, 33)]));
    const [a, b] = notes(project);
    expect(a).toMatchObject({ pitch: 60, durationTicks: 480, sourceEncoding: 'note-on-zero', releaseVelocity: 0 });
    expect(b).toMatchObject({ pitch: 62, durationTicks: 480, sourceEncoding: 'note-off', releaseVelocity: 33 });
  });

  it('C09: Bank Select, Program, RPN/NRPN sequences and Pitch Bend keep value, order and channel', () => {
    const { project } = open(
      build(1, 480, [cc(0, 3, 0, 8), cc(0, 3, 32, 1), program(0, 3, 48), cc(0, 3, 101, 0), cc(0, 3, 100, 0), cc(0, 3, 6, 12), cc(0, 3, 99, 1), cc(0, 3, 98, 8), cc(0, 3, 6, 64), bend(10, 3, -8192), bend(0, 3, 0), bend(0, 3, 8191)]),
    );
    const t = project.tracks[0];
    expect(t.channel).toBe(3);
    expect(t.events.map((e) => (e.kind === 'cc' ? `cc${e.controller}=${e.value}` : e.kind === 'program' ? `pc${e.program}` : e.kind === 'pitch-bend' ? `pb${e.value}` : e.kind))).toEqual([
      'cc0=8',
      'cc32=1',
      'pc48',
      'cc101=0',
      'cc100=0',
      'cc6=12',
      'cc99=1',
      'cc98=8',
      'cc6=64',
      'pb-8192',
      'pb0',
      'pb8191',
    ]);
  });

  it('C10: same channel on ports A and B stays independent', () => {
    const { project } = open(build(1, 480, [port(0, 0), on(0, 0, 60), off(480, 0, 60)], [port(0, 1), on(0, 0, 60), off(480, 0, 60)]));
    expect(project.tracks.map((t) => [t.port, t.channel, t.hasPortPrefix])).toEqual([
      ['A', 0, true],
      ['B', 0, true],
    ]);
  });

  it('keeps multi-channel tracks with channelOverride and keeps mid-track port changes as events', () => {
    const { project, issues } = open(build(1, 480, [on(0, 0, 60), off(10, 0, 60), on(0, 0, 61), off(10, 0, 61), on(0, 5, 62), off(10, 5, 62), port(0, 2)]));
    const t = project.tracks[0];
    expect(t.channel).toBe(0);
    expect(notes(project).map((n) => n.channelOverride)).toEqual([undefined, undefined, 5]);
    expect(t.events.some((e) => e.kind === 'meta' && e.metaType === 0x21)).toBe(true);
    expect(issues.some((i) => i.code === 'W_IMPORT_PORT_CHANGE')).toBe(true);
  });

  it('E11 / rule 3: unpaired and zero-length notes are kept as raw events with a warning', () => {
    const { project, issues } = open(build(1, 480, [off(0, 0, 50), on(0, 0, 51), off(0, 0, 51), on(10, 0, 52), cc(0, 0, 120, 0), cc(0, 0, 3, 77)]));
    const t = project.tracks[0];
    expect(t.events.filter((e) => e.kind === 'raw').map((e) => e.kind === 'raw' && e.reason)).toEqual(['unpaired-note-off', 'zero-length-note', 'zero-length-note', 'unpaired-note-on']);
    expect(t.events.filter((e) => e.kind === 'cc').length).toBe(2); // unknown CC 3 kept
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['W_IMPORT_UNPAIRED_NOTE_OFF', 'W_IMPORT_ZERO_LENGTH_NOTE', 'W_IMPORT_UNPAIRED_NOTE_ON']));
  });

  it('moves tempo from a music track to the conductor and creates a clip per track', () => {
    const { project, issues } = open(build(1, 480, [text(0, 0x03, 'Only'), tempo(0, 300000), timeSig(0, 6, 3), sysex(0, GS_RESET), on(0, 0, 60), off(960, 0, 60), meta(0, 0x05, [0x61])]));
    expect(project.conductor.map((c) => c.kind)).toEqual(['tempo', 'time-signature']);
    expect(project.tracks[0].events.map((e) => e.kind)).toEqual(['sysex', 'note', 'meta']);
    expect(project.clips).toHaveLength(1);
    expect(project.clips[0]).toMatchObject({ startTick: 0, endTick: 960 });
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['I_IMPORT_CONDUCTOR_MERGED', 'I_IMPORT_NO_CONDUCTOR_TRACK']));
  });

  it('decodes non-UTF-8 names with the injected decoder and keeps the source bytes', () => {
    const sjis = [0x83, 0x73, 0x83, 0x41, 0x83, 0x6d]; // "ピアノ" in Shift_JIS
    const bytes = build(1, 480, [meta(0, 0x03, sjis), on(0, 0, 60), off(10, 0, 60)]);
    const r = openMidiFile(bytes, { decodeText: () => 'ピアノ' });
    if (!r.ok) throw new Error();
    expect(r.project.tracks[0].name).toBe('ピアノ');
    expect(r.project.tracks[0].sourceName?.text).toBe('ピアノ');
  });
});
