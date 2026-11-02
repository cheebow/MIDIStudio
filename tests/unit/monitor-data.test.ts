import { describe, expect, it } from 'vitest';
import { buildMonitorData, notesAt, notesIn, valueAt } from '../../src/core/visual/monitorData';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { bend, build, cc, off, on, program } from '../fixtures/songs';

describe('visual-mode monitor data', () => {
  const r = openMidiFile(build(1, 480, [program(0, 0, 4), cc(0, 0, 7, 90), on(0, 0, 60), on(0, 0, 64), off(960, 0, 60), cc(0, 0, 11, 50), bend(0, 0, 4096), off(480, 0, 64), program(0, 0, 40), on(0, 0, 72), off(240, 0, 72)], [cc(0, 1, 10, 20)]));
  if (!r.ok) throw new Error();
  const d = buildMonitorData(r.project);

  it('keeps only tracks with notes and the overall pitch range', () => {
    expect(d.tracks).toHaveLength(1);
    expect([d.minPitch, d.maxPitch]).toEqual([60, 72]);
  });

  it('controller values at a tick (first value before the first event, default without any)', () => {
    const t = d.tracks[0];
    expect(valueAt(t.volume, 0, 100)).toBe(90);
    expect(valueAt(t.expression, 0, 127)).toBe(50); // first value shown before it starts (like the mixer)
    expect(valueAt(t.expression, 1000, 127)).toBe(50);
    expect(valueAt(t.pan, 0, 64)).toBe(64);
    expect(valueAt(t.bend, 2000, 0)).toBe(4096);
    expect(valueAt(t.program, 100, 0)).toBe(4);
    expect(valueAt(t.program, 1440, 0)).toBe(40);
  });

  it('sounding notes and notes in a window', () => {
    const t = d.tracks[0];
    expect(notesAt(t, 0).map((n) => n.pitch).sort()).toEqual([60, 64]);
    expect(notesAt(t, 1000).map((n) => n.pitch)).toEqual([64]);
    expect(notesAt(t, 1440).map((n) => n.pitch)).toEqual([72]);
    expect(notesAt(t, 5000)).toEqual([]);
    expect(notesIn(t, 900, 1500).map((n) => n.pitch).sort()).toEqual([60, 64, 72]);
  });
});

describe('program shared on a channel', () => {
  it('a track without its own Program Change shows the program of its channel', () => {
    const r = openMidiFile(build(1, 480, [program(0, 3, 61), on(0, 3, 60), off(480, 3, 60)], [on(0, 3, 64), off(480, 3, 64)]), { mergeControllers: false });
    if (!r.ok) throw new Error();
    const d = buildMonitorData(r.project);
    expect(d.tracks.map((t) => valueAt(t.program, 0, -1))).toEqual([61, 61]);
  });
});
