import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../../src/core/model/ids';
import { arpeggiateChords } from '../../../src/core/editing/perform';
import { note, Session } from './helpers';

beforeEach(() => setIdGenerator(createCounterIdGenerator('e')));

describe('arpeggio (PT-03)', () => {
  it('up: a 3-note chord of 480 ticks becomes 3 steps of 160 with 80 % gates, ids kept', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(0, 64), note(0, 67)]);
    const r = arpeggiateChords(s.project, ids, { pattern: 'up' });
    s.run(r.command);
    expect(s.rows()).toEqual([
      [0, 60, 128, 100],
      [160, 64, 128, 100],
      [320, 67, 128, 100],
    ]);
    expect(s.notes().map((n) => n.id)).toEqual(ids);
    expect(r.ids).toEqual(ids);
    s.undo();
    expect(s.rows().map((x) => x[0])).toEqual([0, 0, 0]);
  });

  it('down reverses the order', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(0, 64), note(0, 67)]);
    s.run(arpeggiateChords(s.project, ids, { pattern: 'down' }).command);
    expect(s.rows().map((x) => [x[0], x[1]])).toEqual([
      [0, 67],
      [160, 64],
      [320, 60],
    ]);
  });

  it('up and down: 2n-2 steps without repeating the turning notes; the extra notes are new ids in the clip', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 960), note(0, 64, 960), note(0, 67, 960)]);
    const r = arpeggiateChords(s.project, ids, { pattern: 'updown' });
    s.run(r.command);
    expect(s.rows()).toEqual([
      [0, 60, 192, 100],
      [240, 64, 192, 100],
      [480, 67, 192, 100],
      [720, 64, 192, 100],
    ]);
    const all = s.notes().map((n) => n.id);
    expect(new Set(all).size).toBe(4);
    expect(r.ids).toEqual(all.filter((id) => ids.includes(id)).concat(all.filter((id) => !ids.includes(id))));
    const clip = s.project.clips.find((c) => c.trackId === s.track.id)!;
    expect(clip.eventIds).toEqual(expect.arrayContaining(all));
    expect(s.project.clips.length).toBe(1);
    s.undo();
    expect(s.notes().length).toBe(3);
    expect(s.history.past.length).toBe(1);
    s.redo();
    expect(s.notes().length).toBe(4);
  });

  it('two notes up and down is just up', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(0, 64)]);
    s.run(arpeggiateChords(s.project, ids, { pattern: 'updown' }).command);
    expect(s.rows().map((x) => x[0])).toEqual([0, 240]);
  });

  it('the span ends at the next chord when it comes before the chord end; the next chord is untouched', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 1920), note(0, 64, 1920), note(480, 65, 480), note(480, 69, 480)]);
    s.run(arpeggiateChords(s.project, ids, { pattern: 'up' }).command);
    expect(s.rows()).toEqual([
      [0, 60, 192, 100],
      [240, 64, 192, 100],
      [480, 65, 192, 100],
      [720, 69, 192, 100],
    ]);
  });

  it('4- and 5-note chords, odd spans: every step is at least one tick and inside the span', () => {
    const s = new Session();
    const ids = s.add([note(0, 60, 7), note(0, 62, 7), note(0, 64, 7), note(0, 65, 7), note(0, 67, 7)]);
    s.run(arpeggiateChords(s.project, ids, { pattern: 'up' }).command);
    expect(s.rows().map((x) => [x[0], x[2]])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [4, 1],
      [5, 1],
    ]);
  });

  it('single notes and chords shorter than their step count are left alone with a notice', () => {
    const s = new Session();
    const ids = s.add([note(0, 60), note(480, 60, 2), note(480, 64, 2), note(480, 67, 2)]);
    const r = arpeggiateChords(s.project, ids, { pattern: 'up' });
    expect(r.command).toBeNull();
    expect(r.stats.skipped).toBe(2);
    expect(r.notice).toBeTruthy();
    const single = arpeggiateChords(s.project, [ids[0]], { pattern: 'up' });
    expect(single.command).toBeNull();
    expect(single.notice).toBeTruthy();
  });
});
