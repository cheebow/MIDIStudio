// ADR-064: notes outside every clip of their track are silent (playback snapshot and export leave
// them out), controller events never are, and opening a project file gives older loose notes clips.
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { applyCommand, type Command } from '../../src/core/editing/history';
import { addEvents, createClip, deleteClip, resizeClip, type NewEvent } from '../../src/core/editing/operations';
import { looseNoteCount, looseNoteIds, withoutLooseNotes } from '../../src/core/model/looseNotes';
import { buildPlaybackSnapshot } from '../../src/core/project-io/playbackSnapshot';
import { parseProjectFile, serializeProject } from '../../src/core/project-io/projectFile';
import { readSmf } from '../../src/core/smf/reader';
import type { MidiProject } from '../../src/core/model/types';

beforeEach(() => setIdGenerator(createCounterIdGenerator('l')));
const note = (tick: number, pitch: number): NewEvent => ({ kind: 'note', tick, pitch, velocity: 100, durationTicks: 480, releaseVelocity: 64 });
const run = (p: MidiProject, c: { command: Command } | Command | null) => (c ? applyCommand(p, 'command' in c ? c.command : c).project : p);
const noteOnsOf = (smf: Uint8Array) => {
  const r = readSmf(smf);
  if (!r.ok) throw new Error();
  return r.smf.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0).map((e) => (e.kind === 'channel' ? e.data[0] : -1));
};

describe('loose notes (ADR-064)', () => {
  function setup() {
    let p = createEmptyProject();
    const track = p.tracks[0];
    p = run(p, addEvents(p, track.id, [note(0, 60), note(1920, 62), { kind: 'cc', tick: 1920, controller: 7, value: 90 }])); // one 2-bar clip
    expect(p.clips).toHaveLength(1);
    p = run(p, resizeClip(p, p.clips[0].id, { endTick: 1920 })); // the note at bar 2 leaves the clip
    return { p, track: p.tracks[0] };
  }

  it('a note that left its clip is loose; the CC next to it is not', () => {
    const { p, track } = setup();
    const loose = looseNoteIds(p, track);
    expect([...loose].map((id) => track.events.find((e) => e.id === id)!.tick)).toEqual([1920]);
    expect(looseNoteCount(p)).toBe(1);
    const sounding = withoutLooseNotes(p).tracks[0].events;
    expect(sounding.map((e) => e.kind)).toEqual(['note', 'cc']);
    const empty = createEmptyProject();
    expect(withoutLooseNotes(empty)).toBe(empty); // no loose notes → same object
  });

  it('the playback snapshot and the export of the sounding project leave the loose note out', () => {
    const { p } = setup();
    expect(noteOnsOf(buildPlaybackSnapshot(p).smf)).toEqual([60]);
    // a track with no clip at all keeps nothing: every note is loose
    const q = run(p, deleteClip(p, p.clips[0].id, { deleteEvents: false }));
    expect(looseNoteCount(q)).toBe(2);
    expect(noteOnsOf(buildPlaybackSnapshot(q).smf)).toEqual([]);
  });

  it('opening a project file gives loose notes a bar-aligned clip, so older files keep sounding', () => {
    const { p } = setup();
    const r = parseProjectFile(serializeProject(p));
    if (!r.ok) throw new Error(r.errors.join());
    expect(looseNoteCount(r.project)).toBe(0);
    expect(r.project.clips.map((c) => [c.startTick, c.endTick])).toEqual([
      [0, 1920],
      [1920, 3840],
    ]);
    expect(noteOnsOf(buildPlaybackSnapshot(r.project).smf)).toEqual([60, 62]);
  });

  it('createClip over a loose note takes it in again', () => {
    const { p } = setup();
    const q = run(p, createClip(p, p.tracks[0].id, 1920, 3840));
    expect(looseNoteCount(q)).toBe(0);
  });
});
