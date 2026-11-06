// Performance tools (ADR-077..078): the transformed song survives SMF export / import and
// .midstudio save / load, and the plain transforms handle 1,000 notes without a noticeable wait.
import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import type { MidiProject, NoteEvent } from '../../src/core/model/types';
import { createHistory, execute } from '../../src/core/editing/history';
import { addEvents, type NewEvent } from '../../src/core/editing/operations';
import { arpeggiateChords, legatoNotes, shapeVelocities, strumChords } from '../../src/core/editing/perform';
import { exportSmfBytes } from '../../src/core/project-io/exportSmf';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { parseProjectFile, serializeProject } from '../../src/core/project-io/projectFile';

const notes = (p: MidiProject): [number, number, number, number][] =>
  p.tracks
    .flatMap((t) => t.events)
    .filter((e): e is NoteEvent => e.kind === 'note')
    .map((n) => [n.tick, n.pitch, n.durationTicks, n.velocity] as [number, number, number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

function song(chords: number, ppq = 480): { project: MidiProject; ids: string[] } {
  setIdGenerator(createCounterIdGenerator('p'));
  const base = createEmptyProject({ ppq });
  const evs: NewEvent[] = [];
  const forms = [
    [60, 64, 67],
    [57, 60, 64],
    [53, 57, 60],
    [55, 59, 62],
  ];
  for (let i = 0; i < chords; i++) for (const pitch of forms[i % 4]) evs.push({ kind: 'note', tick: i * (ppq / 2), pitch, velocity: 90 + (i % 7), durationTicks: ppq / 2 - 10, releaseVelocity: 64 });
  const r = addEvents(base, base.tracks[0].id, evs)!;
  return { project: execute(base, createHistory(), r.command).project, ids: r.ids };
}

describe('performance tools: persistence', () => {
  it('strum + velocity shaper survive SMF export / import and .midstudio save / load', () => {
    let { project, ids } = song(8);
    const run = (c: ReturnType<typeof legatoNotes>) => {
      project = execute(project, createHistory(), c.command!).project;
      ids = c.ids;
    };
    run(strumChords(project, ids, { stroke: 'auto', speed: 'normal', natural: true }));
    run(shapeVelocities(project, ids, { shape: 'beat' }));
    const expected = notes(project);
    expect(expected.length).toBe(24);
    const smf = openMidiFile(exportSmfBytes(project).bytes);
    expect(smf.ok).toBe(true);
    if (smf.ok) expect(notes(smf.project)).toEqual(expected);
    const saved = parseProjectFile(serializeProject(project));
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(notes(saved.project)).toEqual(expected);
  });
});

describe('performance tools: 1,000 notes (spec 9.3)', () => {
  it('strum, legato, velocity shaper and arpeggio each finish well under a second', () => {
    const { project, ids } = song(334); // 1,002 notes
    const timings: Record<string, number> = {};
    const time = (name: string, f: () => unknown) => {
      const t0 = performance.now();
      const r = f();
      timings[name] = performance.now() - t0;
      return r;
    };
    expect((time('strum', () => strumChords(project, ids, { stroke: 'auto', speed: 'normal', natural: true })) as ReturnType<typeof strumChords>).command).not.toBeNull();
    expect((time('legato', () => legatoNotes(project, ids, { mode: 'overlap' })) as ReturnType<typeof legatoNotes>).command).not.toBeNull();
    expect((time('velocity', () => shapeVelocities(project, ids, { shape: 'crescendo' })) as ReturnType<typeof shapeVelocities>).command).not.toBeNull();
    expect((time('arpeggio', () => arpeggiateChords(project, ids, { pattern: 'updown' })) as ReturnType<typeof arpeggiateChords>).command).not.toBeNull();
    console.log('[perf] performance tools, 1,002 notes:', Object.entries(timings).map(([k, v]) => `${k} ${v.toFixed(1)} ms`).join(', '));
    for (const [name, ms] of Object.entries(timings)) expect(ms, name).toBeLessThan(1000);
  });
});
