import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../../src/core/model/ids';
import { legatoNotes } from '../../../src/core/editing/perform';
import { note, Session, tempo } from './helpers';

beforeEach(() => setIdGenerator(createCounterIdGenerator('e')));

describe('legato (PT-04)', () => {
  it('connect: a note ends where the next selected note starts (spec 6.3)', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 100), note(120, 62, 100)]);
    const r = legatoNotes(s.project, ids, { mode: 'connect' });
    s.run(r.command);
    expect(s.rows()).toEqual([
      [0, 60, 120, 100],
      [120, 62, 100, 100], // the last note never changes
    ]);
    expect(r.stats).toEqual({ notes: 2, groups: 2, skipped: 0 });
    expect(s.history.past.length).toBe(2);
    s.undo();
    expect(s.rows()[0][2]).toBe(100);
    s.redo();
    expect(s.rows()[0][2]).toBe(120);
  });

  it('overlap / detach: 15 ms at 120 BPM and 480 PPQ is 14 ticks, capped by a quarter of the gap', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 400), note(480, 62, 400), note(960, 64, 400)]);
    s.run(legatoNotes(s.project, ids, { mode: 'overlap' }).command);
    expect(s.rows().map((r) => r[2])).toEqual([494, 494, 400]);
    s.undo();
    s.run(legatoNotes(s.project, ids, { mode: 'detach' }).command);
    expect(s.rows().map((r) => r[2])).toEqual([466, 466, 400]);
    s.undo();
    // very fast repeats: the gap wins over the 15 ms
    const fast = s.add([note(2000, 60, 10), note(2020, 60, 10)]);
    s.run(legatoNotes(s.project, fast, { mode: 'detach' }).command);
    expect(s.notes().find((n) => n.tick === 2000)!.durationTicks).toBe(15); // 20 - min(14, 5)
  });

  it('repeated notes keep at least one tick before the next onset', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 480), note(1, 60, 480)]);
    s.run(legatoNotes(s.project, ids, { mode: 'detach' }).command);
    expect(s.rows()[0][2]).toBe(1);
  });

  it('chords move as a group to the next chord; onset, pitch and velocity never change', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 200, 90), note(0, 64, 300, 70), note(0, 67, 250), note(960, 65, 100), note(960, 69, 100)]);
    s.run(legatoNotes(s.project, ids, { mode: 'connect' }).command);
    expect(s.rows()).toEqual([
      [0, 60, 960, 90],
      [0, 64, 960, 70],
      [0, 67, 960, 100],
      [960, 65, 100, 100],
      [960, 69, 100, 100],
    ]);
  });

  it('already overlapping notes get the same target, so repeating the transform changes nothing more', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 900), note(480, 62, 900), note(960, 64, 100)]);
    s.run(legatoNotes(s.project, ids, { mode: 'overlap' }).command);
    const once = s.rows();
    expect(once.map((r) => r[2])).toEqual([494, 494, 100]);
    const again = legatoNotes(s.project, ids, { mode: 'overlap' });
    expect(again.command).toBeNull();
  });

  it('a note held through the following chord is a pedal tone and stays', () => {
    const s = new Session();
    const ids = s.add([note(0, 36, 1920), note(0, 60, 400), note(480, 62, 400), note(960, 64, 400)]);
    const r = legatoNotes(s.project, ids, { mode: 'connect' });
    s.run(r.command);
    expect(s.rows()).toEqual([
      [0, 36, 1920, 100],
      [0, 60, 480, 100],
      [480, 62, 480, 100],
      [960, 64, 400, 100],
    ]);
    expect(r.stats.skipped).toBe(1);
    expect(r.notice).toContain('1');
  });

  it('only the selection counts: unselected notes are neither changed nor used as the reference', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 100), note(240, 61, 100), note(480, 62, 100)]);
    s.run(legatoNotes(s.project, [ids[0], ids[2]], { mode: 'connect' }).command);
    expect(s.rows()).toEqual([
      [0, 60, 480, 100],
      [240, 61, 100, 100],
      [480, 62, 100, 100],
    ]);
  });

  it('tempo changes: the 15 ms is converted at the note position (60 BPM = 7 ticks, 240 BPM = 29 ticks)', () => {
    const s = new Session({ conductor: [tempo(0, 60), tempo(1920, 240)] });
    const ids = s.add([note(0, 60, 480), note(480, 62, 480), note(1920, 64, 480), note(2400, 65, 480), note(2880, 67, 480)]);
    s.run(legatoNotes(s.project, ids, { mode: 'overlap' }).command);
    expect(s.rows().map((r) => r[2])).toEqual([487, 1447, 509, 509, 480]); // 480 → 1920 is the next selected chord
  });

  it('other PPQ: the same music at 96 PPQ', () => {
    const s = new Session({ ppq: 96 });
    const ids = s.add([note(0, 60, 20), note(24, 62, 20)]);
    s.run(legatoNotes(s.project, ids, { mode: 'connect' }).command);
    expect(s.rows()[0][2]).toBe(24);
  });

  it('nothing to do: a single note, or an empty selection', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 100)]);
    const r = legatoNotes(s.project, ids, { mode: 'connect' });
    expect(r.command).toBeNull();
    expect(r.notice).toBeTruthy();
    expect(legatoNotes(s.project, [], { mode: 'connect' }).command).toBeNull();
  });
});
