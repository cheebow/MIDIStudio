import { beforeEach, describe, expect, it } from 'vitest';
import { Transport, TransportError } from '../../src/playback/Transport';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { buildPlaybackSnapshot } from '../../src/core/project-io/playbackSnapshot';
import { applyCommand } from '../../src/core/editing/history';
import { setControllerAt } from '../../src/core/editing/channelSetup';
import { addEvents, updateClip, updateTrack } from '../../src/core/editing/operations';
import { readSmf } from '../../src/core/smf/reader';
import type { MidiProject } from '../../src/core/model/types';
import { FakeEngine, SlowEngine } from '../fixtures/fakeEngine';
import { build, cc, off, on, program, tempo } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('x')));

function song(): MidiProject {
  // 120 BPM for 4 beats, then 60 BPM (PPQ 480)
  const r = openMidiFile(build(1, 480, [tempo(0, 500000), tempo(1920, 1000000)], [program(0, 0, 10), on(0, 0, 60), off(480, 0, 60), cc(0, 0, 7, 90), on(1440, 0, 62), off(1920, 0, 62)], [on(0, 1, 40), off(960, 1, 40)]));
  if (!r.ok) throw new Error();
  return r.project;
}

/** An edit the engine applies at once even while playing (ADR-048): the loop range changes. */
const edit = (p: MidiProject, n = 1): MidiProject => ({ ...p, loop: { enabled: true, startTick: 0, endTick: 1920 * (4 + n) } });
/** A content edit (a note added far after the song): while playing it waits for a stop / seek / loop wrap (ADR-048). */
const noteEdit = (p: MidiProject, n = 1): MidiProject => ({
  ...p,
  tracks: p.tracks.map((tr, i) => (i === 1 ? { ...tr, events: [...tr.events, { id: `added${n}`, kind: 'note', tick: 4800 + n * 10, pitch: 60, velocity: 100, durationTicks: 10, releaseVelocity: 0, originOrder: 1000 + n }] } : tr)) as MidiProject['tracks'],
});

describe('Transport', () => {
  it('P01: play / pause / stop keep state consistent and silence notes', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine);
    const states: string[] = [];
    t.subscribe((s) => states.push(s.status));
    await t.setProject(song());
    await t.play();
    expect(t.getState().status).toBe('playing');
    expect(engine.loads).toHaveLength(1);
    engine.advance(1);
    expect(t.getPosition()).toMatchObject({ tick: 960, playing: true });
    t.pause();
    expect(t.getState().status).toBe('paused');
    expect(engine.panics).toBe(1);
    expect(t.getPosition().tick).toBe(960);
    await t.play(); // resumes from the parked position without reloading
    expect(engine.loads).toHaveLength(1);
    expect(engine.seconds).toBeCloseTo(1);
    t.stop();
    expect(t.getState().status).toBe('stopped');
    expect(t.getPosition().tick).toBe(0);
    expect(states).toEqual(['stopped', 'stopped', 'playing', 'paused', 'playing', 'stopped']);
  });

  it('P04: position follows the tempo map (tempo change at tick 1920)', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine);
    await t.setProject(song());
    await t.play();
    engine.advance(2); // 4 beats at 120 BPM
    expect(t.getPosition().tick).toBeCloseTo(1920, 6);
    engine.advance(1); // one beat at 60 BPM
    expect(t.getPosition().tick).toBeCloseTo(2400, 6);
    t.seek(2880); // 2 s + 2 beats at 60 BPM
    expect(engine.seconds).toBeCloseTo(4, 9);
  });

  it('P05: loop range goes to the engine as ticks with a guaranteed event at the loop end; stop returns to the loop start', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine);
    const p = { ...song(), loop: { enabled: true, startTick: 480, endTick: 3840 } };
    await t.setProject(p);
    await t.play(480);
    expect(engine.loads[0].loop).toEqual({ startTick: 480, endTick: 3840 });
    const smf = readSmf(engine.loads[0].smf);
    if (!smf.ok) throw new Error();
    expect(smf.smf.tracks[0].events.some((e) => e.tick === 3840)).toBe(true);
    t.stop();
    expect(t.getPosition().tick).toBe(480);
    expect(engine.panics).toBeGreaterThan(0);
  });

  it('P09: mute / solo leave out notes of silent tracks but keep their controllers', () => {
    const p = song();
    const muted = { ...p, tracks: p.tracks.map((tr, i) => (i === 0 ? { ...tr, mute: true } : tr)) };
    const snap = buildPlaybackSnapshot(muted);
    expect([...snap.audible]).toEqual([p.tracks[1].id]);
    const r = readSmf(snap.smf);
    if (!r.ok) throw new Error();
    const t1 = r.smf.tracks[1].events.filter((e) => e.kind === 'channel').map((e) => e.kind === 'channel' && e.status & 0xf0);
    expect(t1).toEqual([0xc0, 0xb0]); // program and CC7 kept, notes removed
    const soloed = { ...p, tracks: p.tracks.map((tr, i) => (i === 0 ? { ...tr, solo: true } : tr)) };
    expect([...buildPlaybackSnapshot(soloed).audible]).toEqual([p.tracks[0].id]);
  });

  it('P10: playing without a sound bank reports a clear error and keeps the transport usable', async () => {
    const engine = new FakeEngine();
    engine.ready = false;
    const t = new Transport(engine);
    await t.setProject(song());
    await expect(t.play()).rejects.toBeInstanceOf(TransportError);
    expect(t.getState()).toMatchObject({ status: 'stopped', error: expect.stringContaining('SoundFont') });
    engine.ready = true;
    engine.failNextLoad = new Error('broken');
    await expect(t.play()).resolves.toBeUndefined(); // reload error is captured in state
    expect(t.getState()).toMatchObject({ status: 'stopped', error: 'broken' });
    await t.play();
    expect(t.getState()).toMatchObject({ status: 'playing', error: null });
  });

  it('P11 / ADR-048: a tempo edit while playing does not reload (no gap); the pause → play afterwards loads it at the same musical position', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine);
    const p = song();
    await t.setProject(p);
    await t.play();
    engine.advance(2.5); // tick 2160
    const before = t.getPosition().tick;
    // Edit: tempo after bar 2 changes. The engine keeps playing the old song; the position keeps advancing.
    const edited: MidiProject = { ...p, conductor: p.conductor.map((c) => (c.kind === 'tempo' && c.tick === 1920 ? { ...c, usPerQuarter: 500000 } : c)) };
    await t.setProject(edited);
    expect(engine.loads).toHaveLength(1);
    expect(t.getState()).toMatchObject({ status: 'playing', pendingEdits: true });
    expect(engine.playing).toBe(true);
    engine.advance(0.5);
    expect(t.getPosition().tick).toBeGreaterThan(before);
    const at = t.getPosition().tick;
    t.pause();
    expect(t.getState().pendingEdits).toBe(false);
    await t.play();
    expect(engine.loads).toHaveLength(2); // the edited song, from the paused musical position with the new tempo map
    expect(t.getPosition().tick).toBeCloseTo(at, 6);
    expect(engine.seconds).toBeCloseTo(2 + ((at - 1920) / 480) * 0.5, 6);
  });

  it('ADR-048: note edits while playing never reload; a stop → play loads the edited song', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine, 0);
    const p = song();
    await t.setProject(p);
    await t.play();
    engine.advance(1);
    await t.setProject(noteEdit(p, 1));
    await t.setProject(noteEdit(noteEdit(p, 1), 2));
    expect(engine.loads).toHaveLength(1);
    expect(t.getState().pendingEdits).toBe(true);
    expect(engine.playing).toBe(true);
    t.stop();
    expect(t.getState().pendingEdits).toBe(false);
    await t.play();
    expect(engine.loads).toHaveLength(2);
    const r = readSmf(engine.loads[1].smf);
    if (!r.ok) throw new Error();
    expect(r.smf.tracks[2].events.filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0)).toHaveLength(3); // 1 + 2 added
  });

  it('ADR-048: with a loop, a note edit is loaded at the wrap from the loop start; a seek loads it at once', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine, 0);
    const p: MidiProject = { ...song(), loop: { enabled: true, startTick: 0, endTick: 1920 } };
    await t.setProject(p);
    await t.play();
    engine.advance(1);
    await t.setProject(noteEdit(p, 1));
    expect(engine.loads).toHaveLength(1);
    t.poll();
    engine.seconds = 0.05; // wrapped
    t.poll();
    await new Promise((r) => setTimeout(r, 1));
    expect(engine.loads).toHaveLength(2);
    expect(engine.seeks.at(-1)).toBe(0); // from the loop start
    expect(t.getState()).toMatchObject({ status: 'playing', pendingEdits: false });
    // another edit, then a seek: loaded at the seek target
    await t.setProject(noteEdit(noteEdit(p, 1), 2));
    expect(engine.loads).toHaveLength(2);
    t.seek(480);
    await new Promise((r) => setTimeout(r, 1));
    expect(engine.loads).toHaveLength(3);
    expect(t.getPosition().tick).toBeCloseTo(480, 6);
  });

  it('ADR-048: a sub-tick backwards jitter of the engine clock is not a loop wrap (no reload from the loop start)', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine, 0);
    const p: MidiProject = { ...song(), loop: { enabled: true, startTick: 0, endTick: 1920 } };
    await t.setProject(p);
    await t.play();
    engine.advance(1); // tick 960
    await t.setProject(noteEdit(p, 1));
    t.poll();
    engine.seconds -= 0.00005; // 0.05 ticks earlier than the last poll (clock jitter)
    t.poll();
    await new Promise((r) => setTimeout(r, 1));
    expect(engine.loads).toHaveLength(1);
    expect(t.getState().pendingEdits).toBe(true);
    engine.seconds = 0.02; // a real wrap
    t.poll();
    await new Promise((r) => setTimeout(r, 1));
    expect(engine.loads).toHaveLength(2);
  });

  it('ADR-048: mute / solo and the loop range still apply at once while playing', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine, 0);
    const p = song();
    await t.setProject(p);
    await t.play();
    engine.advance(1);
    const muted = applyCommand(p, updateTrack(p, p.tracks[1].id, { mute: true })!).project;
    await t.setProject(muted);
    expect(engine.loads).toHaveLength(2);
    await t.setProject(edit(muted, 1));
    expect(engine.loads).toHaveLength(3);
    expect(t.getState().pendingEdits).toBe(false);
  });

  it('P11: several edits in quick succession while playing reload once and keep the position', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine, 5);
    const p = song();
    await t.setProject(p);
    await t.play();
    engine.advance(2.5);
    const before = t.getPosition().tick;
    void t.setProject(edit(p, 1));
    void t.setProject(edit(p, 2));
    const last = t.setProject(edit(p, 3));
    // while waiting the engine keeps playing the previous song; the position still advances
    engine.advance(0.5);
    const waiting = t.getPosition().tick;
    expect(waiting).toBeGreaterThan(before);
    await last;
    expect(engine.loads).toHaveLength(2);
    expect(t.getPosition().tick).toBeCloseTo(waiting, 6);
    expect(t.getState().status).toBe('playing');
  });

  it('P11: an edit arriving while a reload is loading resumes at the playing position, not at the start', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine, 0);
    const p = song();
    await t.setProject(p);
    await t.play();
    engine.advance(1.5); // tick 1440
    const first = t.setProject(edit(p, 1));
    await new Promise((r) => setTimeout(r, 1)); // the first reload has started (engine clock reset to 0)
    expect(t.getPosition().tick).toBeCloseTo(1440, 6);
    await Promise.all([first, t.setProject(edit(p, 2))]);
    expect(t.getPosition().tick).toBeCloseTo(1440, 6);
    expect(engine.playing).toBe(true);
  });

  it('pause / stop drop a pending live reload; the next play loads the edited song', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine, 50);
    const p = song();
    await t.setProject(p);
    await t.play();
    const pending = t.setProject(edit(p, 1));
    t.pause();
    await pending;
    expect(engine.loads).toHaveLength(1);
    await t.play();
    expect(engine.loads).toHaveLength(2);
  });

  it('ADR-039: a controller edit at the playhead is sent live (both synths) and does not reload; a loop wrap re-sends it; a seek reloads', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine, 0);
    // song(): CC7 = 90 at tick 480; the loop starts there, so the edited event is not replayed inside the loop
    const p: MidiProject = { ...song(), loop: { enabled: true, startTick: 480, endTick: 1920 } };
    await t.setProject(p);
    await t.play();
    engine.advance(1); // tick 960
    engine.sent = [];
    const volume = applyCommand(p, setControllerAt(p, p.tracks[0].id, 7, 100, 960)!).project; // CC7 at tick 480: 90 -> 100
    await t.setProject(volume);
    expect(engine.loads).toHaveLength(1); // no gap
    expect(engine.playing).toBe(true);
    expect(engine.sent).toEqual([{ message: [0xb0, 7, 100], port: 0, target: 'both' }]);
    // loop wrap: the old song chased CC7 = 90 again; the live value is re-sent, no reload (the stale event is at the loop start)
    t.poll();
    engine.seconds = 0.55; // just after the loop start (0.5 s)
    engine.sent = [];
    t.poll();
    await new Promise((r) => setTimeout(r, 1));
    expect(engine.loads).toHaveLength(1);
    expect(engine.sent).toEqual([{ message: [0xb0, 7, 100], port: 0, target: 'both' }]);
    // a seek reloads at the seek target (the engine's chase would use the old value)
    t.seek(480);
    await new Promise((r) => setTimeout(r, 1));
    expect(engine.loads).toHaveLength(2);
    expect(t.getPosition().tick).toBeCloseTo(480, 6);
    // a note edit waits for the next stop / seek / wrap (ADR-048)
    await t.setProject(applyCommand(volume, addEvents(volume, volume.tracks[0].id, [{ kind: 'note', tick: 1440, pitch: 64, velocity: 100, durationTicks: 100, releaseVelocity: 0 }])!.command).project);
    expect(engine.loads).toHaveLength(2);
    expect(t.getState().pendingEdits).toBe(true);
  });

  it('a backward seek followed by a live edit before the next poll is not taken for a loop wrap', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine, 0);
    const p: MidiProject = { ...song(), loop: { enabled: true, startTick: 0, endTick: 1920 } };
    await t.setProject(p);
    await t.play();
    engine.advance(1.5); // tick 1440
    t.poll();
    t.seek(600);
    // CC7 at tick 480 changes: live, and "stale inside the loop" (480 > loop start 0)
    const edited = applyCommand(p, setControllerAt(p, p.tracks[0].id, 7, 100, 600)!).project;
    await t.setProject(edited);
    const loads = engine.loads.length;
    t.poll();
    await new Promise((r) => setTimeout(r, 1));
    expect(engine.loads.length).toBe(loads); // no reload from the loop start: the playhead stays at 600
    expect(t.getPosition().tick).toBeCloseTo(600, 6);
  });

  it('ADR-039: a stale controller event inside the loop makes the wrap reload from the loop start', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine, 0);
    // song(): CC7 at tick 480 lies inside the loop [0, 1920): after a wrap the old song would replay its old value
    const p: MidiProject = { ...song(), loop: { enabled: true, startTick: 0, endTick: 1920 } };
    await t.setProject(p);
    await t.play();
    engine.advance(1); // tick 960
    await t.setProject(applyCommand(p, setControllerAt(p, p.tracks[0].id, 7, 70, 960)!).project); // changes the tick-480 CC7
    expect(engine.loads).toHaveLength(1);
    t.poll();
    engine.seconds = 0.05; // wrapped
    t.poll();
    await new Promise((r) => setTimeout(r, 1));
    expect(engine.loads).toHaveLength(2);
    expect(engine.seeks.at(-1)).toBe(0); // resumed from the loop start, not from 0.05 s
    expect(engine.playing).toBe(true);
  });

  it('ADR-039: an edit that leaves the playback snapshot unchanged neither reloads nor marks the song stale', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine, 0);
    const p = song();
    await t.setProject(p);
    await t.play();
    engine.advance(0.5);
    await t.setProject(applyCommand(p, updateClip(p, p.clips[0].id, { name: 'Verse' })!).project);
    expect(engine.loads).toHaveLength(1);
    t.seek(0); // no reload either: the loaded song is current
    await new Promise((r) => setTimeout(r, 1));
    expect(engine.loads).toHaveLength(1);
    expect(engine.seeks.at(-1)).toBe(0);
  });

  it('end of song: poll() moves the transport to stopped', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine);
    await t.setProject(song());
    await t.play();
    engine.finished = true;
    t.poll();
    expect(t.getState().status).toBe('stopped');
  });

  it('preview notes are tracked separately and released on panic paths', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine);
    const p = song();
    await t.setProject(p);
    t.auditionNote(p.tracks[0].id, 64, 100, 'pc');
    t.auditionNote(p.tracks[0].id, 64, 100, 'pc'); // key repeat: re-trigger, not a second voice
    expect(t.activePreviewCount).toBe(1);
    // chased program 10 is sent before the first preview note
    expect(engine.sent[0]).toEqual({ message: [0xc0, 10], port: 0 });
    t.releaseAllPreviews('pc');
    expect(t.activePreviewCount).toBe(0);
    const offs = engine.sent.filter((s) => (s.message[0] & 0xf0) === 0x80);
    expect(offs).toHaveLength(2);
  });
});

describe('Transport tail (recording past the song end)', () => {
  it('setTail adds an event far after the song so the engine keeps running, and forces a reload', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine);
    await t.setProject(song());
    await t.play();
    t.stop();
    t.setTail(480 * 4 * 100);
    await t.play();
    expect(engine.loads).toHaveLength(2);
    const r = readSmf(engine.loads[1].smf);
    if (!r.ok) throw new Error();
    expect(Math.max(...r.smf.tracks.map((tr) => tr.endOfTrackTick))).toBe(480 * 4 * 100);
    expect(engine.loads[1].minEndTick).toBe(480 * 4 * 100);
  });
});

describe('audition uses the track sound', () => {
  it('with no Program Change before the playhead, the first Bank/Program of the track is sent before the note', async () => {
    const r = openMidiFile(build(1, 480, [on(0, 6, 60), off(240, 6, 60), cc(1680, 6, 0, 8), program(0, 6, 6), on(0, 6, 62), off(240, 6, 62)]));
    if (!r.ok) throw new Error();
    const engine = new FakeEngine();
    const t = new Transport(engine);
    await t.setProject(r.project);
    t.auditionNote(r.project.tracks[0].id, 64, 100);
    expect(engine.sent.map((x) => x.message)).toEqual([[0xb6, 0, 8], [0xc6, 6], [0x96, 64, 100]]);
  });
});

describe('separate preview synth', () => {
  it('previews always carry the track state (also while playing) and go to the preview synth; mixer moves reach both', async () => {
    const engine = new FakeEngine();
    const t = new Transport(engine);
    const p = song();
    await t.setProject(p);
    await t.play();
    engine.advance(0.5);
    engine.sent = [];
    t.auditionNote(p.tracks[0].id, 64, 100, 'midi:kb');
    expect(engine.sent[0]).toEqual({ message: [0xc0, 10], port: 0 }); // program chased even while playing
    expect(engine.sent.every((x) => x.target === undefined)).toBe(true); // preview synth only
    t.sendToTrack(p.tracks[0].id, [0xb0, 7, 90]);
    expect(engine.sent.at(-1)).toEqual({ message: [0xb0, 7, 90], port: 0, target: 'both' });
  });
});

describe('pause / seek while a reload is in progress (P11)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 1));

  async function playing(): Promise<{ engine: SlowEngine; t: Transport; p: MidiProject }> {
    const engine = new SlowEngine();
    const t = new Transport(engine, 0);
    const p = song();
    await t.setProject(p);
    const started = t.play();
    await tick();
    engine.release!();
    await started;
    expect(t.getState().status).toBe('playing');
    engine.advance(1.0); // tick 960
    return { engine, t, p };
  }

  it('an edit committed during the first load (transport not yet playing) is loaded too', async () => {
    const engine = new SlowEngine();
    const t = new Transport(engine, 0);
    const p = song();
    await t.setProject(p);
    const started = t.play();
    await tick();
    expect(engine.release).not.toBeNull();
    const edited = applyCommand(p, updateTrack(p, p.tracks[1].id, { mute: true })!).project;
    void t.setProject(edited); // arrives while the load is in flight and the status is still 'stopped'
    engine.release!();
    await started;
    // the catch-up reload is queued: let it start and finish
    for (let i = 0; i < 20 && engine.loads.length < 2; i++) {
      await tick();
      engine.release?.();
    }
    expect(engine.loads).toHaveLength(2);
    expect(t.getState().status).toBe('playing');
    expect(t.getState().loading).toBe(false);
    // the engine now plays the edited song (the muted track has no Note Ons)
    const r = readSmf(engine.loads[1].smf);
    if (!r.ok) throw new Error();
    const noteOns = r.smf.tracks.flatMap((tr) => tr.events).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0);
    expect(noteOns.every((e) => e.kind === 'channel' && (e.status & 0x0f) === 0)).toBe(true);
    // a snapshot-neutral edit during a load needs no second reload
    const engine2 = new SlowEngine();
    const t2 = new Transport(engine2, 0);
    await t2.setProject(p);
    const started2 = t2.play();
    await tick();
    void t2.setProject(applyCommand(p, updateClip(p, p.clips[0].id, { name: 'Intro' })!).project);
    engine2.release!();
    await started2;
    await tick();
    await tick();
    expect(engine2.loads).toHaveLength(1);
    expect(engine2.release).toBeNull();
  });

  it('a pause during the load wins: the finished reload does not resume', async () => {
    const { engine, t, p } = await playing();
    const reload = t.setProject(edit(p, 1));
    await tick();
    expect(t.getState().loading).toBe(true);
    t.pause();
    expect(t.getState().status).toBe('paused');
    engine.release!();
    await reload;
    expect(t.getState().status).toBe('paused');
    expect(engine.playing).toBe(false);
    expect(t.getPosition().tick).toBeCloseTo(960, 6);
  });

  it('a stop during the load wins: the song is parked at the start', async () => {
    const { engine, t, p } = await playing();
    const reload = t.setProject(edit(p, 1));
    await tick();
    t.stop();
    engine.release!();
    await reload;
    expect(t.getState().status).toBe('stopped');
    expect(engine.playing).toBe(false);
    expect(t.getPosition().tick).toBe(0);
  });

  it('a seek during the load wins over the position the reload started with', async () => {
    const { engine, t, p } = await playing();
    const reload = t.setProject(edit(p, 1));
    await tick();
    expect(t.getState().loading).toBe(true);
    t.seek(0);
    engine.release!();
    await reload;
    expect(t.getState().status).toBe('playing');
    expect(t.getPosition().tick).toBeCloseTo(0, 6);
  });
});
