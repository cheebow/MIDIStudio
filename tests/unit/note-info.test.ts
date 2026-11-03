// ADR-073: note info bar — summary of the selected notes and typed edits.
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import type { MidiProject, NoteEvent } from '../../src/core/model/types';
import { addEvents, type NewEvent } from '../../src/core/editing/operations';
import { createHistory, execute, type Command } from '../../src/core/editing/history';
import { applyFieldInput, parseFieldInput, summarizeNotes } from '../../src/core/editing/noteInfo';
import { TimeSignatureMap } from '../../src/core/timing/timeSignatureMap';

beforeEach(() => setIdGenerator(createCounterIdGenerator('e')));

const note = (tick: number, pitch: number, velocity = 100, durationTicks = 480): NewEvent => ({ kind: 'note', tick, pitch, velocity, durationTicks, releaseVelocity: 64 });
const sig = new TimeSignatureMap(480, []);
const pos = (s: string) => sig.parse(s);

function setup(events: NewEvent[]) {
  let project: MidiProject = createEmptyProject();
  let history = createHistory();
  const apply = (c: Command) => ({ project, history } = execute(project, history, c));
  const r = addEvents(project, project.tracks[0].id, events)!;
  apply(r.command);
  const notes = () => project.tracks[0].events.filter((e): e is NoteEvent => e.kind === 'note');
  return {
    ids: r.ids,
    notes,
    get project() {
      return project;
    },
    run(c: Command | null) {
      if (c) apply(c);
    },
  };
}

describe('note info bar (ADR-073)', () => {
  it('summarizes each field as a range; null without notes', () => {
    const s = setup([note(0, 60, 100), note(0, 64, 60, 240), note(480, 67, 30)]);
    expect(summarizeNotes(s.notes())).toEqual({
      tick: { min: 0, max: 480 },
      duration: { min: 240, max: 480 },
      pitch: { min: 60, max: 67 },
      velocity: { min: 30, max: 100 },
      release: { min: 64, max: 64 },
    });
    expect(summarizeNotes([])).toBeNull();
  });

  it('parses absolute and relative input per field; refuses what is out of range', () => {
    expect(parseFieldInput('96', 'velocity', pos)).toEqual({ kind: 'set', value: 96 });
    expect(parseFieldInput('+10', 'velocity', pos)).toEqual({ kind: 'add', delta: 10 });
    expect(parseFieldInput(' -5 ', 'velocity', pos)).toEqual({ kind: 'add', delta: -5 });
    expect(parseFieldInput('−3', 'pitch', pos)).toEqual({ kind: 'add', delta: -3 }); // a typed minus sign
    expect(parseFieldInput('0', 'velocity', pos)).toBeNull();
    expect(parseFieldInput('128', 'velocity', pos)).toBeNull();
    expect(parseFieldInput('0', 'release', pos)).toEqual({ kind: 'set', value: 0 });
    expect(parseFieldInput('C4', 'pitch', pos)).toEqual({ kind: 'set', value: 60 });
    expect(parseFieldInput('f#3', 'pitch', pos)).toEqual({ kind: 'set', value: 54 });
    expect(parseFieldInput('38', 'pitch', pos)).toEqual({ kind: 'set', value: 38 });
    expect(parseFieldInput('H4', 'pitch', pos)).toBeNull();
    expect(parseFieldInput('2.3.120', 'tick', pos)).toEqual({ kind: 'set', value: 1920 + 960 + 120 });
    expect(parseFieldInput('2', 'tick', pos)).toEqual({ kind: 'set', value: 1920 });
    expect(parseFieldInput('+240', 'tick', pos)).toEqual({ kind: 'add', delta: 240 });
    expect(parseFieldInput('0', 'duration', pos)).toBeNull();
    expect(parseFieldInput('abc', 'duration', pos)).toBeNull();
  });

  it('velocity / length / release: set every note, or add to each one, clamped', () => {
    const s = setup([note(0, 60, 100), note(0, 64, 60), note(0, 67, 30)]);
    s.run(applyFieldInput(s.project, s.ids, 'velocity', { kind: 'add', delta: 40 }));
    expect(s.notes().map((n) => n.velocity)).toEqual([127, 100, 70]);
    s.run(applyFieldInput(s.project, s.ids, 'velocity', { kind: 'set', value: 90 }));
    expect(s.notes().map((n) => n.velocity)).toEqual([90, 90, 90]);
    s.run(applyFieldInput(s.project, [s.ids[1]], 'velocity', { kind: 'set', value: 50 })); // one note of the chord
    expect(s.notes().map((n) => n.velocity)).toEqual([90, 50, 90]);
    s.run(applyFieldInput(s.project, s.ids, 'duration', { kind: 'add', delta: -1000 }));
    expect(s.notes().map((n) => n.durationTicks)).toEqual([1, 1, 1]);
    s.run(applyFieldInput(s.project, s.ids, 'release', { kind: 'set', value: 0 }));
    expect(s.notes().map((n) => n.releaseVelocity)).toEqual([0, 0, 0]);
    expect(applyFieldInput(s.project, s.ids, 'release', { kind: 'set', value: 0 })).toBeNull(); // nothing changes
  });

  it('position and pitch keep the shape: the earliest / lowest note goes to the value, the rest follow', () => {
    const s = setup([note(480, 60), note(480, 64), note(960, 67)]);
    s.run(applyFieldInput(s.project, s.ids, 'tick', { kind: 'set', value: 1920 }));
    expect(s.notes().map((n) => [n.tick, n.pitch])).toEqual([[1920, 60], [1920, 64], [2400, 67]]);
    s.run(applyFieldInput(s.project, s.ids, 'pitch', { kind: 'set', value: 62 }));
    expect(s.notes().map((n) => n.pitch)).toEqual([62, 66, 69]);
    s.run(applyFieldInput(s.project, s.ids, 'pitch', { kind: 'add', delta: 100 })); // clamped as a group: the top note stops at 127
    expect(s.notes().map((n) => n.pitch)).toEqual([120, 124, 127]);
    s.run(applyFieldInput(s.project, s.ids, 'tick', { kind: 'add', delta: -5000 })); // the group stops at tick 0
    expect(s.notes().map((n) => n.tick)).toEqual([0, 0, 480]);
    expect(applyFieldInput(s.project, s.ids, 'tick', { kind: 'set', value: 0 })).toBeNull();
  });
});
