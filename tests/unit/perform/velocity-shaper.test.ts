import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../../src/core/model/ids';
import { shapeVelocities } from '../../../src/core/editing/perform';
import { beatGain } from '../../../src/core/editing/perform/velocityShaper';
import { note, Session, sig } from './helpers';

beforeEach(() => setIdGenerator(createCounterIdGenerator('e')));

describe('velocity shaper (PT-05)', () => {
  it('crescendo / decrescendo: 85 % at the first onset to 115 % at the last (spec 7.3: 80,80,80 → 68,80,92)', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 480, 80), note(480, 62, 480, 80), note(960, 64, 480, 80)]);
    const r = shapeVelocities(s.project, ids, { shape: 'crescendo' });
    s.run(r.command);
    expect(s.rows().map((x) => x[3])).toEqual([68, 80, 92]);
    expect(s.rows().map((x) => [x[0], x[1], x[2]])).toEqual([
      [0, 60, 480],
      [480, 62, 480],
      [960, 64, 480],
    ]);
    s.undo();
    s.run(shapeVelocities(s.project, ids, { shape: 'decrescendo' }).command);
    expect(s.rows().map((x) => x[3])).toEqual([92, 80, 68]);
    expect(s.history.past.length).toBe(2);
  });

  it('chords share one factor, so the inner balance survives', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 480, 100), note(0, 64, 480, 60), note(960, 62, 480, 100), note(960, 65, 480, 60)]);
    s.run(shapeVelocities(s.project, ids, { shape: 'crescendo' }).command);
    expect(s.rows().map((x) => x[3])).toEqual([85, 51, 115, 69]);
  });

  it('clamps to 1..127', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 480, 1), note(480, 62, 480, 127)]);
    s.run(shapeVelocities(s.project, ids, { shape: 'crescendo' }).command);
    expect(s.rows().map((x) => x[3])).toEqual([1, 127]);
  });

  it('alternate accent: onset groups take 110 % / 90 % in turn, not single notes', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 480, 100), note(0, 64, 480, 100), note(480, 62, 480, 100), note(960, 64, 480, 100)]);
    s.run(shapeVelocities(s.project, ids, { shape: 'alternate' }).command);
    expect(s.rows().map((x) => x[3])).toEqual([110, 110, 90, 110]);
  });

  it('beat accent in 4/4: beat 1 = 115 %, beat 3 = 107 %, beats 2 / 4 = 100 %, off-beats = 90 %', () => {
    const s = new Session();
    const ids = s.add([0, 240, 480, 960, 1440].map((t) => note(t, 60, 100, 100)));
    s.run(shapeVelocities(s.project, ids, { shape: 'beat' }).command);
    expect(s.rows().map((x) => x[3])).toEqual([115, 90, 100, 107, 100]);
  });

  it('beat accent follows a time-signature change (6/8 from bar 2: eighths 1 and 4 are the strong ones)', () => {
    const s = new Session({ conductor: [sig(0, 4, 4), sig(1920, 6, 8)] });
    const ids = s.add([1920, 2160, 2400, 2640, 2880, 3120].map((t) => note(t, 60, 100, 100)));
    s.run(shapeVelocities(s.project, ids, { shape: 'beat' }).command);
    expect(s.rows().map((x) => x[3])).toEqual([115, 100, 100, 107, 100, 100]);
    expect(beatGain({ bar: 1, beat: 3, tickInBeat: 0, numerator: 3, denominator: 4 })).toBe(1);
  });

  it('a single onset cannot swell: no change and a notice', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 480, 100), note(0, 64, 480, 100)]);
    const r = shapeVelocities(s.project, ids, { shape: 'crescendo' });
    expect(r.command).toBeNull();
    expect(r.notice).toBeTruthy();
    expect(shapeVelocities(s.project, ids, { shape: 'beat' }).command).not.toBeNull();
  });
});
