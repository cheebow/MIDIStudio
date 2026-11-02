import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { applyCommand } from '../../src/core/editing/history';
import { upsertConductorEvent } from '../../src/core/editing/conductorOps';
import { TimeSignatureMap } from '../../src/core/timing/timeSignatureMap';
import type { MidiProject } from '../../src/core/model/types';

beforeEach(() => setIdGenerator(createCounterIdGenerator()));
const run = (p: MidiProject, c: ReturnType<typeof upsertConductorEvent>) => applyCommand(p, c).project;
const kinds = (p: MidiProject) => p.conductor.map((c) => `${c.tick}:${c.kind}`);

describe('tempo track editing (upsertConductorEvent)', () => {
  it('adds a tempo change, then changes its value and position in one step each', () => {
    let p = createEmptyProject();
    p = run(p, upsertConductorEvent(p, 3840, { kind: 'tempo', bpm: 140 }));
    const added = p.conductor.find((c) => c.kind === 'tempo' && c.tick === 3840)!;
    expect(added.kind === 'tempo' && added.usPerQuarter).toBe(428571);
    p = run(p, upsertConductorEvent(p, 1920, { kind: 'tempo', bpm: 90 }, added.id));
    const moved = p.conductor.find((c) => c.id === added.id)!;
    expect(moved.tick).toBe(1920);
    expect(moved.kind === 'tempo' && moved.usPerQuarter).toBe(666667);
    expect(p.conductor.filter((c) => c.kind === 'tempo')).toHaveLength(2);
  });

  it('a tempo moved onto another tempo replaces it (one per tick); markers may share a tick', () => {
    let p = createEmptyProject();
    p = run(p, upsertConductorEvent(p, 0, { kind: 'tempo', bpm: 100 }));
    expect(p.conductor.filter((c) => c.kind === 'tempo')).toHaveLength(1);
    p = run(p, upsertConductorEvent(p, 0, { kind: 'marker', text: 'A' }));
    p = run(p, upsertConductorEvent(p, 0, { kind: 'marker', text: 'B' }));
    expect(p.conductor.filter((c) => c.kind === 'marker').map((c) => c.kind === 'marker' && c.text)).toEqual(['A', 'B']);
  });

  it('time signatures snap to the start of their bar; key signatures and markers are kept as given', () => {
    let p = createEmptyProject();
    p = run(p, upsertConductorEvent(p, 1920 * 4 + 700, { kind: 'time-signature', numerator: 3, denominator: 4 }));
    expect(kinds(p)).toContain('7680:time-signature');
    p = run(p, upsertConductorEvent(p, 7680, { kind: 'key-signature', sharpsFlats: -2, minor: false }));
    const k = p.conductor.find((c) => c.kind === 'key-signature')!;
    expect(k.kind === 'key-signature' && [k.sharpsFlats, k.minor]).toEqual([-2, false]);
    const m = run(p, upsertConductorEvent(p, 100, { kind: 'marker', text: 'Intro' }));
    expect(m.conductor.find((c) => c.kind === 'marker')!.tick).toBe(100);
  });

  it('rejects invalid values and kind changes', () => {
    const p = createEmptyProject();
    expect(() => upsertConductorEvent(p, 0, { kind: 'tempo', bpm: 0 })).toThrow();
    expect(() => upsertConductorEvent(p, 0, { kind: 'time-signature', numerator: 3, denominator: 3 })).toThrow();
    expect(() => upsertConductorEvent(p, 0, { kind: 'key-signature', sharpsFlats: 8, minor: false })).toThrow();
    const tempo = p.conductor.find((c) => c.kind === 'tempo')!;
    expect(() => upsertConductorEvent(p, 0, { kind: 'marker', text: 'x' }, tempo.id)).toThrow();
  });

  it('parses positions typed as bar.beat.tick', () => {
    const sig = new TimeSignatureMap(480, [{ tick: 1920, numerator: 3, denominator: 4 }]);
    expect(sig.parse('1')).toBe(0);
    expect(sig.parse('2.3')).toBe(1920 + 960);
    expect(sig.parse('002.01.240')).toBe(2160);
    expect(sig.parse('3:1:0')).toBe(1920 + 1440);
    expect(sig.parse('2.4')).toBeNull(); // 3/4 has no beat 4
    expect(sig.parse('x')).toBeNull();
    expect(sig.parse(sig.format(5000))).toBe(5000);
  });
});
