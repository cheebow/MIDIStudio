import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import type { MidiProject } from '../../src/core/model/types';
import { setControllerAt } from '../../src/core/editing/channelSetup';
import { applyCommand } from '../../src/core/editing/history';
import { addEvents, deleteEvents, resizeClip, updateClip, updateEvents, updateTrack } from '../../src/core/editing/operations';
import { upsertConductorEvent } from '../../src/core/editing/conductorOps';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { classifyPlaybackChange } from '../../src/core/project-io/playbackDiff';
import { build, cc, off, on, program, tempo } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('x')));

function song(): MidiProject {
  const r = openMidiFile(build(1, 480, [tempo(0, 500000)], [program(0, 0, 10), cc(0, 0, 7, 90), on(0, 0, 60), off(480, 0, 60), cc(480, 0, 10, 20), on(960, 0, 62), off(480, 0, 62)], [on(0, 1, 40), off(960, 1, 40)]));
  if (!r.ok) throw new Error();
  return r.project;
}

const apply = (p: MidiProject, cmd: ReturnType<typeof updateClip>) => (cmd ? applyCommand(p, cmd).project : p);

describe('classifyPlaybackChange (ADR-039)', () => {
  it('edits that do not change the playback snapshot are "none"', () => {
    const p = song();
    expect(classifyPlaybackChange(p, p, 0).kind).toBe('none');
    expect(classifyPlaybackChange(p, apply(p, updateClip(p, p.clips[0].id, { name: 'Verse' })), 0).kind).toBe('none');
    expect(classifyPlaybackChange(p, apply(p, updateTrack(p, p.tracks[0].id, { name: 'Lead', color: '#ff0000' })), 0).kind).toBe('none');
    expect(classifyPlaybackChange(p, { ...p, settings: { ...p.settings, horizontalZoom: 99 } }, 0).kind).toBe('none');
  });

  it('a controller value changed / added / removed at or before the playhead is "live"', () => {
    const p = song();
    const t = p.tracks[0];
    const changed = apply(p, setControllerAt(p, t.id, 7, 100, 1200));
    expect(classifyPlaybackChange(p, changed, 1200)).toEqual({ kind: 'live', controllers: [{ port: 0, channel: 0, controller: 7 }], maxTick: 0 });
    const added = apply(p, addEvents(p, t.id, [{ kind: 'cc', tick: 240, controller: 91, value: 50 }])!.command);
    expect(classifyPlaybackChange(p, added, 1200)).toMatchObject({ kind: 'live', controllers: [{ port: 0, channel: 0, controller: 91 }], maxTick: 240 });
    const pan = t.events.find((e) => e.kind === 'cc' && e.controller === 10)!;
    const removed = apply(p, deleteEvents(p, [pan.id]));
    expect(classifyPlaybackChange(p, removed, 1200)).toMatchObject({ kind: 'live', maxTick: 960 }); // the pan CC is at tick 960 (delta times)
    // the same change on a second track at once: both controllers listed
    const both = apply(changed, setControllerAt(changed, p.tracks[1].id, 7, 64, 1200));
    expect(classifyPlaybackChange(p, both, 1200)).toMatchObject({ kind: 'live', controllers: [{ port: 0, channel: 0, controller: 7 }, { port: 0, channel: 1, controller: 7 }] });
  });

  it('everything else reloads: notes, programs, bank select, events after the playhead, tempo, loop, mute, track settings', () => {
    const p = song();
    const t = p.tracks[0];
    const note = t.events.find((e) => e.kind === 'note')!;
    expect(classifyPlaybackChange(p, apply(p, updateEvents(p, [{ id: note.id, changes: { pitch: 61 } }])), 1200).kind).toBe('reload');
    expect(classifyPlaybackChange(p, apply(p, addEvents(p, t.id, [{ kind: 'program', tick: 0, program: 5 }])!.command), 1200).kind).toBe('reload');
    expect(classifyPlaybackChange(p, apply(p, addEvents(p, t.id, [{ kind: 'cc', tick: 0, controller: 0, value: 1 }])!.command), 1200).kind).toBe('reload');
    const pan = t.events.find((e) => e.kind === 'cc' && e.controller === 10)!;
    expect(classifyPlaybackChange(p, apply(p, updateEvents(p, [{ id: pan.id, changes: { value: 100 } }])), 100).kind).toBe('reload'); // CC at 960, playhead 100
    expect(classifyPlaybackChange(p, apply(p, upsertConductorEvent(p, 0, { kind: 'tempo', bpm: 100 })), 1200).kind).toBe('reload');
    expect(classifyPlaybackChange(p, { ...p, loop: { enabled: true, startTick: 0, endTick: 1920 } }, 1200).kind).toBe('reload');
    expect(classifyPlaybackChange(p, apply(p, updateTrack(p, t.id, { mute: true })), 1200).kind).toBe('reload');
    expect(classifyPlaybackChange(p, apply(p, updateTrack(p, t.id, { channel: 3 })), 1200).kind).toBe('reload');
  });

  it('ADR-082: a clip-only edit that leaves notes outside every clip (or takes them back in) reloads', () => {
    const p = song();
    const clip = p.clips.find((c) => c.trackId === p.tracks[0].id)!;
    const shrunk = apply(p, resizeClip(p, clip.id, { endTick: 480 })); // the note at 960 becomes loose
    expect(classifyPlaybackChange(p, shrunk, 0)).toEqual({ kind: 'reload', reason: 'clips' });
    expect(classifyPlaybackChange(shrunk, p, 0)).toEqual({ kind: 'reload', reason: 'clips' });
    // resizing without changing which notes sound stays "none"
    const longer = apply(p, resizeClip(p, clip.id, { endTick: clip.endTick + 480 }));
    expect(classifyPlaybackChange(p, longer, 0).kind).toBe('none');
  });
});
