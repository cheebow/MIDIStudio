import { beforeEach, describe, expect, it } from 'vitest';
import { chaseAt, chaseMessages } from '../../src/core/events/chase';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { TempoMap } from '../../src/core/timing/tempoMap';
import { TimeSignatureMap } from '../../src/core/timing/timeSignatureMap';
import { beatsInWindow } from '../../src/core/timing/beats';
import { bend, build, cc, off, on, port, program, sysex, GS_RESET } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('c')));

describe('EventChase across tracks on one channel (ADR-083)', () => {
  it('the latest value in time wins, not the last track', () => {
    const r = openMidiFile(build(1, 480, [program(1000, 0, 5), cc(0, 0, 7, 90), on(0, 0, 60), off(10, 0, 60)], [program(0, 0, 10), cc(0, 0, 7, 20)]), { mergeDrums: false, mergeControllers: false, trackOrder: 'file' });
    if (!r.ok) throw new Error();
    const s = chaseAt(r.project, 2000).channels.get('0:0')!;
    expect(s.program).toBe(5);
    expect(s.controllers.get(7)).toBe(90);
  });
});

describe('EventChase (P03)', () => {
  const r = openMidiFile(
    build(
      1,
      480,
      [sysex(0, GS_RESET), cc(0, 0, 0, 8), cc(0, 0, 32, 1), program(0, 0, 48), cc(0, 0, 7, 100), cc(0, 0, 101, 0), cc(0, 0, 100, 0), cc(0, 0, 6, 12), cc(0, 0, 101, 127), cc(0, 0, 100, 127), on(0, 0, 60), bend(240, 0, 4096), cc(240, 0, 7, 50), off(0, 0, 60), cc(480, 0, 121, 0), program(0, 0, 49)],
      [port(0, 1), program(0, 0, 5), on(0, 0, 40), off(960, 0, 40)],
    ),
  );
  if (!r.ok) throw new Error();
  const project = r.project;

  it('rebuilds bank / program / CC / pitch bend / RPN and SysEx before a tick, never notes', () => {
    const c = chaseAt(project, 481);
    expect(c.sysex.map((s) => [...s.data])).toEqual([GS_RESET]);
    const a = c.channels.get('0:0')!;
    expect(a).toMatchObject({ bankMsb: 8, bankLsb: 1, program: 48, pitchBend: 4096 });
    expect(a.controllers.get(7)).toBe(50);
    expect(a.parameters.get('rpn:0:0')).toEqual({ msb: 12 });
    const msgs = chaseMessages(a);
    expect(msgs.some((m) => (m[0] & 0xf0) === 0x90)).toBe(false);
    expect(msgs.slice(0, 3)).toEqual([[0xb0, 0, 8], [0xb0, 32, 1], [0xc0, 48]]);
    expect(msgs[msgs.length - 1]).toEqual([0xe0, 0, 96]); // 4096 + 8192 = 12288 -> LSB 0, MSB 96
  });

  it('events exactly at the tick are not chased; ports are separate; Reset All Controllers (RP-015) resets PB, not volume', () => {
    expect(chaseAt(project, 0).channels.size).toBe(0);
    expect(chaseAt(project, 1).channels.get('1:0')?.program).toBe(5);
    const later = chaseAt(project, 2000).channels.get('0:0')!;
    expect(later.controllers.get(7)).toBe(50); // ADR-084: volume is not reset by CC121
    expect(later.pitchBend).toBe(0); // ADR-086: chased as centre, so a preview synth that had the bend is reset
    expect(later.program).toBe(49);
  });

  it('ADR-084: CC121 resets modulation, expression (127), pedals and the RPN selection; keeps pan and sends', () => {
    const r = openMidiFile(build(1, 480, [cc(0, 0, 1, 90), cc(0, 0, 11, 40), cc(0, 0, 64, 127), cc(0, 0, 10, 20), cc(0, 0, 91, 70), cc(0, 0, 101, 0), cc(0, 0, 100, 0), cc(10, 0, 121, 0), cc(10, 0, 6, 24), on(0, 0, 60), off(10, 0, 60)]));
    if (!r.ok) throw new Error();
    const s = chaseAt(r.project, 100).channels.get('0:0')!;
    // ADR-086: values set before the reset are chased as their reset value (a preview synth is told it)
    expect([...s.controllers.entries()].sort((a, b) => a[0] - b[0])).toEqual([[1, 0], [10, 20], [11, 127], [64, 0], [91, 70]]);
    expect(s.parameters.size).toBe(0); // the data entry after the reset has no RPN selected
  });
});

describe('metronome beats', () => {
  it('places beats on the tempo map, with accents on bar starts and signature changes', () => {
    const tempo = new TempoMap(480, [{ tick: 0, usPerQuarter: 500000 }, { tick: 1920, usPerQuarter: 1000000 }]);
    const sig = new TimeSignatureMap(480, [{ tick: 0, numerator: 4, denominator: 4 }, { tick: 1920, numerator: 3, denominator: 4 }]);
    const beats = beatsInWindow(tempo, sig, 0, 5);
    expect(beats.map((b) => [b.seconds, b.accent])).toEqual([
      [0, true],
      [0.5, false],
      [1, false],
      [1.5, false],
      [2, true],
      [3, false],
      [4, false],
    ]);
    expect(beatsInWindow(tempo, sig, 0.6, 1.6).map((b) => b.tick)).toEqual([960, 1440]);
    expect(beatsInWindow(tempo, sig, 1, 1)).toEqual([]);
  });

  it('ADR-084: a change in the middle of a bar starts a new bar there, for the click as on the ruler', () => {
    const tempo = new TempoMap(480, [{ tick: 0, usPerQuarter: 500000 }]);
    const sig = new TimeSignatureMap(480, [{ tick: 0, numerator: 4, denominator: 4 }, { tick: 960, numerator: 3, denominator: 4 }]);
    const beats = beatsInWindow(tempo, sig, 0, 3.5).map((b) => [b.tick, b.accent]);
    expect(beats).toEqual([[0, true], [480, false], [960, true], [1440, false], [1920, false], [2400, true], [2880, false]]); // 3360 = 3.5 s is outside the window
    expect(beats.filter(([, a]) => a).map(([tick]) => sig.format(tick as number))).toEqual(['001.01.000', '002.01.000', '003.01.000']);
    // starting in the middle of the new signature still counts from the change
    expect(beatsInWindow(tempo, sig, 1.4, 2.6).map((b) => [b.tick, b.accent])).toEqual([[1440, false], [1920, false], [2400, true]]);
  });
});
