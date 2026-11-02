import { describe, expect, it } from 'vitest';
import { conductorMarks, formatBpm, keyName } from '../../src/ui/canvas';
import type { ConductorEvent } from '../../src/core/model/types';

const tempo = (tick: number, bpm: number, id = `t${tick}-${bpm}`): ConductorEvent => ({ id, kind: 'tempo', tick, usPerQuarter: Math.round(60e6 / bpm), originOrder: 0 });
const sig = (tick: number, numerator: number, denominator: number): ConductorEvent => ({ id: `s${tick}`, kind: 'time-signature', tick, numerator, denominator, originOrder: 0 });

describe('conductor marks (tempo / time-signature display)', () => {
  it('lists real changes in tick order, signature before tempo at one tick', () => {
    const m = conductorMarks([tempo(0, 120), sig(0, 4, 4), tempo(1920, 120), tempo(3840, 140), sig(3840, 3, 4), sig(5280, 3, 4)]);
    expect(m.map((x) => `${x.tick}:${x.text}`)).toEqual(['0:4/4', '0:♩=120', '3840:3/4', '3840:♩=140']);
  });

  it('several tempos at one tick: the last one wins', () => {
    expect(conductorMarks([tempo(0, 100, 'a'), tempo(0, 90, 'b')]).map((x) => x.text)).toEqual(['♩=90']);
  });

  it('formats BPM with up to two decimals', () => {
    expect(formatBpm(500000)).toBe('120');
    expect(formatBpm(Math.round(60e6 / 96.5))).toBe('96.5');
    expect(formatBpm(450000)).toBe('133.33');
  });

  it('names key signatures and lists every marker', () => {
    expect(keyName(0, false)).toBe('C');
    expect(keyName(1, false)).toBe('G');
    expect(keyName(-3, true)).toBe('Cm');
    expect(keyName(3, true)).toBe('F♯m');
    const m = conductorMarks([
      { id: 'k0', kind: 'key-signature', tick: 0, sharpsFlats: -1, minor: false, originOrder: 0 },
      { id: 'm0', kind: 'marker', tick: 0, text: 'Intro', originOrder: 1 },
      { id: 'k1', kind: 'key-signature', tick: 1920, sharpsFlats: -1, minor: false, originOrder: 2 }, // no change
      { id: 'm1', kind: 'marker', tick: 3840, text: 'A', originOrder: 3 },
      { id: 'k2', kind: 'key-signature', tick: 3840, sharpsFlats: 2, minor: false, originOrder: 4 },
      tempo(3840, 140),
      sig(3840, 3, 4),
    ]);
    expect(m.map((x) => `${x.tick}:${x.kind}:${x.text}`)).toEqual(['0:key:Key F', '0:marker:Intro', '3840:signature:3/4', '3840:key:Key D', '3840:tempo:♩=140', '3840:marker:A']);
  });
});
