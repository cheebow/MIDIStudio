// Regression tests of the 4th review (ADR-094): core editing, list and recording.
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import type { MidiProject, NoteEvent } from '../../src/core/model/types';
import { applyCommand, createHistory, execute, undo, type Command } from '../../src/core/editing/history';
import { addEvents, updateEvents, type NewEvent } from '../../src/core/editing/operations';
import { copyEvents } from '../../src/core/editing/clipboard';
import { quantizeNotes } from '../../src/core/editing/quantize';
import { arpeggiateChords, legatoNotes } from '../../src/core/editing/perform';
import { looseNoteIds } from '../../src/core/model/looseNotes';
import { convertEventKind } from '../../src/core/list/listConvert';
import { pasteRowsAt } from '../../src/core/list/listPaste';
import { LiveTake } from '../../src/core/recording/liveTake';
import { takeToCommand } from '../../src/core/recording/applyTake';
import { stepNotes, stepTie, type StepSettings } from '../../src/core/recording/stepRecorder';
import { TempoMap } from '../../src/core/timing/tempoMap';

beforeEach(() => setIdGenerator(createCounterIdGenerator('b')));

const note = (tick: number, pitch: number, durationTicks = 480, velocity = 100): NewEvent => ({ kind: 'note', tick, pitch, velocity, durationTicks, releaseVelocity: 64 });
const apply = (p: MidiProject, c: Command | null | undefined) => (c ? applyCommand(p, c).project : p);
const notesOf = (p: MidiProject, i = 0) => p.tracks[i].events.filter((e): e is NoteEvent => e.kind === 'note');
const rows = (p: MidiProject) => notesOf(p).map((n) => [n.tick, n.pitch, n.durationTicks]);

describe('recording', () => {
  // Recorder.loopPlace (ADR-088) moves a Note On played within a 32nd before the loop end to the loop
  // start of the NEXT pass; the Note Off of a short tap (a drum pad, a staccato key) still arrives
  // before the engine wraps and is given the OLD pass. LiveTake.closeNote then sees
  // `on.pass !== offPass` and stretches the note to the loop end.
  it('BUG-1 loop recording: a short tap just before the loop end becomes a note as long as the whole loop', () => {
    const take = new LiveTake({ tempo: new TempoMap(480, []), loop: { startTick: 0, endTick: 1920 } }); // 120 BPM: the loop is 2 s
    // what Recorder.capture sends for a tap pressed 30 ms and released 10 ms before the loop end of pass 0
    take.add({ type: 'note-on', pitch: 36, velocity: 100, songSeconds: 0, pass: 1 }); // moved to the downbeat of pass 1
    take.add({ type: 'note-off', pitch: 36, releaseVelocity: 64, songSeconds: 1.99, pass: 0 }); // tick 1910 of pass 0
    const res = take.finish(1.0, 1);
    const recorded = res.takes.flatMap((t) => t.events).filter((e) => e.kind === 'note');
    expect(recorded.length).toBe(1);
    expect(recorded[0].tick).toBe(0);
    // a 20 ms tap: anything up to a 32nd (60 ticks) would be fine, the whole loop (1920) is not
    expect((recorded[0] as { durationTicks: number }).durationTicks).toBeLessThanOrEqual(60);
  });

  // takeToCommand quantizes the onsets first, but Replace still removes the old notes in the
  // UNquantized recorded range (take.range starts at the first raw onset).
  it('BUG-2 replace + record quantize: the old note under the first quantized note survives (doubled note)', () => {
    let p = createEmptyProject();
    p = apply(p, addEvents(p, p.tracks[0].id, [note(960, 60, 240)])!.command); // the part being re-recorded
    const take = new LiveTake({ tempo: new TempoMap(480, []) });
    take.add({ type: 'note-on', pitch: 60, velocity: 90, songSeconds: 1.0 + 10 / 960 }); // tick 970: 10 ticks late
    take.add({ type: 'note-off', pitch: 60, releaseVelocity: 64, songSeconds: 1.2 });
    p = apply(p, takeToCommand(p, p.tracks[0].id, take.finish(2), { mode: 'replace', quantize: { num: 120, den: 1 } })!.command);
    // the new note is quantized onto 960, where the old one still is
    expect(notesOf(p).map((n) => [n.tick, n.pitch, n.velocity])).toEqual([[960, 60, 90]]);
  });

  // stepTie puts the cursor at the END OF THE NOTE (gate included) instead of the next step line.
  it('BUG-5 step input: a tie with the default 90 % gate moves the cursor off the step grid', () => {
    const s8: StepSettings = { stepTicks: 240, gate: { ratio: 0.9 }, autoAdvance: true };
    let p = createEmptyProject();
    const a = stepNotes(p, p.tracks[0].id, { cursor: 0, lastStep: null }, s8, [{ pitch: 60, velocity: 100 }]);
    p = apply(p, a.command);
    expect(a.state.cursor).toBe(240);
    const b = stepTie(p, a.state, s8);
    p = apply(p, b.command);
    expect(rows(p)).toEqual([[0, 60, 216 + 240]]); // the tied note: two steps, gate kept
    // two eighths were entered: the next note belongs on 480, not on 456
    expect(b.state.cursor).toBe(480);
  });
});

describe('performance tools', () => {
  // legatoNotes 'overlap' extends every note of a chord past the next onset, also when the next
  // chord plays the same key: two notes of one key overlap, and the first one's Note Off cuts the
  // second (the rule LiveTake.trimOverlap and ADR-082 / 084 guard elsewhere).
  it('BUG-3 legato overlap: a common tone / repeated note overlaps the next note of the same key', () => {
    let p = createEmptyProject();
    const r = addEvents(p, p.tracks[0].id, [note(0, 60, 240), note(0, 64, 240), note(480, 60, 240), note(480, 65, 240)])!; // C E -> C F
    p = apply(p, r.command);
    p = apply(p, legatoNotes(p, r.ids, { mode: 'overlap' }).command);
    const first = notesOf(p).find((n) => n.tick === 0 && n.pitch === 60)!;
    expect(notesOf(p).find((n) => n.tick === 0 && n.pitch === 64)!.durationTicks).toBe(494); // E overlaps F: fine
    expect(first.tick + first.durationTicks).toBeLessThanOrEqual(480); // C must not run into the next C
  });

  // arpeggioStepTicks rounds ONE step (ppq / 8 = 12.5 -> 13) and adds it up, instead of rounding
  // each onset: at a PPQ the note value does not divide, the steps drift and one goes missing.
  it('BUG-9 arpeggio by note value at PPQ 100: a whole note holds 31 "32nd" steps instead of 32', () => {
    let p = createEmptyProject({ ppq: 100 });
    const r = addEvents(p, p.tracks[0].id, [note(0, 60, 400), note(0, 64, 400), note(0, 67, 400)])!;
    p = apply(p, r.command);
    p = apply(p, arpeggiateChords(p, r.ids, { pattern: 'up', rhythm: '32' }).command);
    const onsets = notesOf(p).map((n) => n.tick).sort((a, b) => a - b);
    expect(onsets.length).toBe(32);
    expect(onsets[8]).toBe(100); // the 9th 32nd is on beat 2
  });
});

describe('editing', () => {
  // quantizeEnds snaps the end with the same "nearest line" rule; a note shorter than half a grid
  // has its end snapped onto its own start and is left 1 tick long.
  it('BUG-8 quantize "ends too": a note shorter than half the grid collapses to 1 tick', () => {
    let p = createEmptyProject();
    const r = addEvents(p, p.tracks[0].id, [note(0, 60, 100)])!;
    p = apply(p, r.command);
    p = apply(p, quantizeNotes(p, r.ids, { grid: { num: 240, den: 1 }, quantizeEnds: true }));
    expect(rows(p)).toEqual([[0, 60, 240]]); // at least one grid, as the "grid" length mode does (ADR-043)
  });

  // undo() leaves the mergeKey on the entry that becomes the top of the history, so the next
  // command with that key is merged into a step from BEFORE the undo (redo() clears it:
  // "Merging must not continue across an undo/redo boundary"). Stable keys exist in the app:
  // `list-nudge:{row}:{col}`, `list-chord:{row}`.
  it("BUG-7 history: after an undo, a command with an older step's mergeKey is merged into that old step", () => {
    let p = createEmptyProject();
    let h = createHistory();
    const r = addEvents(p, p.tracks[0].id, [note(0, 60, 480, 100)])!;
    ({ project: p, history: h } = execute(p, h, r.command));
    const vel = (q: MidiProject, v: number) => updateEvents(q, [{ id: r.ids[0], changes: { velocity: v } }])!;
    ({ project: p, history: h } = execute(p, h, vel(p, 101), { mergeKey: 'list-nudge:row:vel' })); // + on VEL
    ({ project: p, history: h } = execute(p, h, addEvents(p, p.tracks[0].id, [note(960, 62)])!.command)); // something else
    ({ project: p, history: h } = undo(p, h)); // undo "something else"
    ({ project: p, history: h } = execute(p, h, vel(p, 102), { mergeKey: 'list-nudge:row:vel' })); // + on VEL again
    expect(h.past.length).toBe(3); // add, nudge, nudge
    ({ project: p } = undo(p, h));
    expect(notesOf(p)[0].velocity).toBe(101); // one Undo takes back one nudge
  });
});

describe('list editor', () => {
  // rewriteEvents keeps clip membership as it is. A CC that is in no clip (mixer / inspector values
  // on a track without a clip at that position, or a CC inserted in a gap) turned into a note is a
  // loose note: silent in playback and left out of the export (ADR-064), where addEvents would have
  // given it a clip (ADR-060).
  it('BUG-4 kind conversion: a CC outside every clip converted to a note stays outside (silent note)', () => {
    let p = createEmptyProject();
    const r = addEvents(p, p.tracks[0].id, [{ kind: 'cc', tick: 0, controller: 7, value: 100 }])!;
    p = apply(p, r.command);
    expect(p.clips).toEqual([]); // CC alone makes no clip (ADR-060)
    p = apply(p, convertEventKind(p, r.ids[0], { kind: 'note', pitch: 60 }));
    expect(notesOf(p).length).toBe(1);
    expect(looseNoteIds(p, p.tracks[0]).size).toBe(0);
  });

  // pasteRowsAt('insert') scales the pasted events to the project PPQ (pasteEvents / scaleTo) but
  // pushes the later events by `data.span` in the SOURCE PPQ. The clipboard survives opening
  // another song (EditorStore.load keeps it), which is what ClipboardData.ppq is for.
  it('BUG-6 insert-paste from a song with another PPQ pushes the later rows by the unscaled span', () => {
    let src = createEmptyProject({ ppq: 480 });
    const s = addEvents(src, src.tracks[0].id, [note(0, 60, 1920)])!; // one bar
    src = apply(src, s.command);
    const data = copyEvents(src, s.ids)!;
    expect(data.span).toBe(1920);

    let dst = createEmptyProject({ ppq: 96 });
    dst = apply(dst, addEvents(dst, dst.tracks[0].id, [note(0, 72, 96)])!.command);
    dst = apply(dst, pasteRowsAt(dst, dst.tracks[0].id, 0, data, 'insert')!.command);
    // the pasted bar is 384 ticks here; the old note moves back by that bar, not by five bars
    expect(rows(dst)).toEqual([
      [0, 60, 384],
      [384, 72, 96],
    ]);
  });
});
