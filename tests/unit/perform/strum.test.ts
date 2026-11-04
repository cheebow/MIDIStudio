import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../../src/core/model/ids';
import { detectStrokes, strumChords, type StrumOptions } from '../../../src/core/editing/perform';
import { TimeSignatureMap } from '../../../src/core/timing/timeSignatureMap';
import { note, Session, tempo } from './helpers';

beforeEach(() => setIdGenerator(createCounterIdGenerator('e')));

const base: StrumOptions = { stroke: 'auto', speed: 'normal', natural: false };
const chord = (tick: number, len = 240, pitches = [48, 52, 55, 60]) => pitches.map((p) => note(tick, p, len));
const sig44 = new TimeSignatureMap(480, []);

describe('strum (PT-02): stroke direction', () => {
  it('spec 4.7: 1, 2, 2&, 3, 4, 4& on the eighth grid are D D U D D U', () => {
    expect(detectStrokes(sig44, 480, [0, 480, 720, 960, 1440, 1680])).toEqual(['down', 'down', 'up', 'down', 'down', 'up']);
  });
  it('sixteenth input switches to the sixteenth grid (odd sixteenths are up)', () => {
    expect(detectStrokes(sig44, 480, [0, 120, 240, 360, 480])).toEqual(['down', 'up', 'down', 'up', 'down']);
    // an eighth off-beat is then an even sixteenth = down (the hand's motion, spec 4.3 note)
    expect(detectStrokes(sig44, 480, [0, 120, 240])).toEqual(['down', 'up', 'down']);
  });
  it('off-beats only, and a selection starting mid-song: the bar position decides, not the first chord', () => {
    expect(detectStrokes(sig44, 480, [240, 720, 1200])).toEqual(['up', 'up', 'up']);
    expect(detectStrokes(sig44, 480, [1920 + 240, 1920 + 480])).toEqual(['up', 'down']);
  });
  it('3/4 and a signature change: positions restart with each bar', () => {
    const map = new TimeSignatureMap(480, [{ tick: 0, numerator: 3, denominator: 4 }, { tick: 1440, numerator: 4, denominator: 4 }]);
    expect(detectStrokes(map, 480, [1200, 1440, 1680])).toEqual(['up', 'down', 'up']);
  });
  it('slightly off-grid chords take the nearest grid line without being moved', () => {
    expect(detectStrokes(sig44, 480, [5, 475, 730])).toEqual(['down', 'down', 'up']);
  });
  it('other PPQ', () => {
    const map = new TimeSignatureMap(96, []);
    expect(detectStrokes(map, 96, [0, 48, 144])).toEqual(['down', 'up', 'up']);
  });
});

describe('strum (PT-02): note generation', () => {
  it('down: low to high, 45 ms at 120 BPM = 43 ticks spread over the strings; ends stay, velocities stay (natural off)', () => {
    const s = new Session();
    const ids = s.add(chord(0, 480));
    const r = strumChords(s.project, ids, base);
    s.run(r.command);
    expect(s.rows()).toEqual([
      [0, 48, 480, 100],
      [14, 52, 466, 100],
      [29, 55, 451, 100],
      [43, 60, 437, 100],
    ]);
    expect(s.history.past.length).toBe(2);
    s.undo();
    expect(s.rows().map((x) => x[0])).toEqual([0, 0, 0, 0]);
  });

  it('up strokes go high to low; fixed stroke overrides the detection', () => {
    const s = new Session();
    const ids = s.add(chord(240, 240));
    s.run(strumChords(s.project, ids, base).command); // 240 = an up stroke
    expect(s.rows().map((x) => [x[0], x[1]])).toEqual([
      [240, 60],
      [254, 55],
      [269, 52],
      [283, 48],
    ]);
    s.undo();
    s.run(strumChords(s.project, ids, { ...base, stroke: 'down' }).command);
    expect(s.rows().map((x) => [x[0], x[1]])).toEqual([
      [240, 48],
      [254, 52],
      [269, 55],
      [283, 60],
    ]);
  });

  it('speed presets: fast 20 ms = 19 ticks, slow 85 ms = 82 ticks (120 BPM, 480 PPQ)', () => {
    const s = new Session();
    const ids = s.add(chord(0, 480, [48, 60]));
    s.run(strumChords(s.project, ids, { ...base, speed: 'fast' }).command);
    expect(s.rows()[1][0]).toBe(19);
    s.undo();
    s.run(strumChords(s.project, ids, { ...base, speed: 'slow' }).command);
    expect(s.rows()[1][0]).toBe(82);
  });

  it('the width shrinks to half the distance to the next chord; the chord change position stays', () => {
    const s = new Session();
    const ids = s.add([...chord(0, 60, [48, 60]), ...chord(60, 60, [50, 62])]);
    s.run(strumChords(s.project, ids, { ...base, speed: 'slow' }).command);
    expect(s.rows().map((x) => [x[0], x[1], x[2]])).toEqual([
      [0, 48, 60],
      [30, 60, 30],
      [60, 50, 60],
      [90, 62, 30],
    ]);
  });

  it('tempo changes: the ms width is converted at the chord position (60 BPM: 45 ms = 22 ticks)', () => {
    const s = new Session({ conductor: [tempo(0, 120), tempo(1920, 60)] });
    const ids = s.add([...chord(0, 480, [48, 60]), ...chord(1920, 480, [48, 60])]);
    s.run(strumChords(s.project, ids, base).command);
    expect(s.rows().map((x) => x[0])).toEqual([0, 43, 1920, 1942]);
  });

  it('natural: a fixed seed gives the same jitter every time, order never reverses, up strokes are lighter', () => {
    const s = new Session();
    const ids = s.add([...chord(0, 240), ...chord(240, 240)]);
    const a = strumChords(s.project, ids, { ...base, natural: true });
    const b = strumChords(s.project, ids, { ...base, natural: true });
    expect(a.command).toEqual(b.command);
    s.run(a.command);
    const rows = s.rows();
    const down = rows.slice(0, 4);
    const up = rows.slice(4);
    for (let i = 1; i < 4; i++) {
      expect(down[i][0]).toBeGreaterThanOrEqual(down[i - 1][0]);
      expect(up[i][0]).toBeGreaterThanOrEqual(up[i - 1][0]);
    }
    expect(down.map((x) => x[3])).toEqual([100, 98, 96, 94]);
    expect(up.map((x) => x[3])).toEqual([92, 90, 88, 86]);
    expect(down[3][0]).toBeLessThanOrEqual(0 + 43 + 7);
  });

  it('re-applying the same settings is idempotent: a spread chord is grouped again from its first note', () => {
    const s = new Session();
    const ids = s.add(chord(0, 480));
    s.run(strumChords(s.project, ids, base).command);
    const once = s.rows();
    const again = strumChords(s.project, ids, base);
    expect(again.command).toBeNull();
    expect(again.notice).toContain('1');
    expect(s.rows()).toEqual(once);
    // and a different speed recomputes from the same origin instead of drifting further
    s.run(strumChords(s.project, ids, { ...base, speed: 'fast' }).command);
    expect(s.rows().map((x) => x[0])).toEqual([0, 6, 13, 19]);
  });

  it('rests and syncopation: an 8-beat pattern keeps its rhythm; every chord gets its own direction', () => {
    const s = new Session();
    const ticks = [0, 480, 720, 960, 1440, 1680];
    const ids = s.add(ticks.flatMap((t) => chord(t, 200, [48, 60])));
    s.run(strumChords(s.project, ids, base).command);
    const rows = s.rows();
    expect(rows.filter((x) => ticks.includes(x[0])).map((x) => x[1])).toEqual([48, 48, 60, 48, 48, 60]);
    expect(rows.map((x) => x[0])).toEqual([0, 43, 480, 523, 720, 763, 960, 1003, 1440, 1483, 1680, 1723]);
  });
});
