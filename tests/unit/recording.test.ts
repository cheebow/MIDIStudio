import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { applyCommand, type Command } from '../../src/core/editing/history';
import { addEvents } from '../../src/core/editing/operations';
import { LiveTake } from '../../src/core/recording/liveTake';
import { takeToCommand } from '../../src/core/recording/applyTake';
import { stepBack, stepNotes, stepRest, stepTie, stepUndoLast, type StepSettings, type StepState } from '../../src/core/recording/stepRecorder';
import { TempoMap } from '../../src/core/timing/tempoMap';
import { parseMidiMessage } from '../../src/input/midiMessages';
import { exportSmfBytes } from '../../src/core/project-io/exportSmf';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import type { MidiProject, NoteEvent } from '../../src/core/model/types';

beforeEach(() => setIdGenerator(createCounterIdGenerator('r')));
const notes = (p: MidiProject) => p.tracks[0].events.filter((e): e is NoteEvent => e.kind === 'note').map((n) => [n.tick, n.pitch, n.durationTicks, n.velocity]);

describe('live recording', () => {
  it('I10: input times map through the tempo map (tempo change during the take)', () => {
    const tempo = new TempoMap(480, [{ tick: 0, usPerQuarter: 500000 }, { tick: 1920, usPerQuarter: 1000000 }]);
    const take = new LiveTake({ tempo });
    take.add({ type: 'note-on', pitch: 60, velocity: 90, songSeconds: 1.0 }); // tick 960
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 40, songSeconds: 2.0 }); // tick 1920
    take.add({ type: 'note-on', pitch: 62, velocity: 80, songSeconds: 3.0 }); // 2 s + 1 beat @60 = 2400
    take.add({ type: 'note-off', pitch: 62, releaseVelocity: 64, songSeconds: 3.5 }); // 2640
    const r = take.finish(4);
    expect(r.takes[0].events).toEqual([
      { kind: 'note', tick: 960, pitch: 60, velocity: 90, durationTicks: 960, releaseVelocity: 40 },
      { kind: 'note', tick: 2400, pitch: 62, velocity: 80, durationTicks: 240, releaseVelocity: 64 },
    ]);
  });

  it('I15: latency compensation shifts recorded ticks by the offset', () => {
    const tempo = new TempoMap(480, []);
    const take = new LiveTake({ tempo, latencyMs: 50 });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 0.55 });
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 1.05 });
    expect(take.finish(2).takes[0].events[0]).toMatchObject({ tick: 480, durationTicks: 480 });
  });

  it('I12: sustain CC64, pitch bend and pressure are recorded and survive SMF export', () => {
    const tempo = new TempoMap(480, []);
    const take = new LiveTake({ tempo });
    take.add({ type: 'cc', controller: 64, value: 127, songSeconds: 0 });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 0 });
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 0.25 });
    take.add({ type: 'pitch-bend', value: -4096, songSeconds: 0.3 });
    take.add({ type: 'channel-pressure', value: 50, songSeconds: 0.4 });
    take.add({ type: 'cc', controller: 64, value: 0, songSeconds: 1 });
    const p = createEmptyProject();
    const r = takeToCommand(p, p.tracks[0].id, take.finish(2), { mode: 'overdub' })!;
    const q = applyCommand(p, r.command).project;
    // the note keeps its played length; sustain stays a CC event (not baked into the note)
    expect(notes(q)).toEqual([[0, 60, 240, 100]]);
    const back = openMidiFile(exportSmfBytes(q).bytes);
    if (!back.ok) throw new Error();
    expect(back.project.tracks[0].events.map((e) => e.kind)).toEqual(['cc', 'note', 'pitch-bend', 'channel-pressure', 'cc']);
  });

  it('held notes are closed at stop; a re-triggered key without note-off closes the previous note', () => {
    const take = new LiveTake({ tempo: new TempoMap(480, []) });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 0 });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 0.5 });
    const r = take.finish(1);
    expect(r.closedAtStop).toBe(1);
    expect(r.takes[0].events.map((e) => e.kind === 'note' && [e.tick, e.durationTicks])).toEqual([
      [0, 480],
      [480, 480],
    ]);
  });

  it('I11: punch in/out keeps onsets inside the range and cuts notes at punch out', () => {
    const take = new LiveTake({ tempo: new TempoMap(480, []), punch: { inTick: 480, outTick: 1440 } });
    take.add({ type: 'note-on', pitch: 50, velocity: 100, songSeconds: 0.1 }); // before punch in: ignored
    take.add({ type: 'note-off', pitch: 50, releaseVelocity: 64, songSeconds: 0.3 });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 1.25 }); // tick 1200
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 2.0 }); // 1920 -> cut to 1440
    take.add({ type: 'cc', controller: 1, value: 3, songSeconds: 1.6 }); // tick 1536: outside
    expect(take.finish(3).takes[0].events).toEqual([{ kind: 'note', tick: 1200, pitch: 60, velocity: 100, durationTicks: 240, releaseVelocity: 64 }]);
  });

  it('I11: loop recording makes one take per pass; merge or keep the last take', () => {
    const tempo = new TempoMap(480, []);
    const take = new LiveTake({ tempo, loop: { startTick: 0, endTick: 1920 } });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 0.1 });
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 0.3 });
    take.add({ type: 'note-on', pitch: 64, velocity: 100, songSeconds: 1.9 }); // held across the loop end
    take.add({ type: 'note-on', pitch: 67, velocity: 100, songSeconds: 0.5 }); // wrapped: pass 2
    take.add({ type: 'note-off', pitch: 67, releaseVelocity: 64, songSeconds: 0.7 });
    const r = take.finish(1);
    expect(r.takes.map((t) => t.events.map((e) => e.kind === 'note' && e.pitch))).toEqual([[60, 64], [67]]);
    expect(r.takes[0].events[1]).toMatchObject({ pitch: 64, durationTicks: 1920 - 1824 });
    const p = createEmptyProject();
    const last = takeToCommand(p, p.tracks[0].id, r, { mode: 'overdub', loopChoice: 'last' })!;
    expect(notes(applyCommand(p, last.command).project).map((n) => n[1])).toEqual([67]);
    const merged = takeToCommand(p, p.tracks[0].id, r, { mode: 'overdub', loopChoice: 'merge' })!;
    expect(notes(applyCommand(p, merged.command).project).map((n) => n[1])).toEqual([60, 67, 64]);
  });

  it('ADR-084: with the pass given by the caller, a pass played later in the bar (no jump back) is its own take', () => {
    const tempo = new TempoMap(480, []);
    const take = new LiveTake({ tempo, loop: { startTick: 0, endTick: 1920 } });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 0.3, pass: 0 });
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 0.5, pass: 0 });
    // the next note comes in the third pass, later in the bar than the first: the time did not jump back
    take.add({ type: 'note-on', pitch: 64, velocity: 100, songSeconds: 1.5, pass: 2 });
    take.add({ type: 'note-off', pitch: 64, releaseVelocity: 64, songSeconds: 1.7, pass: 2 });
    const r = take.finish(1.8);
    expect(r.takes.map((t) => [t.pass, t.events.map((e) => e.kind === 'note' && e.pitch)])).toEqual([[0, [60]], [2, [64]]]);
    const p = createEmptyProject();
    const last = takeToCommand(p, p.tracks[0].id, r, { mode: 'overdub', loopChoice: 'last' })!;
    expect(notes(applyCommand(p, last.command).project).map((n) => n[1])).toEqual([64]);
  });

  it('ADR-083: a note held across the loop end and stopped before any other input runs to the loop end', () => {
    const tempo = new TempoMap(480, []);
    const take = new LiveTake({ tempo, loop: { startTick: 0, endTick: 1920 } });
    take.add({ type: 'note-on', pitch: 64, velocity: 100, songSeconds: 1.5625 }); // tick 1500
    const r = take.finish(0.3125); // stopped at tick 300 of the next pass
    expect(r.takes[0].events[0]).toMatchObject({ pitch: 64, tick: 1500, durationTicks: 420 });
  });

  it('I11: overdub keeps existing notes, replace removes notes in the recorded range; one undo step', () => {
    let p = createEmptyProject();
    p = applyCommand(p, addEvents(p, p.tracks[0].id, [
      { kind: 'note', tick: 0, pitch: 40, velocity: 100, durationTicks: 100, releaseVelocity: 64 },
      { kind: 'note', tick: 960, pitch: 41, velocity: 100, durationTicks: 100, releaseVelocity: 64 },
      { kind: 'note', tick: 3000, pitch: 42, velocity: 100, durationTicks: 100, releaseVelocity: 64 },
    ])!.command).project;
    const take = new LiveTake({ tempo: new TempoMap(480, []) });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 0.5 });
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 1.5 });
    const res = take.finish(2); // range 480..1920
    const over = applyCommand(p, takeToCommand(p, p.tracks[0].id, res, { mode: 'overdub' })!.command);
    expect(notes(over.project).map((n) => n[1])).toEqual([40, 60, 41, 42]);
    const rep = applyCommand(p, takeToCommand(p, p.tracks[0].id, res, { mode: 'replace' })!.command);
    expect(notes(rep.project).map((n) => n[1])).toEqual([40, 60, 42]);
    expect(applyCommand(rep.project, rep.inverse).project).toEqual(p);
  });

  it('ADR-082: replace keeps the program / bank / mixer set-up and controllers the take did not record', () => {
    let p = createEmptyProject();
    p = applyCommand(p, addEvents(p, p.tracks[0].id, [
      { kind: 'cc', tick: 0, controller: 0, value: 0 },
      { kind: 'program', tick: 0, program: 27 },
      { kind: 'cc', tick: 0, controller: 7, value: 90 },
      { kind: 'cc', tick: 0, controller: 64, value: 127 },
      { kind: 'pitch-bend', tick: 10, value: 100 },
      { kind: 'note', tick: 0, pitch: 40, velocity: 100, durationTicks: 100, releaseVelocity: 64 },
    ])!.command).project;
    const take = new LiveTake({ tempo: new TempoMap(480, []) });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 0 });
    take.add({ type: 'cc', controller: 64, value: 0, songSeconds: 0.1 });
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 0.5 });
    const rep = applyCommand(p, takeToCommand(p, p.tracks[0].id, take.finish(1), { mode: 'replace', replaceRange: { startTick: 0, endTick: 1920 } })!.command).project;
    const kinds = rep.tracks[0].events.map((e) => (e.kind === 'cc' ? `cc${e.controller}=${e.value}` : e.kind === 'note' ? `note${e.pitch}` : e.kind));
    expect(kinds).toEqual(['cc0=0', 'program', 'cc7=90', 'note60', 'pitch-bend', 'cc64=0']);
  });

  it('record quantize moves only the new notes', () => {
    const take = new LiveTake({ tempo: new TempoMap(480, []) });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 0.27 }); // tick 259
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 0.5 });
    const p = createEmptyProject();
    const q = applyCommand(p, takeToCommand(p, p.tracks[0].id, take.finish(1), { mode: 'overdub', quantize: { num: 120, den: 1 } })!.command).project;
    expect(notes(q)[0][0]).toBe(240);
  });
});

describe('step recording', () => {
  const s8: StepSettings = { stepTicks: 240, gate: { ratio: 0.9 }, autoAdvance: true };
  function run(p: MidiProject, r: { command: Command | null; state: StepState }) {
    return { p: r.command ? applyCommand(p, r.command).project : p, st: r.state };
  }

  it('I08: eighth notes, chord, rest and tie land on the right ticks with the right gates', () => {
    let p = createEmptyProject();
    const id = p.tracks[0].id;
    let st: StepState = { cursor: 0, lastStep: null };
    ({ p, st } = run(p, stepNotes(p, id, st, s8, [{ pitch: 60, velocity: 100 }])));
    ({ p, st } = run(p, stepNotes(p, id, st, s8, [{ pitch: 64, velocity: 90 }, { pitch: 67, velocity: 90 }]))); // chord
    st = stepRest(st, s8);
    ({ p, st } = run(p, stepNotes(p, id, st, s8, [{ pitch: 72, velocity: 100 }])));
    ({ p, st } = run(p, stepTie(p, st, s8)));
    ({ p, st } = run(p, stepTie(p, st, s8)));
    expect(notes(p)).toEqual([
      [0, 60, 216, 100],
      [240, 64, 216, 90],
      [240, 67, 216, 90],
      [720, 72, 216 + 480, 100],
    ]);
    expect(st.cursor).toBe(720 + 240 * 3); // the step line after the tied note (2 ties), not its gated end
    ({ p, st } = run(p, stepUndoLast(p, st)));
    expect(notes(p).map((n) => n[1])).toEqual([60, 64, 67]);
    expect(st.cursor).toBe(720);
    expect(stepBack(st, s8).cursor).toBe(480);
  });

  it('I09: drum steps with auto-advance off stack several pads on one tick; next step moves on', () => {
    const drum: StepSettings = { stepTicks: 120, gate: { ticks: 60 }, autoAdvance: false };
    let p = createEmptyProject();
    const id = p.tracks[0].id;
    let st: StepState = { cursor: 0, lastStep: null };
    ({ p, st } = run(p, stepNotes(p, id, st, drum, [{ pitch: 36, velocity: 110 }])));
    ({ p, st } = run(p, stepNotes(p, id, st, drum, [{ pitch: 42, velocity: 80 }])));
    st = stepRest(st, drum);
    ({ p, st } = run(p, stepNotes(p, id, st, drum, [{ pitch: 38, velocity: 100 }])));
    expect(st.cursor).toBe(120); // auto-advance off: the cursor stays on the step
    expect(notes(p)).toEqual([
      [0, 36, 60, 110],
      [0, 42, 60, 80],
      [120, 38, 60, 100],
    ]);
  });
});

describe('Web MIDI message parsing', () => {
  it('note on / off (velocity 0) / CC / bend / pressure / program; ignores system messages', () => {
    expect(parseMidiMessage([0x91, 60, 100])).toEqual({ type: 'note-on', channel: 1, pitch: 60, velocity: 100 });
    expect(parseMidiMessage([0x91, 60, 0])).toEqual({ type: 'note-off', channel: 1, pitch: 60, releaseVelocity: 0 });
    expect(parseMidiMessage([0x80, 60, 30])).toEqual({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 30 });
    expect(parseMidiMessage([0xb0, 64, 127])).toEqual({ type: 'cc', channel: 0, controller: 64, value: 127 });
    expect(parseMidiMessage([0xe0, 0, 64])).toEqual({ type: 'pitch-bend', channel: 0, value: 0 });
    expect(parseMidiMessage([0xe0, 0, 0])).toEqual({ type: 'pitch-bend', channel: 0, value: -8192 });
    expect(parseMidiMessage([0xd2, 50])).toEqual({ type: 'channel-pressure', channel: 2, value: 50 });
    expect(parseMidiMessage([0xc0, 5])).toEqual({ type: 'program', channel: 0, program: 5 });
    expect(parseMidiMessage([0xf8])).toBeNull(); // clock
    expect(parseMidiMessage([0xfe])).toBeNull(); // active sensing
    expect(parseMidiMessage([0x90, 60])).toBeNull(); // truncated
  });
});

describe('live preview while recording', () => {
  it('shows finished notes and held notes growing to the current time, without changing the take', () => {
    const take = new LiveTake({ tempo: new TempoMap(480, []) });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 0 });
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 0.25 });
    take.add({ type: 'note-on', pitch: 64, velocity: 90, songSeconds: 0.5 });
    expect(take.preview(1)).toEqual([
      { tick: 0, pitch: 60, durationTicks: 240, velocity: 100, held: false },
      { tick: 480, pitch: 64, durationTicks: 480, velocity: 90, held: true },
    ]);
    expect(take.preview(1.5)[1].durationTicks).toBe(960);
    expect(take.finish(2).takes[0].events).toHaveLength(2);
  });
});

describe('LiveTake: second review (ADR-086)', () => {
  const tempo = new TempoMap(480, [{ tick: 0, usPerQuarter: 500000 }]); // 1 tick = 1/960 s
  it('a note held across the loop end and still held at a stop later in the next pass runs to the loop end', () => {
    const take = new LiveTake({ tempo, loop: { startTick: 0, endTick: 1920 } });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 1000 / 960, pass: 0 });
    const r = take.finish(1500 / 960, 1); // stopped at tick 1500 of pass 1, no input since the wrap
    const n = r.takes.flatMap((t) => t.events).find((e) => e.kind === 'note');
    expect(n && n.kind === 'note' && n.durationTicks).toBe(920);
  });

  it('a finished note of the same key ends where the key is played again (no overlap)', () => {
    // a count-in pickup is placed with its held length; the same key is played again before that end
    const take = new LiveTake({ tempo });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 0 });
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 336 / 960 });
    take.add({ type: 'note-on', pitch: 60, velocity: 100, songSeconds: 48 / 960 });
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 500 / 960 });
    take.add({ type: 'note-on', pitch: 64, velocity: 100, songSeconds: 100 / 960 }); // other keys are untouched
    take.add({ type: 'note-off', pitch: 64, releaseVelocity: 64, songSeconds: 600 / 960 });
    const notes = take.finish(1).takes[0].events.map((e) => (e.kind === 'note' ? [e.tick, e.pitch, e.durationTicks] : null));
    expect(notes).toEqual([
      [0, 60, 48],
      [48, 60, 452],
      [100, 64, 500],
    ]);
  });
});
