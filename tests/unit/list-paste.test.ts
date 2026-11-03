// LIST-13: paste at a list row — overlay at the tick, or insert (push the later events back first).
import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { applyCommand } from '../../src/core/editing/history';
import { copyEvents } from '../../src/core/editing/clipboard';
import { listRows } from '../../src/core/list/listRows';
import { pasteRowsAt } from '../../src/core/list/listPaste';
import type { MidiProject } from '../../src/core/model/types';
import { build, cc, off, on, timeSig } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('p')));

function song(): MidiProject {
  const q = 480;
  const r = openMidiFile(build(1, q, [timeSig(0, 4, 2)], [on(0, 0, 60), on(0, 0, 64), off(q, 0, 60), off(0, 0, 64), cc(0, 0, 11, 100), on(q, 0, 72), off(q, 0, 72)]));
  if (!r.ok) throw new Error();
  return r.project;
}
const names = (p: MidiProject) => listRows(p, p.tracks[0]).map((r) => `${r.name}@${r.tick}`);

describe('paste at a row (LIST-13)', () => {
  it('overlay pastes at the tick and moves nothing; insert pushes the later events back by the span', () => {
    const p = song();
    const notes = p.tracks[0].events.filter((e) => e.kind === 'note' && e.tick === 0).map((e) => e.id);
    const clip = copyEvents(p, notes)!;
    expect(clip.span).toBe(480);
    const over = pasteRowsAt(p, p.tracks[0].id, 960, clip, 'overlay')!;
    const q = applyCommand(p, over.command).project;
    expect(names(q)).toEqual(['C4@0', 'E4@0', 'CC11@480', 'C5@960', 'C4@960', 'E4@960']); // C4 / E4 at 0, CC11 at 480, C5 at 960 (deltas)
    expect(over.ids.length).toBe(2);

    const ins = pasteRowsAt(p, p.tracks[0].id, 960, clip, 'insert')!;
    const { project: r, inverse } = applyCommand(p, ins.command);
    expect(names(r)).toEqual(['C4@0', 'E4@0', 'CC11@480', 'C4@960', 'E4@960', 'C5@1440']);
    expect(ins.command.label).toBe('挿入して貼り付け');
    expect(applyCommand(r, inverse).project).toEqual(p); // one undo step
    // insert at the very end: nothing to push, same as overlay
    const tail = pasteRowsAt(p, p.tracks[0].id, 5000, clip, 'insert')!;
    expect(names(applyCommand(p, tail.command).project).slice(-2)).toEqual(['C4@5000', 'E4@5000']);
  });
});
