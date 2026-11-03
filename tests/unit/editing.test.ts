import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import type { MidiProject, NoteEvent } from '../../src/core/model/types';
import { canRedo, createHistory, execute, historyWeight, redo, undo, type Command, type History } from '../../src/core/editing/history';
import {
  addEvents,
  addTrack,
  adoptFreeEvents,
  createClip,
  mergeClips,
  freeEventsInClip,
  deleteClip,
  deleteClips,
  moveClips,
  updateClip,
  deleteEvents,
  duplicateClip,
  duplicateEvents,
  duplicateTrack,
  EditError,
  moveClip,
  moveEvents,
  moveTrack,
  removeTrack,
  reorderTracks,
  resizeClip,
  splitClip,
  updateEvents,
  updateTrack,
  type NewEvent,
} from '../../src/core/editing/operations';
import { EMPTY_SELECTION, pruneSelection, selectEvents } from '../../src/core/editing/selection';
import { copyClips, duplicateClips, pasteClips } from '../../src/core/editing/clipboard';
import { exportSmfBytes } from '../../src/core/project-io/exportSmf';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { build, cc, meta, off, on } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('e')));

const note = (tick: number, pitch: number, durationTicks = 480): NewEvent => ({ kind: 'note', tick, pitch, velocity: 100, durationTicks, releaseVelocity: 64 });

class Session {
  history: History = createHistory();
  constructor(public project: MidiProject) {}
  run(c: Command | null, mergeKey?: string) {
    if (!c) return;
    ({ project: this.project, history: this.history } = execute(this.project, this.history, c, { mergeKey }));
  }
  undo() {
    ({ project: this.project, history: this.history } = undo(this.project, this.history));
  }
  redo() {
    ({ project: this.project, history: this.history } = redo(this.project, this.history));
  }
  get track() {
    return this.project.tracks[0];
  }
  get notes() {
    return this.track.events.filter((e): e is NoteEvent => e.kind === 'note');
  }
}

describe('history', () => {
  it('undo / redo restore exact states and redo is cleared by a new edit', () => {
    const s = new Session(createEmptyProject());
    const before = s.project;
    s.run(addEvents(s.project, s.track.id, [note(0, 60)])!.command);
    const after = s.project;
    s.undo();
    expect(s.project).toEqual(before);
    s.redo();
    expect(s.project).toEqual(after);
    s.undo();
    s.run(addEvents(s.project, s.track.id, [note(0, 62)])!.command);
    expect(canRedo(s.history)).toBe(false);
  });

  it('REQ-PRJ-07: keeps at least 100 steps', () => {
    const s = new Session(createEmptyProject());
    for (let i = 0; i < 150; i++) s.run(addEvents(s.project, s.track.id, [note(i * 10, 60)])!.command);
    for (let i = 0; i < 150; i++) s.undo();
    expect(s.notes.length).toBe(0);
    expect(s.history.limit).toBeGreaterThanOrEqual(100);
    expect(() => createHistory(50)).toThrow();
  });

  it('ADR-039: the history drops old steps beyond 100 when the retained event arrays exceed the budget', () => {
    const s = new Session(createEmptyProject());
    s.history = createHistory(500, 60_000); // budget: 60,000 retained events
    // a 300-event track: every later edit keeps a 300-event array alive (≈ 2.4 KB)
    s.run(addEvents(s.project, s.track.id, Array.from({ length: 300 }, (_, i) => note(i * 10, 60)))!.command);
    for (let i = 0; i < 200; i++) s.run(addEvents(s.project, s.track.id, [note(5000 + i * 10, 61)])!.command);
    expect(s.history.past.length).toBeGreaterThanOrEqual(100);
    expect(s.history.past.length).toBeLessThan(201); // trimmed by size, not by the 500 limit
    expect(historyWeight(s.history)).toBeLessThanOrEqual(60_000 + 600);
    const notes = s.notes.length;
    for (let i = 0; i < 100; i++) s.undo();
    expect(s.notes.length).toBe(notes - 100); // the newest 100 steps are always there
    // a song with small tracks never hits the budget: all 500 steps are kept
    const small = new Session(createEmptyProject());
    for (let i = 0; i < 500; i++) small.run(addEvents(small.project, small.track.id, [note(i * 10, 60)])!.command);
    expect(small.history.past).toHaveLength(500);
  });

  it('E10: a continuous drag (same mergeKey) is one undo step', () => {
    const s = new Session(createEmptyProject());
    const { command, ids } = addEvents(s.project, s.track.id, [note(0, 60)])!;
    s.run(command);
    for (let i = 0; i < 10; i++) s.run(moveEvents(s.project, ids, 48), 'drag-1');
    expect(s.notes[0].tick).toBe(480);
    s.undo();
    expect(s.notes[0].tick).toBe(0);
    s.redo();
    expect(s.notes[0].tick).toBe(480);
    s.undo();
    s.undo();
    expect(s.notes).toHaveLength(0);
  });
});

describe('event operations', () => {
  it('new events at the same tick are ordered Bank -> Program -> CC -> Note (E13 groundwork)', () => {
    const p = createEmptyProject();
    const r = addEvents(p, p.tracks[0].id, [note(0, 60), { kind: 'cc', tick: 0, controller: 7, value: 100 }, { kind: 'program', tick: 0, program: 48 }, { kind: 'cc', tick: 0, controller: 0, value: 1 }])!;
    const next = { ...p, ...r.command.patch };
    expect(next.tracks[0].events.map((e) => (e.kind === 'cc' ? `cc${e.controller}` : e.kind))).toEqual(['cc0', 'program', 'cc7', 'note']);
    const smf = exportSmfBytes(next).bytes;
    const reopened = openMidiFile(smf);
    if (!reopened.ok) throw new Error();
    expect(reopened.project.tracks[0].events.map((e) => (e.kind === 'cc' ? `cc${e.controller}` : e.kind))).toEqual(['cc0', 'program', 'cc7', 'note']);
  });

  it('rejects invalid values instead of clamping silently', () => {
    const p = createEmptyProject();
    expect(() => addEvents(p, p.tracks[0].id, [note(0, 128)])).toThrow(EditError);
    expect(() => addEvents(p, p.tracks[0].id, [note(-1, 60)])).toThrow(EditError);
    expect(() => addEvents(p, p.tracks[0].id, [note(0, 60, 0)])).toThrow(EditError);
    expect(() => addEvents(p, p.tracks[0].id, [{ kind: 'pitch-bend', tick: 0, value: 8192 }])).toThrow(EditError);
  });

  it('moveEvents keeps the group shape at the boundaries; transpose only pitched events', () => {
    const s = new Session(createEmptyProject());
    const { command, ids } = addEvents(s.project, s.track.id, [note(100, 120), note(200, 60), { kind: 'cc', tick: 150, controller: 1, value: 3 }])!;
    s.run(command);
    s.run(moveEvents(s.project, ids, -1000, +20));
    expect(s.track.events.map((e) => [e.tick, e.kind === 'note' ? e.pitch : null])).toEqual([
      [0, 127],
      [50, null],
      [100, 67],
    ]);
  });

  it('editing an imported note drops its Note Off order; delete removes it from clips', () => {
    const r = openMidiFile(build(0, 480, [on(0, 0, 60), off(480, 0, 60)]));
    if (!r.ok) throw new Error(r.errors[0].message);
    const s = new Session(r.project);
    expect(s.notes[0].releaseOrder).toBeDefined();
    s.run(updateEvents(s.project, [{ id: s.notes[0].id, changes: { durationTicks: 240 } }]));
    expect(s.notes[0].releaseOrder).toBeUndefined();
    s.run(deleteEvents(s.project, [s.notes[0].id]));
    expect(s.project.clips[0].eventIds).toEqual([]);
  });

  it('duplicateEvents creates independent copies with new IDs', () => {
    const s = new Session(createEmptyProject());
    const { command, ids } = addEvents(s.project, s.track.id, [note(0, 60)])!;
    s.run(command);
    const d = duplicateEvents(s.project, ids, 480)!;
    s.run(d.command);
    expect(s.notes.map((n) => n.tick)).toEqual([0, 480]);
    expect(new Set(s.notes.map((n) => n.id)).size).toBe(2);
  });
});

describe('clips (E03 / E04, REQ-PRJ-06)', () => {
  function setup() {
    const s = new Session(createEmptyProject());
    const c = createClip(s.project, s.track.id, 0, 1920);
    s.run(c.command);
    const { command } = addEvents(s.project, s.track.id, [note(0, 60, 1920), note(480, 62), { kind: 'cc', tick: 960, controller: 7, value: 90 }, note(1440, 64)])!; // join the clip (ADR-059)
    s.run(command);
    return { s, clipId: c.clipId };
  }

  it('ADR-059: events added inside a clip later (recording, drawing, step input) join that clip; the rest gets its own clip', () => {
    const { s, clipId } = setup();
    const before = s.project.clips[0].eventIds.length;
    const r = addEvents(s.project, s.track.id, [note(960, 67), { kind: 'cc', tick: 1919, controller: 1, value: 10 }, note(1920, 69), note(2400, 71)])!;
    s.run(r.command);
    const clip = s.project.clips.find((c) => c.id === clipId)!;
    expect(clip.eventIds.length).toBe(before + 2); // the note at 960 and the CC at 1919 (onset inside [0, 1920))
    expect(clip.eventIds).toEqual(expect.arrayContaining(r.ids.slice(0, 2)));
    expect(clip).toMatchObject({ startTick: 0, endTick: 1920 }); // the range is not extended
    expect(s.project.clips).toHaveLength(2);
    expect(s.project.clips[1]).toMatchObject({ startTick: 1920, endTick: 3840, eventIds: r.ids.slice(2) }); // ADR-060
    s.undo();
    expect(s.project.clips).toHaveLength(1);
    expect(s.project.clips[0].eventIds.length).toBe(before);
  });

  it('ADR-059: adoptFreeEvents takes in the free events inside the range only; nothing to adopt → null', () => {
    const { s, clipId } = setup();
    expect(adoptFreeEvents(s.project, clipId)).toBeNull();
    // an older project: two of the clip's notes were added before clips adopted events, so they are free
    const [a, b] = [s.notes[1].id, s.notes[2].id];
    s.run({ label: 'detach', patch: { clips: s.project.clips.map((c) => (c.id === clipId ? { ...c, eventIds: c.eventIds.filter((id) => id !== a && id !== b) } : c)) } });
    expect(freeEventsInClip(s.project, clipId)).toEqual([a, b]);
    s.run(adoptFreeEvents(s.project, clipId));
    expect(freeEventsInClip(s.project, clipId)).toEqual([]);
    expect(s.project.clips[0].eventIds).toEqual(expect.arrayContaining([a, b]));
    s.undo();
    expect(freeEventsInClip(s.project, clipId)).toEqual([a, b]);
  });

  it('ADR-060: notes added where no clip is get a bar-aligned clip of their own, clamped to the neighbouring clips; CC alone does not', () => {
    const s = new Session(createEmptyProject()); // 4/4, PPQ 480 → 1920 per bar
    s.run(addEvents(s.project, s.track.id, [{ kind: 'cc', tick: 100, controller: 7, value: 90 }])!.command);
    expect(s.project.clips).toHaveLength(0);
    const r1 = addEvents(s.project, s.track.id, [note(2000, 60), note(4000, 62, 480)])!; // bar 2 … into bar 3
    s.run(r1.command);
    expect(s.project.clips).toHaveLength(1);
    expect(s.project.clips[0]).toMatchObject({ startTick: 1920, endTick: 5760, eventIds: r1.ids });
    // a recording that starts in the clip and runs past its end: the inside joins, the rest gets the next clip
    const r2 = addEvents(s.project, s.track.id, [note(5000, 64), note(6000, 65), note(9000, 67)])!;
    s.run(r2.command);
    expect(s.project.clips).toHaveLength(2);
    expect(s.project.clips[0].eventIds).toEqual([...r1.ids, r2.ids[0]]);
    expect(s.project.clips[1]).toMatchObject({ startTick: 5760, endTick: 9600, eventIds: r2.ids.slice(1) }); // bar 4 … end of bar 5
    // a note in the gap before bar 2 is clamped so the new clip does not overlap the first
    const r3 = addEvents(s.project, s.track.id, [note(500, 70, 1920)])!;
    s.run(r3.command);
    expect(s.project.clips[2]).toMatchObject({ startTick: 0, endTick: 1920, eventIds: r3.ids });
    s.undo();
    expect(s.project.clips).toHaveLength(2);
  });

  it('moving a clip moves all its events (CC included) and keeps durations', () => {
    const { s, clipId } = setup();
    s.run(moveClip(s.project, clipId, 1920));
    expect(s.track.events.map((e) => e.tick)).toEqual([1920, 2400, 2880, 3360]);
    expect(s.notes[0].durationTicks).toBe(1920);
    expect(s.project.clips[0]).toMatchObject({ startTick: 1920, endTick: 3840 });
  });

  it('split assigns events by onset; a crossing note stays left with its full length; MIDI is unchanged', () => {
    const { s, clipId } = setup();
    const before = exportSmfBytes(s.project).bytes;
    s.run(splitClip(s.project, clipId, 960));
    const [a, b] = s.project.clips;
    const byId = new Map(s.track.events.map((e) => [e.id, e]));
    expect(a.eventIds.map((id) => byId.get(id)!.tick)).toEqual([0, 480]);
    expect(b.eventIds.map((id) => byId.get(id)!.tick)).toEqual([960, 1440]);
    expect(s.notes[0].durationTicks).toBe(1920); // E04: crosses the split, unchanged
    expect(exportSmfBytes(s.project).bytes).toEqual(before);
  });

  it('duplicating a clip creates a new independent event group', () => {
    const { s, clipId } = setup();
    const d = duplicateClip(s.project, clipId, 3840);
    s.run(d.command);
    expect(s.track.events).toHaveLength(8);
    const copy = s.project.clips.find((c) => c.id === d.clipId)!;
    expect(copy.startTick).toBe(3840);
    expect(copy.eventIds).toHaveLength(4);
    s.run(moveClip(s.project, d.clipId, 480));
    expect(s.track.events.filter((e) => e.tick < 3840).map((e) => e.tick)).toEqual([0, 480, 960, 1440]);
  });

  it('deleting a clip can keep or delete its events', () => {
    const { s, clipId } = setup();
    s.run(deleteClip(s.project, clipId, { deleteEvents: false }));
    expect(s.track.events).toHaveLength(4);
    s.undo();
    s.run(deleteClip(s.project, clipId));
    expect(s.track.events).toHaveLength(0);
  });

  it('ADR-040: resizing a clip regroups events by onset without moving or cutting them; MIDI is unchanged', () => {
    const { s, clipId } = setup();
    const before = exportSmfBytes(s.project).bytes;
    const tickOf = (id: string) => s.track.events.find((e) => e.id === id)!.tick;
    // shrink from the end: the note at 1440 leaves the clip but stays on the track
    s.run(resizeClip(s.project, clipId, { endTick: 1200 }));
    expect(s.project.clips[0]).toMatchObject({ startTick: 0, endTick: 1200 });
    expect(s.project.clips[0].eventIds.map(tickOf)).toEqual([0, 480, 960]);
    expect(s.track.events).toHaveLength(4);
    expect(s.notes[0].durationTicks).toBe(1920); // the note crossing the new end is not cut
    // shrink from the start
    s.run(resizeClip(s.project, clipId, { startTick: 480 }));
    expect(s.project.clips[0].eventIds.map(tickOf)).toEqual([480, 960]);
    // extend again: free events inside the range join the clip
    s.run(resizeClip(s.project, clipId, { startTick: 0, endTick: 3840 }));
    expect(s.project.clips[0].eventIds.map(tickOf)).toEqual([0, 480, 960, 1440]);
    // events owned by another clip do not join
    const other = createClip(s.project, s.track.id, 3840, 4800);
    s.run(other.command);
    s.run(addEvents(s.project, s.track.id, [note(4000, 70)], { clipId: other.clipId })!.command);
    s.run(resizeClip(s.project, clipId, { endTick: 4800 }));
    expect(s.project.clips[0].eventIds.map(tickOf)).toEqual([0, 480, 960, 1440]);
    expect(exportSmfBytes(s.project).bytes).not.toEqual(before); // only because of the note added above
    for (let i = 0; i < 6; i++) s.undo();
    expect(exportSmfBytes(s.project).bytes).toEqual(before);
    expect(s.project.clips[0]).toMatchObject({ startTick: 0, endTick: 1920 });
    expect(resizeClip(s.project, clipId, { endTick: 1920 })).toBeNull();
    expect(() => resizeClip(s.project, clipId, { endTick: 0 })).toThrow(EditError);
    expect(() => resizeClip(s.project, clipId, { startTick: -1 })).toThrow(EditError);
    expect(() => resizeClip(s.project, clipId, { startTick: 1000, endTick: 1000 })).toThrow(EditError);
  });

  it('renaming / recolouring a clip touches only the clip and is undoable', () => {
    const { s, clipId } = setup();
    const before = exportSmfBytes(s.project).bytes;
    s.run(updateClip(s.project, clipId, { name: 'Verse', color: '#ff8800' }));
    expect(s.project.clips[0]).toMatchObject({ name: 'Verse', color: '#ff8800' });
    expect(exportSmfBytes(s.project).bytes).toEqual(before);
    s.undo();
    expect(s.project.clips[0].name).toBeUndefined();
    expect(updateClip(s.project, 'nope', { name: 'x' })).toBeNull();
  });
});

describe('tick limit (shared with the SMF writer)', () => {
  it('rejects events the SMF writer could not encode, and exports those at the limit', () => {
    const s = new Session(createEmptyProject());
    const limit = 0x0fffffff;
    expect(() => addEvents(s.project, s.track.id, [note(limit + 1, 60)])).toThrow(EditError);
    expect(() => addEvents(s.project, s.track.id, [note(limit - 10, 60, 11)])).toThrow(EditError); // the Note Off would be past the limit
    s.run(addEvents(s.project, s.track.id, [note(limit - 480, 60)])!.command);
    expect(() => exportSmfBytes(s.project)).not.toThrow();
  });

  it('addTrack keeps given events; duplicateClip rejects a negative position', () => {
    const s = new Session(createEmptyProject());
    const a = addTrack(s.project, { name: 'With notes', events: [{ ...note(0, 60), id: 'n1', originOrder: 1 } as MidiProject['tracks'][number]['events'][number]] });
    s.run(a.command);
    expect(s.project.tracks[1].events).toHaveLength(1);
    const c = createClip(s.project, s.project.tracks[1].id, 0, 480);
    s.run(c.command);
    expect(() => duplicateClip(s.project, c.clipId, -480)).toThrow(EditError);
  });
});

describe('tracks', () => {
  it('add / update / reorder / duplicate / remove with undo', () => {
    const s = new Session(createEmptyProject());
    const a = addTrack(s.project, { name: 'Bass', channel: 1 });
    s.run(a.command);
    s.run(updateTrack(s.project, a.trackId, { name: 'Bass 2', displayMode: 'drum', port: 'B' }));
    expect(s.project.tracks[1]).toMatchObject({ name: 'Bass 2', displayMode: 'drum', port: 'B' });
    s.run(reorderTracks(s.project, [s.project.tracks[1].id, s.project.tracks[0].id]));
    expect(s.project.tracks[0].name).toBe('Bass 2');
    s.run(addEvents(s.project, a.trackId, [note(0, 40)])!.command);
    const d = duplicateTrack(s.project, a.trackId);
    s.run(d.command);
    expect(s.project.tracks[1].events[0].id).not.toBe(s.project.tracks[0].events[0].id);
    s.run(removeTrack(s.project, a.trackId));
    expect(s.project.tracks.map((t) => t.name)).toEqual(['Bass 2 (コピー)', 'Track 1']);
    for (let i = 0; i < 6; i++) s.undo();
    expect(s.project.tracks.map((t) => t.name)).toEqual(['Track 1']);
    expect(() => updateTrack(s.project, s.project.tracks[0].id, { channel: 16 })).toThrow(EditError);
  });

  it('ADR-040: moveTrack moves one place up / down, stops at the ends, keeps clips and is undoable', () => {
    const s = new Session(createEmptyProject());
    s.run(addTrack(s.project, { name: 'B' }).command);
    s.run(addTrack(s.project, { name: 'C' }).command);
    const [a, b, c] = s.project.tracks;
    s.run(createClip(s.project, c.id, 0, 480).command);
    const names = () => s.project.tracks.map((t) => t.name);
    expect(moveTrack(s.project, a.id, -1)).toBeNull();
    expect(moveTrack(s.project, c.id, 1)).toBeNull();
    s.run(moveTrack(s.project, c.id, -1));
    expect(names()).toEqual(['Track 1', 'C', 'B']);
    s.run(moveTrack(s.project, a.id, 2));
    expect(names()).toEqual(['C', 'B', 'Track 1']);
    s.run(moveTrack(s.project, b.id, 5)); // clamped to the end
    expect(names()).toEqual(['C', 'Track 1', 'B']);
    expect(s.project.clips[0].trackId).toBe(c.id);
    s.undo();
    s.undo();
    s.undo();
    expect(names()).toEqual(['Track 1', 'B', 'C']);
    expect(() => moveTrack(s.project, 'nope', 1)).toThrow(EditError);
  });
});

describe('selection', () => {
  it('prunes IDs that disappeared after undo', () => {
    const s = new Session(createEmptyProject());
    const { command, ids } = addEvents(s.project, s.track.id, [note(0, 60), note(10, 61)])!;
    s.run(command);
    let sel = selectEvents(EMPTY_SELECTION, ids);
    sel = selectEvents(sel, [ids[0]], 'toggle');
    expect([...sel.eventIds]).toEqual([ids[1]]);
    s.undo();
    sel = pruneSelection(sel, s.project);
    expect(sel.eventIds.size).toBe(0);
    expect(pruneSelection(sel, s.project)).toBe(sel);
  });
});

import { gridLabel, gridTicks, snapTick } from '../../src/core/timing/grid';
import { quantizeNotes } from '../../src/core/editing/quantize';
import { copyEvents, pasteEvents } from '../../src/core/editing/clipboard';

describe('grid / quantize / clipboard (E08)', () => {
  it('grid lengths are exact, including triplets and dotted values', () => {
    expect(gridTicks(480, { division: 16, kind: 'straight' })).toEqual({ num: 120, den: 1 });
    expect(gridTicks(480, { division: 16, kind: 'triplet' })).toEqual({ num: 80, den: 1 });
    expect(gridTicks(480, { division: 64, kind: 'straight' })).toEqual({ num: 30, den: 1 });
    expect(gridTicks(480, { division: 8, kind: 'dotted' })).toEqual({ num: 360, den: 1 });
    expect(gridTicks(1000, { division: 16, kind: 'triplet' })).toEqual({ num: 500, den: 3 });
    expect(gridLabel({ division: 16, kind: 'triplet' })).toBe('1/16T');
  });

  it('snapping reports inexact grid lines instead of hiding the rounding', () => {
    expect(snapTick(130, { num: 120, den: 1 })).toEqual({ tick: 120, exact: true });
    expect(snapTick(179, { num: 120, den: 1 }, 'floor')).toEqual({ tick: 120, exact: true });
    expect(snapTick(170, { num: 500, den: 3 })).toEqual({ tick: 167, exact: false });
    expect(snapTick(340, { num: 500, den: 3 })).toEqual({ tick: 333, exact: false });
    expect(snapTick(500, { num: 500, den: 3 })).toEqual({ tick: 500, exact: true });
  });

  it('quantize moves onsets (keeping lengths) and refuses inexact grids unless allowed', () => {
    const s = new Session(createEmptyProject());
    const { command, ids } = addEvents(s.project, s.track.id, [note(10, 60, 100), note(250, 62, 100)])!;
    s.run(command);
    s.run(quantizeNotes(s.project, ids, { grid: { num: 120, den: 1 } }));
    expect(s.notes.map((n) => [n.tick, n.durationTicks])).toEqual([
      [0, 100],
      [240, 100],
    ]);
    expect(() => quantizeNotes(s.project, ids, { grid: { num: 500, den: 3 } })).toThrow(EditError);
    s.run(quantizeNotes(s.project, ids, { grid: { num: 120, den: 1 }, quantizeEnds: true }));
    expect(s.notes.map((n) => n.durationTicks)).toEqual([120, 120]);
  });

  it('copy / paste creates new events relative to the paste position', () => {
    const s = new Session(createEmptyProject());
    const { command, ids } = addEvents(s.project, s.track.id, [note(480, 60), { kind: 'cc', tick: 600, controller: 1, value: 64 }])!;
    s.run(command);
    const clip = copyEvents(s.project, ids)!;
    expect(clip.span).toBe(480);
    const r = pasteEvents(s.project, s.track.id, 1920, clip)!;
    s.run(r.command);
    expect(s.track.events.map((e) => e.tick)).toEqual([480, 600, 1920, 2040]);
    expect(r.ids.every((id) => !ids.includes(id))).toBe(true);
  });
});

import { channelInsertIndex, sortTracksByChannel, tracksInChannelOrder } from '../../src/core/editing/operations';

describe('track order by channel', () => {
  it('sorts by port then channel, keeping file order for equal channels; import uses it by default', () => {
    const r = openMidiFile(build(1, 480, [on(0, 9, 36), off(10, 9, 36)], [on(0, 2, 60), off(10, 2, 60)], [on(0, 0, 60), off(10, 0, 60)], [on(0, 2, 64), off(10, 2, 64)]));
    if (!r.ok) throw new Error();
    expect(r.project.tracks.map((t) => t.channel)).toEqual([0, 2, 2, 9]);
    expect(r.project.tracks.filter((t) => t.channel === 2).map((t) => t.sourceSmfTrack)).toEqual([1, 3]);
    const file = openMidiFile(build(1, 480, [on(0, 9, 36), off(10, 9, 36)], [on(0, 0, 60), off(10, 0, 60)]), { trackOrder: 'file' });
    if (!file.ok) throw new Error();
    expect(file.project.tracks.map((t) => t.channel)).toEqual([9, 0]);
    const s = new Session(file.project);
    s.run(sortTracksByChannel(s.project));
    expect(s.project.tracks.map((t) => t.channel)).toEqual([0, 9]);
    expect(sortTracksByChannel(s.project)).toBeNull();
    expect(channelInsertIndex(s.project, 'A', 3)).toBe(1);
    expect(tracksInChannelOrder([{ ...s.project.tracks[0], port: 'B' }, s.project.tracks[1]]).map((t) => t.port)).toEqual(['A', 'B']);
  });
});

describe('track order: empty tracks', () => {
  it('SysEx-only setup tracks first, channel tracks by channel, empty / meta-only tracks last', () => {
    const r = openMidiFile(
      build(
        1,
        480,
        [meta(0, 0x03, [0x45])], // conductor
        [meta(0, 0x03, [0x50])], // empty (name only)
        [on(0, 3, 60), off(10, 3, 60)],
        [[0, 0xf0, 2, 0x7e, 0xf7]], // SysEx only
        [on(0, 1, 60), off(10, 1, 60)],
      ),
    );
    if (!r.ok) throw new Error();
    expect(r.project.tracks.map((t) => (t.events.length === 0 ? 'empty' : t.events[0].kind === 'sysex' ? 'sysex' : `ch${t.channel + 1}`))).toEqual(['sysex', 'ch2', 'ch4', 'empty']);
  });
});

import { mergeDrumTracks } from '../../src/core/editing/trackMerge';
import { compareSmfSemantics } from '../../src/core/smf/semantic';
import { readSmf } from '../../src/core/smf/reader';

describe('merging drum tracks', () => {
  const src = () =>
    build(
      1,
      480,
      [meta(0, 0x03, [0x42, 0x44]), on(0, 9, 36, 110), off(120, 9, 36), on(360, 9, 36, 110), off(120, 9, 36)], // BD
      [meta(0, 0x03, [0x53, 0x44]), on(480, 9, 38, 100), off(120, 9, 38)], // SD
      [on(0, 0, 60), off(480, 0, 60)],
      [meta(0, 0x03, [0x48, 0x48]), on(0, 9, 42, 80), off(60, 9, 42), on(420, 9, 42, 80), off(60, 9, 42)], // HH
    );

  it('import merges same-channel drum tracks into one "Drums" track; MIDI content unchanged', () => {
    const r = openMidiFile(src());
    if (!r.ok) throw new Error();
    expect(r.project.tracks.map((t) => [t.name, t.channel])).toEqual([
      ['Track 3', 0],
      ['Drums', 9],
    ]);
    const drums = r.project.tracks[1];
    expect(drums.events.filter((e) => e.kind === 'note').map((e) => (e.kind === 'note' ? `${e.tick}:${e.pitch}` : ''))).toEqual(['0:36', '0:42', '480:36', '480:38', '480:42']);
    expect(r.issues.some((i) => i.code === 'I_IMPORT_DRUMS_MERGED')).toBe(true);
    const a = readSmf(src());
    const b = readSmf(exportSmfBytes(r.project).bytes);
    if (!a.ok || !b.ok) throw new Error();
    expect(compareSmfSemantics(a.smf, b.smf).differences).toEqual([]);
  });

  it('can be kept separate on import and merged later with one undo step', () => {
    const r = openMidiFile(src(), { mergeDrums: false });
    if (!r.ok) throw new Error();
    expect(r.project.tracks.filter((t) => t.channel === 9)).toHaveLength(3);
    const s = new Session(r.project);
    s.run(mergeDrumTracks(s.project)!.command);
    expect(s.project.tracks.filter((t) => t.channel === 9).map((t) => t.name)).toEqual(['Drums']);
    expect(s.project.clips.every((c) => s.project.tracks.some((t) => t.id === c.trackId))).toBe(true);
    s.undo();
    expect(s.project.tracks.filter((t) => t.channel === 9)).toHaveLength(3);
    expect(mergeDrumTracks(openMidiFile(src()).ok ? (openMidiFile(src()) as { project: MidiProject }).project : s.project)).toBeNull();
  });
});

import { mergeSameChannelTracks } from '../../src/core/editing/trackMerge';

describe('merging controller-only tracks', () => {
  const src = () =>
    build(
      1,
      480,
      [meta(0, 0x03, [0x4d]), on(0, 14, 72), off(960, 14, 72)], // MELODY
      [meta(0, 0x03, [0x4d, 0x4f, 0x44]), cc(0, 14, 1, 0), cc(480, 14, 1, 64)], // MOD (no notes)
      [meta(0, 0x03, [0x42]), [240, 0xee, 0, 72] as [number, ...number[]]], // BEND (no notes)
      [meta(0, 0x03, [0x48]), on(0, 14, 76), off(960, 14, 76)], // harmony part on the same channel
    );

  it('import joins controller-only tracks to the note track of the channel; note tracks stay separate', () => {
    const r = openMidiFile(src());
    if (!r.ok) throw new Error();
    expect(r.project.tracks.map((t) => [t.name, t.events.map((e) => e.kind).join(',')])).toEqual([
      ['M', 'note,cc,pitch-bend,cc'], // same tick: file order (MELODY track before MOD track)
      ['H', 'note'],
    ]);
    expect(r.issues.some((i) => i.code === 'I_IMPORT_CONTROLLERS_MERGED')).toBe(true);
    const a = readSmf(src());
    const b = readSmf(exportSmfBytes(r.project).bytes);
    if (!a.ok || !b.ok) throw new Error();
    expect(compareSmfSemantics(a.smf, b.smf).differences).toEqual([]);
  });

  it('the menu command merges every same-channel group, undoable', () => {
    const r = openMidiFile(src(), { mergeControllers: false });
    if (!r.ok) throw new Error();
    expect(r.project.tracks).toHaveLength(4);
    const s = new Session(r.project);
    s.run(mergeSameChannelTracks(s.project)!.command);
    expect(s.project.tracks.map((t) => t.name)).toEqual(['M']);
    s.undo();
    expect(s.project.tracks).toHaveLength(4);
  });
});

import { snapTickSwing } from '../../src/core/timing/grid';
import { quantizeOptionsFrom } from '../../src/core/editing/quantize';

describe('quantize dialog options: strength, shuffle, lengths (ADR-043)', () => {
  it('swing moves every second grid line later; 50 % is straight', () => {
    expect(snapTickSwing(130, { num: 120, den: 1 }, 50)).toEqual({ tick: 120, exact: true });
    // 1/16 at PPQ 480 with 2/3 feel: the off-beat line of the first pair is at 160 (= 1/16 triplet pair)
    expect(snapTickSwing(150, { num: 120, den: 1 }, 66.6667).tick).toBe(160);
    expect(snapTickSwing(150, { num: 120, den: 1 }, 66.6667).exact).toBe(false);
    expect(snapTickSwing(100, { num: 120, den: 1 }, 75)).toEqual({ tick: 180, exact: true });
    expect(snapTickSwing(230, { num: 120, den: 1 }, 75)).toEqual({ tick: 240, exact: true });
    expect(snapTickSwing(0, { num: 120, den: 1 }, 75)).toEqual({ tick: 0, exact: true });
  });

  it('strength moves part of the way; shuffle targets the shifted line; lengths can follow the grid', () => {
    const s = new Session(createEmptyProject());
    const { command, ids } = addEvents(s.project, s.track.id, [note(100, 60, 100), note(250, 62, 100)])!;
    s.run(command);
    s.run(quantizeNotes(s.project, ids, { grid: { num: 120, den: 1 }, strength: 0.5 }));
    expect(s.notes.map((n) => n.tick)).toEqual([110, 245]); // half-way to 120 / 240
    s.run(quantizeNotes(s.project, ids, { grid: { num: 120, den: 1 }, swing: 75 }));
    expect(s.notes.map((n) => n.tick)).toEqual([180, 240]); // 110 → shuffled off-beat at 180; 245 → 240
    expect(s.notes.map((n) => n.durationTicks)).toEqual([100, 100]); // lengths untouched
    s.run(quantizeNotes(s.project, ids, { grid: { num: 120, den: 1 }, lengthGrid: { num: 120, den: 1 } }));
    expect(s.notes.map((n) => n.durationTicks)).toEqual([120, 120]); // rounded to one grid (never 0)
    // quantizeEnds with strength: the end moves half-way too
    s.run(updateEvents(s.project, [{ id: ids[0], changes: { tick: 0, durationTicks: 100 } }], 'x'));
    s.run(quantizeNotes(s.project, [ids[0]], { grid: { num: 120, den: 1 }, quantizeEnds: true, strength: 0.5 }));
    expect(s.notes[0]).toMatchObject({ tick: 0, durationTicks: 110 });
  });

  it('maps the saved dialog settings to options (rounding allowed, length grid only for "grid")', () => {
    expect(quantizeOptionsFrom(480, { grid: { division: 8, kind: 'triplet' }, strength: 80, swing: 60, lengths: 'grid' })).toEqual({ grid: { num: 160, den: 1 }, strength: 0.8, swing: 60, quantizeEnds: false, lengthGrid: { num: 160, den: 1 }, allowRounding: true });
    expect(quantizeOptionsFrom(480, { grid: { division: 16, kind: 'straight' }, strength: 100, swing: 50, lengths: 'ends' })).toMatchObject({ quantizeEnds: true, lengthGrid: null });
    // an inexact length grid is refused like an inexact grid unless rounding is allowed
    const s = new Session(createEmptyProject());
    const { command, ids } = addEvents(s.project, s.track.id, [note(0, 60, 100)])!;
    s.run(command);
    expect(() => quantizeNotes(s.project, ids, { grid: { num: 120, den: 1 }, lengthGrid: { num: 500, den: 3 } })).toThrow(EditError);
  });
});

import { createStarterProject } from '../../src/core/model/defaults';
import { validateProject } from '../../src/core/project-io/projectFile';

describe('starter project (ADR-046)', () => {
  it('has piano, bass, guitar and drums with GM programs, drums on channel 10, and exports cleanly', () => {
    const p = createStarterProject({ title: 'x' });
    expect(p.tracks.map((t) => [t.name, t.channel, t.displayMode])).toEqual([
      ['ピアノ', 0, 'melodic'],
      ['ベース', 1, 'melodic'],
      ['ギター', 2, 'melodic'],
      ['ドラム', 9, 'drum'],
    ]);
    expect(p.tracks.map((t) => t.events.map((e) => (e.kind === 'program' ? e.program : -1)))).toEqual([[0], [33], [25], [0]]); // drums: Standard Kit
    expect(new Set(p.tracks.map((t) => t.color)).size).toBe(4);
    expect(validateProject(p)).toEqual([]);
    const r = readSmf(exportSmfBytes(p).bytes);
    if (!r.ok) throw new Error(r.errors[0].message);
    expect(r.smf.tracks.length).toBe(5); // conductor + 4
  });
});

import { humanizeNotes, seededRandom } from '../../src/core/editing/humanize';
import { editVelocities } from '../../src/core/editing/velocity';

describe('humanize and velocity edits (ADR-050)', () => {
  it('humanize moves within the ranges, never below tick 0 / velocity 1 / length 1, and is reproducible with a seed', () => {
    const r = seededRandom(7);
    expect([r(), r(), r()].every((x) => x >= 0 && x < 1)).toBe(true);
    const s = new Session(createEmptyProject());
    const { command, ids } = addEvents(s.project, s.track.id, [note(0, 60, 100), note(480, 62, 100), note(960, 64, 100)])!;
    s.run(command);
    const before = s.notes.map((n) => ({ ...n }));
    s.run(humanizeNotes(s.project, ids, { timingTicks: 20, velocity: 10, lengthPercent: 20, seed: 42 }));
    const after = s.notes;
    after.forEach((n, i) => {
      expect(Math.abs(n.tick - before[i].tick)).toBeLessThanOrEqual(20);
      expect(n.tick).toBeGreaterThanOrEqual(0);
      expect(Math.abs(n.velocity - before[i].velocity)).toBeLessThanOrEqual(10);
      expect(Math.abs(n.durationTicks - before[i].durationTicks)).toBeLessThanOrEqual(20);
    });
    expect(after.some((n, i) => n.tick !== before[i].tick || n.velocity !== before[i].velocity)).toBe(true);
    // same seed, same result
    const s2 = new Session(createEmptyProject());
    const r2 = addEvents(s2.project, s2.track.id, [note(0, 60, 100), note(480, 62, 100), note(960, 64, 100)])!;
    s2.run(r2.command);
    s2.run(humanizeNotes(s2.project, r2.ids, { timingTicks: 20, velocity: 10, lengthPercent: 20, seed: 42 }));
    expect(s2.notes.map((n) => [n.tick, n.velocity, n.durationTicks])).toEqual(after.map((n) => [n.tick, n.velocity, n.durationTicks]));
    // ranges of 0 change nothing
    expect(humanizeNotes(s.project, ids, { timingTicks: 0, velocity: 0, lengthPercent: 0, seed: 1 })).toBeNull();
    // extreme velocity range stays inside 1..127
    s.run(humanizeNotes(s.project, ids, { timingTicks: 0, velocity: 127, lengthPercent: 0, seed: 3 }));
    expect(s.notes.every((n) => n.velocity >= 1 && n.velocity <= 127)).toBe(true);
  });

  it('velocity: set / add / scale / ramp, clamped to 1..127; one undo step', () => {
    const s = new Session(createEmptyProject());
    const { command, ids } = addEvents(s.project, s.track.id, [note(0, 60), note(480, 62), note(960, 64)])!;
    s.run(command);
    s.run(editVelocities(s.project, ids, { kind: 'set', value: 50 }));
    expect(s.notes.map((n) => n.velocity)).toEqual([50, 50, 50]);
    s.run(editVelocities(s.project, ids, { kind: 'add', delta: 100 }));
    expect(s.notes.map((n) => n.velocity)).toEqual([127, 127, 127]);
    s.run(editVelocities(s.project, ids, { kind: 'scale', percent: 50 }));
    expect(s.notes.map((n) => n.velocity)).toEqual([64, 64, 64]);
    s.run(editVelocities(s.project, ids, { kind: 'ramp', from: 40, to: 100 }));
    expect(s.notes.map((n) => n.velocity)).toEqual([40, 70, 100]);
    expect(editVelocities(s.project, ids, { kind: 'ramp', from: 40, to: 100 })).toBeNull(); // nothing changes
    s.run(editVelocities(s.project, ids, { kind: 'add', delta: -200 }));
    expect(s.notes.map((n) => n.velocity)).toEqual([1, 1, 1]);
    expect(s.history.past.length).toBe(6);
  });
});

describe('clip groups (ADR-057): copy / paste / duplicate / move / delete several clips at once', () => {
  function setup() {
    const s = new Session(createEmptyProject());
    s.run(addTrack(s.project, { name: 'B', channel: 1 }).command);
    const [a, b] = s.project.tracks;
    const ca = createClip(s.project, a.id, 0, 960);
    s.run(ca.command);
    const cb = createClip(s.project, b.id, 960, 1920, 'clip B');
    s.run(cb.command);
    s.run(addEvents(s.project, a.id, [note(0, 60), note(480, 62)])!.command); // join the clips (ADR-059)
    s.run(addEvents(s.project, b.id, [note(960, 40, 960), { kind: 'cc', tick: 960, controller: 7, value: 100 }])!.command);
    s.run(updateClip(s.project, cb.clipId, { name: 'bass', color: '#123456' }));
    return { s, a, b, ids: [ca.clipId, cb.clipId] };
  }
  const ticks = (s: Session, i: number) => s.project.tracks[i].events.map((e) => e.tick);

  it('copyClips keeps each clip relative to the earliest start, with its track, name and colour; events stay flat too', () => {
    const { s, a, b, ids } = setup();
    const data = copyClips(s.project, ids)!;
    expect(data.span).toBe(1920);
    expect(data.clips!.map((c) => [c.trackId, c.trackIndex, c.startTick, c.endTick, c.name, c.color])).toEqual([
      [a.id, 0, 0, 960, undefined, undefined],
      [b.id, 1, 960, 1920, 'bass', '#123456'],
    ]);
    expect(data.clips![1].events.map((e) => e.tick)).toEqual([960, 960]);
    expect(data.events).toHaveLength(4); // a note editor can still paste the same clipboard
    expect(copyClips(s.project, [])).toBeNull();
  });

  it('pasteClips rebuilds the regions on the chosen tracks at the tick, as one undo step', () => {
    const { s, a, b, ids } = setup();
    const data = copyClips(s.project, ids)!;
    const r = pasteClips(s.project, 3840, data, (c) => c.trackId)!;
    s.run(r.command);
    expect(r.clipIds).toHaveLength(2);
    expect(s.project.clips.map((c) => [c.trackId, c.startTick, c.endTick])).toEqual([
      [a.id, 0, 960],
      [b.id, 960, 1920],
      [a.id, 3840, 4800],
      [b.id, 4800, 5760],
    ]);
    expect(ticks(s, 0)).toEqual([0, 480, 3840, 4320]);
    expect(ticks(s, 1)).toEqual([960, 960, 4800, 4800]);
    const pasted = s.project.clips[3];
    expect(pasted.name).toBe('bass');
    expect(pasted.eventIds).toHaveLength(2);
    s.undo();
    expect(s.project.clips).toHaveLength(2);
    expect(ticks(s, 0)).toEqual([0, 480]);
    // a clip whose target track is missing is skipped; none → null
    expect(pasteClips(s.project, 0, data, () => 'nope')).toBeNull();
    expect(pasteClips(s.project, 0, data, (c) => (c.trackIndex === 0 ? a.id : undefined))!.clipIds).toHaveLength(1);
    // the flat events still paste into one track
    s.run(pasteEvents(s.project, a.id, 7680, data)!.command);
    expect(ticks(s, 0)).toEqual([0, 480, 7680, 8160, 8640, 8640]);
  });

  it('duplicateClips puts the group right after itself, or at a delta and a lane offset (clamped)', () => {
    const { s, a, b, ids } = setup();
    s.run(duplicateClips(s.project, ids)!.command);
    expect(s.project.clips.slice(2).map((c) => [c.trackId, c.startTick])).toEqual([
      [a.id, 1920],
      [b.id, 2880],
    ]);
    s.undo();
    s.run(duplicateClips(s.project, ids, { deltaTick: 480, trackOffset: 1 })!.command);
    // both land on the last track (offset clamped), shifted by 480
    expect(s.project.clips.slice(2).map((c) => [c.trackId, c.startTick])).toEqual([
      [b.id, 480],
      [b.id, 1440],
    ]);
    expect(ticks(s, 1)).toEqual([480, 960, 960, 960, 1440, 1440]);
  });

  it('ADR-065: mergeClips joins the selected clips of a track into the earliest one, gap and free notes included; other tracks and lone clips stay', () => {
    const { s, a, ids } = setup(); // A: one clip 0..960 on track a; B: 960..1920 on track b
    const before = exportSmfBytes(s.project).bytes;
    // split A's clip at 480, leave a free note in a gap after it, then merge the two halves with the gap
    s.run(splitClip(s.project, ids[0], 480));
    const [a1, a2] = s.project.clips.filter((c) => c.trackId === a.id).map((c) => c.id);
    s.run(resizeClip(s.project, a2, { endTick: 720 })); // 480..720 → the note at 480 stays, nothing after
    s.run({ label: 'free note', patch: { tracks: s.project.tracks.map((tr) => (tr.id === a.id ? { ...tr, events: [...tr.events, { id: 'free', kind: 'note', tick: 800, pitch: 70, velocity: 100, durationTicks: 100, releaseVelocity: 64, originOrder: 999 }] } : tr)) } });
    s.run(mergeClips(s.project, [a1, a2, ids[1]])); // B's clip is alone on its track: untouched
    const merged = s.project.clips.find((c) => c.id === a1)!;
    expect(s.project.clips.map((c) => c.id)).toEqual([a1, ids[1]]);
    expect(merged).toMatchObject({ startTick: 0, endTick: 720 });
    expect(s.project.clips.find((c) => c.id === ids[1])).toMatchObject({ startTick: 960, endTick: 1920 });
    const tickOf = (id: string) => s.project.tracks[0].events.find((e) => e.id === id)!.tick;
    expect(merged.eventIds.map(tickOf)).toEqual([0, 480]); // the free note at 800 is outside 0..720
    s.run(resizeClip(s.project, a1, { endTick: 960 }));
    expect(s.project.clips.find((c) => c.id === a1)!.eventIds.map(tickOf)).toEqual([0, 480, 800]);
    expect(mergeClips(s.project, [a1, ids[1]])).toBeNull(); // one clip per track: nothing to merge
    expect(mergeClips(s.project, [])).toBeNull();
    s.undo();
    s.undo();
    s.undo();
    s.undo();
    s.undo();
    expect(exportSmfBytes(s.project).bytes).toEqual(before);
  });

  it('moveClips moves the group together, never before tick 0; deleteClips removes them in one step', () => {
    const { s, ids } = setup();
    s.run(moveClips(s.project, ids, -5000)); // clamped so the earliest clip stays at 0: nothing moves
    expect(s.project.clips.map((c) => c.startTick)).toEqual([0, 960]);
    s.run(moveClips(s.project, ids, 480));
    expect(s.project.clips.map((c) => c.startTick)).toEqual([480, 1440]);
    expect(ticks(s, 0)).toEqual([480, 960]);
    expect(ticks(s, 1)).toEqual([1440, 1440]);
    s.run(deleteClips(s.project, ids, { deleteEvents: true }));
    expect(s.project.clips).toHaveLength(0);
    expect(ticks(s, 0)).toEqual([]);
    expect(ticks(s, 1)).toEqual([]);
    s.undo();
    expect(s.project.clips).toHaveLength(2);
    expect(ticks(s, 1)).toEqual([1440, 1440]);
    expect(deleteClips(s.project, [])).toBeNull();
  });
});

