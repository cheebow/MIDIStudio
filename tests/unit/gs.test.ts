import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { decodeGs, encodeGsDt1, gsPartToChannel, gsResetPayload, partAddress, rolandChecksum } from '../../src/core/gs/gsSysex';
import { gsRhythmChannels, insertGsReset, parseHexPayload, setGsValue, setSysExPayload } from '../../src/core/gs/gsProject';
import { applyCommand } from '../../src/core/editing/history';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { exportSmfBytes } from '../../src/core/project-io/exportSmf';
import { readSmf } from '../../src/core/smf/reader';
import { listRows } from '../../src/core/list/listRows';
import { setBankProgram, setInitialController, setPitchBendRange } from '../../src/core/editing/channelSetup';
import { createClip } from '../../src/core/editing/operations';
import { deleteConductorEvent, setTempo, setTimeSignature } from '../../src/core/editing/conductorOps';
import { GM_PROGRAMS, programLabel } from '../../src/core/gm/instruments';
import { createEmptyProject } from '../../src/core/model/defaults';
import { build, cc, off, on, program, sysex, GS_RESET, GS_RHYTHM_PART_11 } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('g')));

describe('GS SysEx codec', () => {
  it('checksum and the well-known messages', () => {
    expect(rolandChecksum([0x40, 0x00, 0x7f, 0x00])).toBe(0x41);
    expect(gsResetPayload()).toEqual(GS_RESET);
    expect(encodeGsDt1(partAddress(0x15, 10), [0x02])).toEqual(GS_RHYTHM_PART_11);
    expect([0, 1, 9, 10, 15].map(gsPartToChannel)).toEqual([9, 0, 8, 10, 15]);
  });

  it('decodes known parameters with their channel; refuses bad checksums and unknown addresses', () => {
    expect(decodeGs(GS_RESET)?.text).toBe('GS Reset');
    const r = decodeGs(GS_RHYTHM_PART_11)!;
    expect(r).toMatchObject({ channel: 10, text: 'Use for Rhythm Part Ch11 = MAP2' });
    expect(r.param?.engine).toBe(true);
    const lvl = decodeGs(encodeGsDt1(partAddress(0x19, 0), [100]))!;
    expect(lvl.text).toBe('Part Level Ch1 = 100');
    const bad = [...GS_RESET];
    bad[bad.length - 2] = 0x42; // wrong checksum
    expect(decodeGs(bad)).toMatchObject({ checksumOk: false, param: null });
    expect(decodeGs(encodeGsDt1([0x40, 0x01, 0x70], [1]))!.text).toMatch(/未対応/);
    expect(decodeGs([0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7])).toBeNull(); // Yamaha XG: not GS
  });
});

describe('GS in the project (REQ-EDT-08, MIDI_GS_SPEC 9)', () => {
  it('Use for Rhythm Part makes a Ch11 track a drum track on import; events unchanged', () => {
    const r = openMidiFile(build(1, 480, [sysex(0, GS_RESET), sysex(0, GS_RHYTHM_PART_11)], [on(10, 10, 36), off(120, 10, 36)]));
    if (!r.ok) throw new Error();
    expect(r.project.tracks[1].displayMode).toBe('drum');
    expect(r.issues.some((i) => i.code === 'I_GS_RHYTHM_PART')).toBe(true);
    expect(gsRhythmChannels(r.project).get('A:10')).toBe(2);
  });

  it('GS Reset / Rhythm Part survive Import -> Save -> Export with the same payload and tick', () => {
    const src = build(1, 480, [sysex(0, GS_RESET), sysex(240, GS_RHYTHM_PART_11), on(0, 0, 60), off(10, 0, 60)]);
    const r = openMidiFile(src);
    if (!r.ok) throw new Error();
    const out = readSmf(exportSmfBytes(r.project).bytes);
    if (!out.ok) throw new Error();
    const sx = out.smf.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'sysex');
    expect(sx.map((e) => [e.tick, [...(e as { data: Uint8Array }).data]])).toEqual([
      [0, GS_RESET],
      [240, GS_RHYTHM_PART_11],
    ]);
  });

  it('GS Reset is inserted before every other tick-0 event of the track; editing a value rebuilds the checksum', () => {
    const r = openMidiFile(build(1, 480, [program(0, 0, 5), cc(0, 0, 7, 100), sysex(0, encodeGsDt1(partAddress(0x19, 0), [100]))]));
    if (!r.ok) throw new Error();
    let p = applyCommand(r.project, insertGsReset(r.project, r.project.tracks[0].id)).project;
    expect(listRows(p, p.tracks[0]).map((x) => x.name)).toEqual(['GS Reset', 'PC6', 'CC7', 'GS']);
    expect(() => insertGsReset(p, p.tracks[0].id)).toThrow(/すでに/);
    const lvl = listRows(p, p.tracks[0])[3];
    expect(lvl.value).toBe(100);
    p = applyCommand(p, setGsValue(p, lvl.id, 64)).project;
    const row = listRows(p, p.tracks[0])[3];
    expect(row.detail).toBe('Part Level Ch1 = 64');
    expect(() => setGsValue(p, row.id, 200)).toThrow();
    const hex = parseHexPayload('41 10 42 12 40 00 7F 00 41 F7')!;
    p = applyCommand(p, setSysExPayload(p, row.id, hex)).project;
    expect(listRows(p, p.tracks[0])[3].name).toBe('GS Reset');
    expect(parseHexPayload('zz')).toBeNull();
    expect(() => setSysExPayload(p, row.id, [0x41, 0x90, 0xf7])).toThrow();
  });

  it('RPN / NRPN data entry rows are annotated with the selected parameter', () => {
    const r = openMidiFile(build(1, 480, [cc(0, 0, 101, 0), cc(0, 0, 100, 0), cc(0, 0, 6, 12), cc(0, 0, 99, 1), cc(0, 0, 98, 32), cc(0, 0, 6, 80), cc(0, 0, 99, 26), cc(0, 0, 98, 36), cc(0, 0, 6, 100)]));
    if (!r.ok) throw new Error();
    const d = listRows(r.project, r.project.tracks[0]).filter((x) => x.name === 'CC6').map((x) => x.detail);
    expect(d).toEqual(['Data Entry MSB → RPN 0/0 Pitch Bend Sensitivity', 'Data Entry MSB → NRPN 1/32 TVF Cutoff', 'Data Entry MSB → NRPN 26/36 Drum Level (key 36)']);
  });
});

describe('Bank / Program / mixer / tempo edits (E13, REQ-PLAY-01)', () => {
  it('E13: bank + program are events in Bank -> Program order and are exported', () => {
    const p = createEmptyProject();
    const q = applyCommand(p, setBankProgram(p, p.tracks[0].id, { msb: 8, lsb: 0, program: 4 })).project;
    const smf = readSmf(exportSmfBytes(q).bytes);
    if (!smf.ok) throw new Error();
    expect(smf.smf.tracks[1].events.filter((e) => e.kind === 'channel').map((e) => e.kind === 'channel' && [e.status, ...e.data])).toEqual([
      [0xb0, 0, 8],
      [0xb0, 32, 0],
      [0xc0, 4],
    ]);
    const q2 = applyCommand(q, setBankProgram(q, q.tracks[0].id, { msb: null, lsb: null, program: 0 })).project;
    expect(q2.tracks[0].events.map((e) => e.kind)).toEqual(['program']); // replaced, not duplicated
    expect(GM_PROGRAMS).toHaveLength(128);
    expect(programLabel(0)).toBe('001 Acoustic Grand Piano');
    expect(programLabel(127)).toBe('128 Gunshot');
  });

  it('pitch bend range writes RPN 0/0 + null; mixer values edit the tick-0 controller', () => {
    const p = createEmptyProject();
    let q = applyCommand(p, setPitchBendRange(p, p.tracks[0].id, 12)).project;
    expect(q.tracks[0].events.map((e) => (e.kind === 'cc' ? `${e.controller}=${e.value}` : e.kind))).toEqual(['101=0', '100=0', '6=12', '38=0', '101=127', '100=127']);
    q = applyCommand(q, setInitialController(q, q.tracks[0].id, 7, 90)).project;
    q = applyCommand(q, setInitialController(q, q.tracks[0].id, 7, 80)).project;
    expect(q.tracks[0].events.filter((e) => e.kind === 'cc' && e.controller === 7).map((e) => e.kind === 'cc' && e.value)).toEqual([80]);
  });

  it('tempo and time signature edits keep integer µs and valid signatures', () => {
    const p = createEmptyProject();
    let q = applyCommand(p, setTempo(p, 0, 140)).project;
    expect(q.conductor.find((c) => c.kind === 'tempo')).toMatchObject({ tick: 0, usPerQuarter: 428571 });
    q = applyCommand(q, setTempo(q, 1920, 90)).project;
    q = applyCommand(q, setTimeSignature(q, 1920, 6, 8)).project;
    expect(q.conductor.map((c) => [c.kind, c.tick])).toEqual([['tempo', 0], ['time-signature', 0], ['tempo', 1920], ['time-signature', 1920]]);
    expect(() => setTimeSignature(q, 0, 3, 3)).toThrow();
    expect(() => setTempo(q, 0, 0)).toThrow();
    const ts = q.conductor.find((c) => c.kind === 'time-signature' && c.tick === 1920)!;
    q = applyCommand(q, deleteConductorEvent(q, ts.id)).project;
    expect(q.conductor).toHaveLength(3);
  });
});

import { controllerAt, setControllerAt } from '../../src/core/editing/channelSetup';

describe('mixer follows the playhead', () => {
  const song = () => {
    const r = openMidiFile(build(1, 480, [cc(489, 0, 7, 83), cc(0, 0, 11, 127), on(0, 0, 60), off(1920, 0, 60), cc(0, 0, 11, 64), cc(480, 0, 11, 0)]));
    if (!r.ok) throw new Error();
    return r.project;
  };
  it('shows the value in effect at the playhead, else the first value; counts automation', () => {
    const t = song().tracks[0];
    expect(controllerAt(t, 7, 0)).toMatchObject({ inEffect: false, count: 1 });
    expect(controllerAt(t, 7, 0).event?.value).toBe(83);
    expect(controllerAt(t, 11, 2500).event?.value).toBe(64);
    expect(controllerAt(t, 11, 5000)).toMatchObject({ inEffect: true, count: 3 });
    expect(controllerAt(t, 11, 5000).event?.value).toBe(0);
    expect(controllerAt(t, 10, 0)).toEqual({ event: null, inEffect: false, count: 0 });
  });
  it('edits the shown event, or inserts at tick 0 when the controller is absent', () => {
    let p = song();
    const id = p.tracks[0].id;
    p = applyCommand(p, setControllerAt(p, id, 11, 90, 2500)!).project;
    expect(p.tracks[0].events.filter((e) => e.kind === 'cc' && e.controller === 11).map((e) => (e.kind === 'cc' ? e.value : 0))).toEqual([127, 90, 0]);
    p = applyCommand(p, setControllerAt(p, id, 7, 100, 0)!).project; // first value (tick 489) is edited, not a new one at 0
    expect(p.tracks[0].events.filter((e) => e.kind === 'cc' && e.controller === 7).map((e) => (e.kind === 'cc' ? [e.tick, e.value] : 0))).toEqual([[489, 100]]);
    p = applyCommand(p, setControllerAt(p, id, 10, 30, 3000)!).project;
    expect(p.tracks[0].events.find((e) => e.kind === 'cc' && e.controller === 10)?.tick).toBe(0);
  });
});

import { programAt, setProgramAt } from '../../src/core/editing/channelSetup';

describe('inspector sound follows the playhead', () => {
  const song = () => {
    const r = openMidiFile(build(1, 480, [cc(0, 0, 0, 8), program(0, 0, 4), on(0, 0, 60), off(1920, 0, 60), program(0, 0, 40), on(0, 0, 62), off(480, 0, 62)]));
    if (!r.ok) throw new Error();
    return r.project;
  };
  it('shows the Program Change in effect with its bank; before the first one, the first one', () => {
    const t = song().tracks[0];
    expect(programAt(t, 0)).toMatchObject({ msb: 8, lsb: null, inEffect: true, count: 2 });
    expect(programAt(t, 0).event?.program).toBe(4);
    expect(programAt(t, 2000).event?.program).toBe(40);
    expect(programAt(t, 2000).msb).toBe(8); // bank still in effect
  });
  it('editing changes the Program Change at the playhead (bank before program), not the one at tick 0', () => {
    let p = song();
    p = applyCommand(p, setProgramAt(p, p.tracks[0].id, { msb: 0, lsb: null, program: 48 }, 2000)!).project;
    const ev = p.tracks[0].events.filter((e) => e.kind === 'program' || (e.kind === 'cc' && e.controller === 0)).map((e) => (e.kind === 'program' ? `${e.tick}:pc${e.program}` : e.kind === 'cc' ? `${e.tick}:bank${e.value}` : ''));
    expect(ev).toEqual(['0:bank8', '0:pc4', '1920:bank0', '1920:pc48']);
  });
});

describe('setup edits keep clip membership', () => {
  it('a Program Change rewritten inside a clip, and a first mixer CC inserted at tick 0, belong to that clip', () => {
    const r = openMidiFile(build(1, 480, [program(0, 0, 10), on(0, 0, 60), off(480, 0, 60), program(1440, 0, 20), on(0, 0, 62), off(480, 0, 62)]));
    if (!r.ok) throw new Error();
    let p = r.project;
    const trackId = p.tracks[0].id;
    expect(p.clips).toHaveLength(1); // the import groups the whole track
    const clipId = p.clips[0].id;
    p = applyCommand(p, setProgramAt(p, trackId, { msb: 8, lsb: null, program: 48 }, 2000)!).project; // rewrites the PC at 1920
    const inClip = (pred: (e: (typeof p.tracks)[number]['events'][number]) => boolean) => p.tracks[0].events.filter(pred).every((e) => p.clips.find((c) => c.id === clipId)!.eventIds.includes(e.id));
    expect(inClip((e) => e.kind === 'program' || (e.kind === 'cc' && e.controller === 0))).toBe(true);
    p = applyCommand(p, setInitialController(p, trackId, 7, 100)).project;
    expect(inClip((e) => e.kind === 'cc' && e.controller === 7)).toBe(true);
    // an event outside every clip stays free: a second clip region does not swallow it
    const q = applyCommand(p, createClip(p, trackId, 4800, 5280).command).project;
    expect(q.clips[1].eventIds).toEqual([]);
  });
});

