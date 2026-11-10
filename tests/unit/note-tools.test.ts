// Scissors / glue (ADR-095): U-NT-01..08.
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { looseNoteIds } from '../../src/core/model/looseNotes';
import type { MidiProject, NoteEvent } from '../../src/core/model/types';
import { applyCommand, createHistory, execute, undo } from '../../src/core/editing/history';
import { addEvents, createClip, type NewEvent } from '../../src/core/editing/operations';
import { glueNotes, glueWithNext, nextNoteOfSameKey, splitNotes } from '../../src/core/editing/noteTools';

beforeEach(() => setIdGenerator(createCounterIdGenerator('n')));

const note = (tick: number, pitch: number, durationTicks: number, extra: Partial<NoteEvent> = {}): NewEvent => ({ kind: 'note', tick, pitch, velocity: 100, durationTicks, releaseVelocity: 64, ...extra });
const notesOf = (p: MidiProject, i = 0) => p.tracks[i].events.filter((e): e is NoteEvent => e.kind === 'note');
const rows = (p: MidiProject) => notesOf(p).map((n) => [n.tick, n.pitch, n.durationTicks]);

function song(events: NewEvent[], ppq = 480) {
  let p = createEmptyProject({ ppq });
  const r = addEvents(p, p.tracks[0].id, events)!;
  p = applyCommand(p, r.command).project;
  return { p, ids: r.ids };
}

describe('scissors: splitNotes', () => {
  it('U-NT-01: a note is cut in two at the tick; pitch, velocity and channel stay; the first half keeps its id', () => {
    const { p, ids } = song([note(0, 60, 480, { velocity: 90, releaseVelocity: 40, channelOverride: 3 })]);
    const r = splitNotes(p, ids, 120)!;
    const q = applyCommand(p, r.command).project;
    expect(rows(q)).toEqual([[0, 60, 120], [120, 60, 360]]);
    expect(notesOf(q).map((n) => [n.velocity, n.channelOverride])).toEqual([[90, 3], [90, 3]]);
    expect(notesOf(q)[0].id).toBe(ids[0]);
    expect(r.ids.length).toBe(2);
    expect(r.command.label).toBe('ノートを分割');
  });

  it('U-NT-02: only the notes that sound across the tick are cut; the start and the end of a note are not a cut', () => {
    const { p, ids } = song([note(0, 60, 480), note(0, 64, 240), note(480, 67, 480)]);
    expect(splitNotes(p, [ids[0]], 0)).toBeNull();
    expect(splitNotes(p, [ids[0]], 480)).toBeNull();
    expect(splitNotes(p, ids, 1.5)).toBeNull();
    const q = applyCommand(p, splitNotes(p, ids, 240)!.command).project; // E4 ends there, G4 starts later
    expect(rows(q)).toEqual([[0, 60, 240], [0, 64, 240], [240, 60, 240], [480, 67, 480]]);
  });

  it('U-NT-03: the second half is in the clip of the first; one undo step restores the note exactly', () => {
    const { p, ids } = song([note(0, 60, 960)]);
    const clip = p.clips[0];
    let h = createHistory();
    let q = p;
    ({ project: q, history: h } = execute(q, h, splitNotes(p, ids, 480)!.command));
    expect(q.clips.length).toBe(1);
    expect(q.clips[0].eventIds.length).toBe(2);
    expect(q.clips[0].endTick).toBe(clip.endTick);
    expect(looseNoteIds(q, q.tracks[0]).size).toBe(0);
    expect(h.past.length).toBe(1);
    expect(undo(q, h).project).toEqual(p);
  });

  it('U-NT-04: a cut after the end of the note\'s clip never leaves a silent note', () => {
    let p = createEmptyProject();
    const c = createClip(p, p.tracks[0].id, 0, 480);
    p = applyCommand(p, c.command).project;
    const r = addEvents(p, p.tracks[0].id, [note(240, 60, 960)], { clipId: c.clipId })!; // rings out past the clip
    p = applyCommand(p, r.command).project;
    p = { ...p, clips: p.clips.map((x) => (x.id === c.clipId ? { ...x, endTick: 480 } : x)) }; // trimmed back: the note crosses the clip end
    const q = applyCommand(p, splitNotes(p, r.ids, 720)!.command).project;
    expect(rows(q)).toEqual([[240, 60, 480], [720, 60, 480]]);
    expect(looseNoteIds(q, q.tracks[0]).size).toBe(0);
  });

  it('U-NT-05: other PPQ, several notes at once', () => {
    const { p, ids } = song([note(0, 60, 96), note(0, 64, 96), note(0, 67, 96)], 96);
    const q = applyCommand(p, splitNotes(p, ids, 32)!.command).project;
    expect(rows(q)).toEqual([[0, 60, 32], [0, 64, 32], [0, 67, 32], [32, 60, 64], [32, 64, 64], [32, 67, 64]]);
  });
});

describe('glue: glueNotes / glueWithNext', () => {
  it('U-NT-06: notes of the same key become one from the first start to the last end (gaps filled); other keys are untouched', () => {
    const { p, ids } = song([note(0, 60, 200, { velocity: 80 }), note(240, 60, 200, { velocity: 120 }), note(600, 60, 120, { releaseVelocity: 20 }), note(0, 64, 100), note(480, 67, 100)]);
    const r = glueNotes(p, ids)!;
    const q = applyCommand(p, r.command).project;
    expect(rows(q)).toEqual([[0, 60, 720], [0, 64, 100], [480, 67, 100]]);
    expect(notesOf(q)[0]).toMatchObject({ id: ids[0], velocity: 80, releaseVelocity: 20 });
    expect(r.ids).toEqual([ids[0]]);
    expect(q.clips.flatMap((c) => c.eventIds).sort()).toEqual(notesOf(q).map((n) => n.id).sort());
    expect(glueNotes(q, notesOf(q).map((n) => n.id))).toBeNull(); // nothing left to join
  });

  it('U-NT-07: overlapping notes and different channels: the longest end wins; another channel is another key', () => {
    const { p, ids } = song([note(0, 60, 960), note(240, 60, 120), note(480, 60, 240, { channelOverride: 5 })]);
    const q = applyCommand(p, glueNotes(p, ids)!.command).project;
    expect(notesOf(q).map((n) => [n.tick, n.durationTicks, n.channelOverride])).toEqual([[0, 960, undefined], [480, 240, 5]]);
  });

  it('U-NT-08: a click joins the note with the next one of the same key; split then glue gives the note back; one undo step', () => {
    const { p, ids } = song([note(0, 60, 240), note(240, 62, 240), note(480, 60, 240), note(960, 60, 240)]);
    expect(nextNoteOfSameKey(p, ids[0])!.id).toBe(ids[2]);
    expect(glueWithNext(p, ids[3])).toBeNull(); // the last one of its key
    let h = createHistory();
    let q = p;
    ({ project: q, history: h } = execute(q, h, glueWithNext(p, ids[0])!.command));
    expect(rows(q)).toEqual([[0, 60, 720], [240, 62, 240], [960, 60, 240]]);
    expect(undo(q, h).project).toEqual(p);
    const cut = splitNotes(q, [ids[0]], 240)!;
    const back = applyCommand(applyCommand(q, cut.command).project, glueNotes(applyCommand(q, cut.command).project, cut.ids)!.command).project;
    expect(rows(back)).toEqual(rows(q));
  });
});
