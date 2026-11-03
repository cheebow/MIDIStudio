// LIST-02 / LIST-03: kind conversion, insertion templates and sets, channel column (ADR-066).
import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { exportSmfBytes } from '../../src/core/project-io/exportSmf';
import { applyCommand, type Command } from '../../src/core/editing/history';
import { listRows } from '../../src/core/list/listRows';
import { applyNameInput, convertEventKind, convertEventKinds } from '../../src/core/list/listConvert';
import { gsSysExTemplate, insertListEvent, insertSet, insertSetEvents, insertTemplate, metaBytesToText, metaTemplate, setMetaEvent, setSysExEvent, textToMetaBytes } from '../../src/core/list/listInsert';
import { setRowChannel } from '../../src/core/list/listEdit';
import { parseNameInput } from '../../src/core/list/listName';
import { base64ToBytes } from '../../src/core/model/base64';
import { decodeGs, GS_PARAMS } from '../../src/core/gs/gsSysex';
import type { MidiProject } from '../../src/core/model/types';
import { build, cc, off, on, program, sysex, timeSig, GS_RESET } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('c')));

function song(ppq = 480): MidiProject {
  const q = ppq;
  const r = openMidiFile(build(1, ppq, [timeSig(0, 4, 2)], [sysex(0, GS_RESET), cc(0, 0, 0, 8), cc(0, 0, 32, 2), program(0, 0, 48), cc(0, 0, 7, 90), on(0, 0, 60), off(q, 0, 60), cc(0, 0, 11, 100), on(q, 0, 67), off(q / 2, 0, 67)]));
  if (!r.ok) throw new Error();
  return r.project;
}
const apply = (p: MidiProject, c: Command | null) => (c ? applyCommand(p, c).project : p);
const events = (p: MidiProject) => [...p.tracks[0].events].sort((a, b) => a.tick - b.tick || a.originOrder - b.originOrder);
const roundTrip = (p: MidiProject) => {
  const back = openMidiFile(exportSmfBytes(p).bytes);
  if (!back.ok) throw new Error();
  return back.project;
};

describe('kind conversion (LIST-02)', () => {
  it('note -> CC keeps id, originOrder, tick and channel, carries the velocity as value', () => {
    const p = song();
    const note = events(p).find((e) => e.kind === 'note')!;
    const withCh = apply(p, setRowChannel(p, [note.id], 3));
    const q = apply(withCh, convertEventKind(withCh, note.id, { kind: 'cc', controller: 1 }));
    const e = q.tracks[0].events.find((x) => x.id === note.id)!;
    expect(e).toMatchObject({ kind: 'cc', id: note.id, originOrder: note.originOrder, tick: 0, controller: 1, value: 100, channelOverride: 3 });
    expect(q.tracks[0].events.length).toBe(p.tracks[0].events.length);
    // undo restores the previous project exactly
    const cmd = convertEventKind(withCh, note.id, { kind: 'cc', controller: 1 })!;
    const { project: r, inverse } = applyCommand(withCh, cmd);
    expect(applyCommand(r, inverse).project).toEqual(withCh);
  });

  it('CC -> note takes the defaults of a new note (grid length, default velocity when the value is 0)', () => {
    const p = song();
    const vol = events(p).find((e) => e.kind === 'cc' && e.controller === 7)!;
    const q = apply(p, convertEventKind(p, vol.id, { kind: 'note' }));
    const n = q.tracks[0].events.find((x) => x.id === vol.id)!;
    expect(n).toMatchObject({ kind: 'note', pitch: 60, velocity: 90, durationTicks: 120, releaseVelocity: 64 });
    expect(n.kind === 'note' && n.sourceEncoding).toBeUndefined();
  });

  it('note <-> poly pressure keeps the pitch; program / pitch bend defaults; CC -> CC of the same track', () => {
    const p = song();
    const g4 = events(p).find((e) => e.kind === 'note' && e.pitch === 67)!;
    let q = apply(p, convertEventKind(p, g4.id, { kind: 'poly-pressure' }));
    expect(q.tracks[0].events.find((x) => x.id === g4.id)).toMatchObject({ kind: 'poly-pressure', pitch: 67, pressure: 100 });
    q = apply(q, convertEventKind(q, g4.id, { kind: 'note' }));
    expect(q.tracks[0].events.find((x) => x.id === g4.id)).toMatchObject({ kind: 'note', pitch: 67, velocity: 100 });
    q = apply(q, convertEventKind(q, g4.id, { kind: 'program' }));
    expect(q.tracks[0].events.find((x) => x.id === g4.id)).toMatchObject({ kind: 'program', program: 48 }); // program in effect at that tick
    q = apply(q, convertEventKind(q, g4.id, { kind: 'pitch-bend' }));
    expect(q.tracks[0].events.find((x) => x.id === g4.id)).toMatchObject({ kind: 'pitch-bend', value: 0 });
    expect(convertEventKind(q, g4.id, { kind: 'pitch-bend' })).toBeNull(); // same kind: nothing to do
  });

  it('raw events are refused; SysEx / meta need explicit bytes', () => {
    const p = song();
    const withRaw: MidiProject = { ...p, tracks: [{ ...p.tracks[0], events: [...p.tracks[0].events, { id: 'raw1', kind: 'raw', tick: 10, originOrder: 999, rawBase64: 'kDxk', reason: 'other' }] }] };
    expect(() => convertEventKind(withRaw, 'raw1', { kind: 'note' })).toThrow(/raw/);
    const note = events(p).find((e) => e.kind === 'note')!;
    const q = apply(p, convertEventKind(p, note.id, { kind: 'meta', metaType: 0x01, bytes: textToMetaBytes('hi') }));
    expect(q.tracks[0].events.find((x) => x.id === note.id)).toMatchObject({ kind: 'meta', metaType: 1, dataBase64: 'aGk=' });
    const r = apply(q, convertEventKind(q, note.id, { kind: 'sysex', status: 'F0', bytes: GS_RESET }));
    expect(r.tracks[0].events.find((x) => x.id === note.id)).toMatchObject({ kind: 'sysex', status: 'F0' });
  });

  it('converts several rows at once and skips rows already of that kind', () => {
    const p = song();
    const ids = events(p).filter((e) => e.kind === 'note' || (e.kind === 'cc' && e.controller === 11)).map((e) => e.id);
    const q = apply(p, convertEventKinds(p, ids, { kind: 'cc', controller: 11 }));
    expect(q.tracks[0].events.filter((e) => e.kind === 'cc' && e.controller === 11).length).toBe(3);
    expect(q.tracks[0].events.filter((e) => e.kind === 'note').length).toBe(0);
  });

  it('applyNameInput: same kind edits the field, other kinds convert, unchanged input is a no-op', () => {
    const p = song();
    const note = events(p).find((e) => e.kind === 'note')!;
    const vol = events(p).find((e) => e.kind === 'cc' && e.controller === 7)!;
    const pc = events(p).find((e) => e.kind === 'program')!;
    const nameOf = (s: string, k: Parameters<typeof parseNameInput>[1]) => {
      const r = parseNameInput(s, k);
      if ('error' in r) throw new Error(r.error);
      return r;
    };
    let q = apply(p, applyNameInput(p, note.id, nameOf('D4', 'note')));
    expect(q.tracks[0].events.find((x) => x.id === note.id)).toMatchObject({ kind: 'note', pitch: 62, velocity: 100 });
    expect(applyNameInput(q, note.id, nameOf('D4', 'note'))).toBeNull();
    q = apply(q, applyNameInput(q, vol.id, nameOf('10', 'cc')));
    expect(q.tracks[0].events.find((x) => x.id === vol.id)).toMatchObject({ kind: 'cc', controller: 10, value: 90 });
    q = apply(q, applyNameInput(q, pc.id, nameOf('PC1', 'program')));
    expect(q.tracks[0].events.find((x) => x.id === pc.id)).toMatchObject({ kind: 'program', program: 0 });
    q = apply(q, applyNameInput(q, note.id, nameOf('CC11', 'note')));
    expect(q.tracks[0].events.find((x) => x.id === note.id)).toMatchObject({ kind: 'cc', controller: 11, value: 100 });
    expect(listRows(q, q.tracks[0]).map((r) => r.name)).toContain('CC11');
  });
});

describe('insertion templates and sets (LIST-03)', () => {
  it('templates take the track state at the tick', () => {
    const p = song();
    const tr = p.tracks[0];
    expect(insertTemplate(p, tr, 'note', { tick: 480, pitchHint: 65 })).toEqual({ kind: 'note', tick: 480, pitch: 65, velocity: 100, durationTicks: 120, releaseVelocity: 64 });
    expect(insertTemplate(p, tr, 'cc', { tick: 480 })).toEqual({ kind: 'cc', tick: 480, controller: 11, value: 100 }); // last CC before the tick
    expect(insertTemplate(p, tr, 'program', { tick: 480 })).toEqual({ kind: 'program', tick: 480, program: 48 });
    expect(insertTemplate(p, tr, 'pitch-bend', { tick: 1 })).toEqual({ kind: 'pitch-bend', tick: 1, value: 0 });
    expect(insertTemplate(p, tr, 'poly-pressure', { tick: 1, pitchHint: null })).toEqual({ kind: 'poly-pressure', tick: 1, pitch: 60, pressure: 64 });
    const r = insertListEvent(p, tr.id, insertTemplate(p, tr, 'cc', { tick: 480 }))!;
    expect(r.command.label).toBe('CC を挿入');
    expect(r.ids.length).toBe(1);
  });

  it('sets come out in send order as one command', () => {
    const p = song();
    const tr = p.tracks[0];
    expect(insertSetEvents(tr, 'bank-program', { tick: 960 }).map((e) => (e.kind === 'cc' ? [e.controller, e.value] : e.kind === 'program' ? ['pc', e.program] : e.kind))).toEqual([[0, 8], [32, 2], ['pc', 48]]);
    expect(insertSetEvents(tr, 'rpn-bend-range', { tick: 0 }).map((e) => (e.kind === 'cc' ? [e.controller, e.value] : null))).toEqual([[101, 0], [100, 0], [6, 2], [38, 0]]);
    expect(insertSetEvents(tr, 'nrpn', { tick: 0 }).map((e) => (e.kind === 'cc' ? e.controller : null))).toEqual([99, 98, 6, 38]);
    const r = insertSet(p, tr.id, 'rpn-bend-range', { tick: 960 })!;
    const q = applyCommand(p, r.command).project;
    const added = events(q).filter((e) => r.ids.includes(e.id));
    expect(added.map((e) => (e.kind === 'cc' ? e.controller : null))).toEqual([101, 100, 6, 38]); // originOrder keeps the send order
    expect(listRows(q, q.tracks[0]).find((row) => row.event.kind === 'cc' && row.event.controller === 6 && row.tick === 960)?.detail).toMatch(/Pitch Bend Sensitivity/);
    const gs = insertSetEvents(tr, 'gs-reset', { tick: 0 })[0];
    expect(gs.kind === 'sysex' && Array.from(base64ToBytes(gs.dataBase64)!)).toEqual(GS_RESET);
  });

  it('GS SysEx templates encode a valid DT1 with the part address of the channel', () => {
    const vol = GS_PARAMS.find((x) => x.name === 'Master Volume')!;
    const ev = gsSysExTemplate(vol, 100, 0);
    const bytes = ev.kind === 'sysex' ? Array.from(base64ToBytes(ev.dataBase64)!) : [];
    expect(bytes).toEqual([0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x04, 0x64, 0x58, 0xf7]); // checksum: 128 - (0x40+0x04+0x64) % 128
    const d = decodeGs(bytes)!;
    expect(d.checksumOk && d.param?.name).toBe('Master Volume');
    const level = GS_PARAMS.find((x) => x.name === 'Part Level')!;
    const part = gsSysExTemplate(level, 80, 0, 9); // channel 10 = part 0 -> address 40 10 19
    const pd = decodeGs(part.kind === 'sysex' ? base64ToBytes(part.dataBase64)! : [])!;
    expect([pd.channel, pd.param?.name, pd.data[0], pd.checksumOk]).toEqual([9, 'Part Level', 80, true]);
    expect(() => gsSysExTemplate(vol, 128, 0)).toThrow(/0〜127/);
  });

  it('meta events: text <-> bytes, edit, reserved conductor types refused', () => {
    expect(textToMetaBytes('あ')).toEqual([0xe3, 0x81, 0x82]);
    expect(metaBytesToText([0xe3, 0x81, 0x82])).toBe('あ');
    expect(metaBytesToText([0xff])).toBeNull();
    const p = song();
    const tr = p.tracks[0];
    const r = insertListEvent(p, tr.id, metaTemplate(0x05, textToMetaBytes('la'), 480))!;
    let q = applyCommand(p, r.command).project;
    expect(listRows(q, q.tracks[0]).find((row) => row.id === r.ids[0])?.detail).toMatch(/Lyric/);
    q = apply(q, setMetaEvent(q, r.ids[0], { metaType: 0x01, bytes: textToMetaBytes('x') }));
    expect(q.tracks[0].events.find((e) => e.id === r.ids[0])).toMatchObject({ kind: 'meta', metaType: 1, dataBase64: 'eA==' });
    expect(setMetaEvent(q, r.ids[0], { metaType: 0x01, bytes: textToMetaBytes('x') })).toBeNull();
    expect(() => metaTemplate(0x51, [7, 0xa1, 0x20], 0)).toThrow(/コンダクター/);
    expect(() => metaTemplate(0x06, [0x41], 0)).toThrow(/コンダクター/);
    expect(() => setMetaEvent(q, r.ids[0], { metaType: 0x58, bytes: [] })).toThrow();
    const back = roundTrip(q);
    expect(back.tracks[0].events.some((e) => e.kind === 'meta' && e.metaType === 1 && e.dataBase64 === 'eA==')).toBe(true);
  });

  it('setSysExEvent follows the payload rules and can change the status', () => {
    const p = song();
    const gs = events(p).find((e) => e.kind === 'sysex')!;
    const q = apply(p, setSysExEvent(p, gs.id, { status: 'F7', bytes: [0x7e, 0x7f, 0x09, 0x01, 0xf7] }));
    expect(q.tracks[0].events.find((e) => e.id === gs.id)).toMatchObject({ kind: 'sysex', status: 'F7' });
    expect(() => setSysExEvent(p, gs.id, { status: 'F0', bytes: [0x41, 0x80, 0xf7] })).toThrow(/0x80/);
    expect(setSysExEvent(p, gs.id, { status: 'F0', bytes: GS_RESET })).toBeNull();
  });
});

describe('CH column (LIST-03)', () => {
  it('sets, clears and normalises the channel override; the exported SMF uses it', () => {
    const p = song();
    const note = events(p).find((e) => e.kind === 'note')!;
    let q = apply(p, setRowChannel(p, [note.id], 9));
    expect(q.tracks[0].events.find((e) => e.id === note.id)).toMatchObject({ channelOverride: 9 });
    const back = roundTrip(q);
    const moved = back.tracks.flatMap((t) => t.events.filter((e) => e.kind === 'note' && e.pitch === 60).map((e) => (e.kind === 'note' ? (e.channelOverride ?? t.channel) : -1)));
    expect(moved).toEqual([9]);
    q = apply(q, setRowChannel(q, [note.id], 0)); // equal to the track channel -> stored as none
    expect('channelOverride' in q.tracks[0].events.find((e) => e.id === note.id)!).toBe(false);
    q = apply(q, setRowChannel(q, [note.id], 5));
    q = apply(q, setRowChannel(q, [note.id], null));
    expect('channelOverride' in q.tracks[0].events.find((e) => e.id === note.id)!).toBe(false);
    expect(setRowChannel(q, [note.id], null)).toBeNull();
    const gs = events(p).find((e) => e.kind === 'sysex')!;
    expect(() => setRowChannel(p, [gs.id], 1)).toThrow(/チャンネル/);
    expect(() => setRowChannel(p, [note.id], 16)).toThrow(/1〜16/);
    // mixed selection: SysEx rows are skipped, the note changes
    const mixed = apply(p, setRowChannel(p, [gs.id, note.id], 2));
    expect(mixed.tracks[0].events.find((e) => e.id === note.id)).toMatchObject({ channelOverride: 2 });
  });
});
