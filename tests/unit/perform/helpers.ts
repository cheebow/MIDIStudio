// Shared helpers of the performance-tool tests (ADR-078): a tiny session with history, and note /
// conductor builders. Expected ticks and velocities are hard-coded in the tests themselves.
import { createEmptyProject } from '../../../src/core/model/defaults';
import type { ConductorEvent, MidiProject, NoteEvent } from '../../../src/core/model/types';
import { createHistory, execute, redo, undo, type Command, type History } from '../../../src/core/editing/history';
import { addEvents, type NewEvent } from '../../../src/core/editing/operations';

export const note = (tick: number, pitch: number, durationTicks = 480, velocity = 100): NewEvent => ({ kind: 'note', tick, pitch, velocity, durationTicks, releaseVelocity: 64 });
export const tempo = (tick: number, bpm: number): ConductorEvent => ({ id: `t${tick}`, kind: 'tempo', tick, usPerQuarter: Math.round(60e6 / bpm), originOrder: 0 });
export const sig = (tick: number, numerator: number, denominator: number): ConductorEvent => ({ id: `s${tick}`, kind: 'time-signature', tick, numerator, denominator, originOrder: 0 });

export class Session {
  history: History = createHistory();
  project: MidiProject;
  constructor(opts: { ppq?: number; conductor?: ConductorEvent[] } = {}) {
    const p = createEmptyProject({ ppq: opts.ppq ?? 480 });
    this.project = opts.conductor ? { ...p, conductor: [...p.conductor, ...opts.conductor] } : p;
  }
  run(c: Command | null | undefined, mergeKey?: string) {
    if (!c) return;
    ({ project: this.project, history: this.history } = execute(this.project, this.history, c, { mergeKey }));
  }
  undo() {
    ({ project: this.project, history: this.history } = undo(this.project, this.history));
  }
  redo() {
    ({ project: this.project, history: this.history } = redo(this.project, this.history));
  }
  /** adds notes to the first track and returns their ids */
  add(notes: NewEvent[], trackIndex = 0): string[] {
    const r = addEvents(this.project, this.project.tracks[trackIndex].id, notes)!;
    this.run(r.command);
    return r.ids;
  }
  get track() {
    return this.project.tracks[0];
  }
  notes(trackIndex = 0): NoteEvent[] {
    return this.project.tracks[trackIndex].events.filter((e): e is NoteEvent => e.kind === 'note');
  }
  /** [tick, pitch, duration, velocity] of every note, in order */
  rows(trackIndex = 0): [number, number, number, number][] {
    return this.notes(trackIndex).map((n) => [n.tick, n.pitch, n.durationTicks, n.velocity]);
  }
}
