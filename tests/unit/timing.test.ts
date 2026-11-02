import { describe, expect, it } from 'vitest';
import { TempoMap, bpmFromUs } from '../../src/core/timing/tempoMap';
import { TimeSignatureMap } from '../../src/core/timing/timeSignatureMap';
import { classic48ToTicks, formatClassic48, isClassic48Lossless, ticksToClassic48 } from '../../src/core/timing/classic48';
import { formatRational, parseRational } from '../../src/core/timing/rational';

describe('TempoMap', () => {
  it('defaults to 120 BPM without tempo events', () => {
    const m = new TempoMap(480, []);
    expect(m.tickToSeconds(480)).toBeCloseTo(0.5, 12);
    expect(m.bpmAt(0)).toBe(120);
  });

  it('C03: integrates over several tempo changes; tick -> seconds -> tick within 1 tick', () => {
    const ppq = 480;
    const m = new TempoMap(ppq, [
      { tick: 0, usPerQuarter: 500000 },
      { tick: 1920, usPerQuarter: 400000 },
      { tick: 3840, usPerQuarter: 857143 },
      { tick: 5000, usPerQuarter: 250000 },
    ]);
    expect(m.tickToSeconds(1920)).toBeCloseTo(2, 12);
    expect(m.tickToSeconds(3840)).toBeCloseTo(2 + 1.6, 12);
    for (let t = 0; t < 20000; t += 37) {
      expect(Math.abs(Math.round(m.secondsToTick(m.tickToSeconds(t))) - t)).toBeLessThanOrEqual(1);
      expect(m.secondsToTick(m.tickToSeconds(t))).toBeCloseTo(t, 6);
    }
  });

  it('several tempos at the same tick: the last one wins', () => {
    const m = new TempoMap(480, [
      { tick: 0, usPerQuarter: 500000 },
      { tick: 0, usPerQuarter: 250000 },
    ]);
    expect(m.usPerQuarterAt(0)).toBe(250000);
    expect(bpmFromUs(250000)).toBe(240);
  });
});

describe('TimeSignatureMap', () => {
  it('C04: 3/4 -> 6/8 -> 4/4 bar/beat positions follow the changes', () => {
    const ppq = 480;
    const m = new TimeSignatureMap(ppq, [
      { tick: 0, numerator: 3, denominator: 4 },
      { tick: 1440 * 2, numerator: 6, denominator: 8 },
      { tick: 1440 * 2 + 1440, numerator: 4, denominator: 4 },
    ]);
    expect(m.tickToBarBeat(0)).toMatchObject({ bar: 1, beat: 1, tickInBeat: 0 });
    expect(m.tickToBarBeat(1440)).toMatchObject({ bar: 2, beat: 1 });
    expect(m.tickToBarBeat(1440 + 960)).toMatchObject({ bar: 2, beat: 3 });
    expect(m.tickToBarBeat(2880)).toMatchObject({ bar: 3, beat: 1, numerator: 6, denominator: 8 });
    expect(m.tickToBarBeat(2880 + 240 * 5)).toMatchObject({ bar: 3, beat: 6 });
    expect(m.tickToBarBeat(4320)).toMatchObject({ bar: 4, beat: 1, numerator: 4 });
    expect(m.tickToBarBeat(4320 + 1920 + 480 + 10)).toMatchObject({ bar: 5, beat: 2, tickInBeat: 10 });
    expect(m.barBeatToTick(4)).toBe(4320);
    expect(m.barBeatToTick(3, 2)).toBe(2880 + 240);
    expect(m.format(4320 + 1920 + 480 + 10)).toBe('005.02.010');
  });

  it('a change in the middle of a bar starts a new bar there', () => {
    const m = new TimeSignatureMap(480, [{ tick: 960, numerator: 3, denominator: 4 }]);
    expect(m.tickToBarBeat(960)).toMatchObject({ bar: 2, beat: 1 });
  });

  it('handles beats that are not a whole number of ticks (PPQ 25, x/8)', () => {
    const m = new TimeSignatureMap(25, [{ tick: 0, numerator: 7, denominator: 8 }]);
    expect(m.ticksPerBeat(0)).toBe(12.5);
    expect(m.tickToBarBeat(13)).toMatchObject({ bar: 1, beat: 2, tickInBeat: 0.5 });
  });
});

describe('Classic 48 (C15)', () => {
  it('converts exactly when PPQ divides cleanly', () => {
    expect(formatClassic48(480, 480)).toBe('48');
    expect(formatClassic48(120, 480)).toBe('12');
    expect(formatClassic48(10, 480)).toBe('1');
    expect(classic48ToTicks('12', 480)).toEqual({ ok: true, ticks: 120 });
    expect(isClassic48Lossless(48)).toBe(true);
    expect(isClassic48Lossless(480)).toBe(false);
  });

  it('shows fractional values exactly and never rounds them (PPQ 960 / 1000 / 96)', () => {
    expect(formatClassic48(25, 960)).toBe('1.25');
    expect(formatClassic48(1, 1000)).toBe('0.048');
    expect(formatClassic48(1, 7)).toBe('48/7');
    expect(ticksToClassic48(3, 96)).toEqual({ num: 3, den: 2 });
    expect(formatClassic48(3, 96)).toBe('1.5');
  });

  it('rejects inexact input instead of rounding', () => {
    const r = classic48ToTicks('1', 1000); // 1000/48 ticks = 20.833...
    expect(r).toMatchObject({ ok: false, reason: 'inexact', display: '125/6' });
    expect(classic48ToTicks('12.5', 96)).toEqual({ ok: true, ticks: 25 });
    expect(classic48ToTicks('abc', 480)).toEqual({ ok: false, reason: 'syntax' });
  });

  it('rational helpers', () => {
    expect(parseRational('25/2')).toEqual({ num: 25, den: 2 });
    expect(parseRational('-0.5')).toEqual({ num: -1, den: 2 });
    expect(formatRational({ num: 1, den: 3 })).toBe('1/3');
    expect(formatRational({ num: -5, den: 4 })).toBe('-1.25');
  });
});
