import { describe, expect, it } from 'vitest';
import { EditorStore } from '../../src/app/store/EditorStore';
import { createEmptyProject } from '../../src/core/model/defaults';
import { addEvents, addTrack, updateEvents, type NewEvent } from '../../src/core/editing/operations';
import type { MidiProject } from '../../src/core/model/types';

describe('EditorStore (shared editing state, CLAUDE.md rule 5)', () => {
  it('edits are undoable and mark the song unsaved; view settings are neither', () => {
    const s = new EditorStore(createEmptyProject());
    const rev0 = s.getState().revision;
    s.updateSettings({ pianoRollZoom: 200, activePanel: 'list' });
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().revision).toBe(rev0); // no engine reload for view changes
    const r = addEvents(s.project, s.project.tracks[0].id, [{ kind: 'note', tick: 0, pitch: 60, velocity: 100, durationTicks: 480, releaseVelocity: 64 }])!;
    s.run(r.command, { select: r.ids });
    expect(s.getState().dirty).toBe(true);
    expect([...s.getState().selection.eventIds]).toEqual(r.ids);
    s.undo();
    expect(s.project.tracks[0].events).toHaveLength(0);
    expect(s.getState().selection.eventIds.size).toBe(0); // pruned
    expect(s.project.settings.pianoRollZoom).toBe(200); // undo does not touch view settings
    s.redo();
    expect(s.project.tracks[0].events).toHaveLength(1);
    s.markSaved();
    expect(s.getState().dirty).toBe(false);
  });

  it('loop and mute are saved data (unsaved flag) but not undo steps', () => {
    const s = new EditorStore(createEmptyProject());
    s.setLoop({ enabled: true, startTick: 0, endTick: 1920 });
    s.setTrackFlags(s.project.tracks[0].id, { mute: true });
    expect(s.getState().dirty).toBe(true);
    expect(s.getState().history.past).toHaveLength(0);
  });

  it('ADR-040: with "arm follows selection" on, selecting a track makes it the only armed track', () => {
    const s = new EditorStore(createEmptyProject());
    s.run(addTrack(s.project, { name: 'B' }).command);
    s.run(addTrack(s.project, { name: 'C' }).command);
    const [a, b, c] = s.project.tracks;
    s.setTrackFlags(a.id, { recordArm: true });
    s.markSaved();
    const rev = s.getState().revision;
    // off by default: selecting does not touch the arm flags
    s.updateSettings({ selectedTrackId: b.id });
    expect(s.project.tracks.map((t) => t.recordArm)).toEqual([true, false, false]);
    expect(s.getState().dirty).toBe(false);
    s.updateSettings({ recording: { ...s.project.settings.recording, armFollowsSelection: true } });
    s.updateSettings({ selectedTrackId: c.id });
    expect(s.project.tracks.map((t) => t.recordArm)).toEqual([false, false, true]);
    expect(s.getState().dirty).toBe(true); // arm flags are saved data
    expect(s.getState().revision).toBe(rev + 1);
    expect(s.getState().history.past).toHaveLength(2); // not an undo step
    // selecting the same track again, or an unknown id, changes nothing
    s.setTrackFlags(c.id, { recordArm: false });
    s.updateSettings({ selectedTrackId: c.id });
    s.updateSettings({ selectedTrackId: 'nope' });
    expect(s.project.tracks.some((t) => t.recordArm)).toBe(false);
  });

  it('notifies subscribers once per change', () => {
    const s = new EditorStore(createEmptyProject());
    let n = 0;
    const off = s.subscribe(() => n++);
    s.setTool('draw');
    s.selectEvents([]);
    off();
    s.setTool('select');
    expect(n).toBe(2);
  });
});

describe('new project defaults', () => {
  it('the app starts with a piano Program Change on the first track so it can be played right away', () => {
    const p = createEmptyProject({ defaultProgram: 0 });
    expect(p.tracks[0].events).toMatchObject([{ kind: 'program', tick: 0, program: 0 }]);
    expect(p.nextOriginOrder).toBeGreaterThan(p.tracks[0].events[0].originOrder);
    expect(createEmptyProject().tracks[0].events).toEqual([]);
  });
});

describe('EditorStore preview (ADR-076)', () => {
  const noteAt = (tick: number): NewEvent => ({ kind: 'note', tick, pitch: 60, velocity: 100, durationTicks: 100, releaseVelocity: 64 });
  const setup = () => {
    const s = new EditorStore(createEmptyProject());
    const r = addEvents(s.project, s.project.tracks[0].id, [noteAt(0)])!;
    s.run(r.command);
    s.markSaved();
    return { s, id: r.ids[0] };
  };
  const velocityOf = (s: EditorStore, id: string) => (s.project.tracks[0].events.find((e) => e.id === id) as { velocity: number }).velocity;
  const setVelocity = (v: number) => (base: MidiProject, id: string) => updateEvents(base, [{ id, changes: { velocity: v } }], 'test');

  it('shows the transform in `project` without touching history, dirty or the committed project', () => {
    const { s, id } = setup();
    const committed = s.project;
    s.preview((b) => setVelocity(50)(b, id));
    expect(velocityOf(s, id)).toBe(50);
    expect(s.committedProject).toBe(committed);
    expect(s.getState().previewBase).toBe(committed);
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().history.past.length).toBe(1);
    // a second preview is computed from the same base, not on top of the first
    s.preview((b) => {
      expect(b).toBe(committed);
      return setVelocity(70)(b, id);
    });
    expect(velocityOf(s, id)).toBe(70);
    s.cancelPreview();
    expect(s.project).toBe(committed);
    expect(s.getState().previewBase).toBeNull();
    expect(velocityOf(s, id)).toBe(100);
  });

  it('commitPreview applies one undo step built from the committed project and selects the result', () => {
    const { s, id } = setup();
    s.preview((b) => setVelocity(50)(b, id));
    s.commitPreview((b) => ({ command: setVelocity(60)(b, id), select: [id] }));
    expect(velocityOf(s, id)).toBe(60);
    expect(s.getState().previewBase).toBeNull();
    expect(s.getState().dirty).toBe(true);
    expect(s.getState().history.past.length).toBe(2);
    expect([...s.getState().selection.eventIds]).toEqual([id]);
    s.undo();
    expect(velocityOf(s, id)).toBe(100);
    s.redo();
    expect(velocityOf(s, id)).toBe(60);
  });

  it('any other change drops the preview first, so a stale preview never overwrites it', () => {
    const { s, id } = setup();
    s.preview((b) => setVelocity(50)(b, id));
    s.run(updateEvents(s.committedProject, [{ id, changes: { pitch: 62 } }], 'other'));
    expect(s.getState().previewBase).toBeNull();
    const n = s.project.tracks[0].events.find((e) => e.id === id) as { pitch: number; velocity: number };
    expect(n).toMatchObject({ pitch: 62, velocity: 100 });
    s.preview((b) => setVelocity(50)(b, id));
    s.undo();
    expect(s.getState().previewBase).toBeNull();
    expect(velocityOf(s, id)).toBe(100);
    s.preview((b) => setVelocity(50)(b, id));
    s.updateSettings({ snapTicks: 1 });
    expect(s.getState().previewBase).toBeNull();
    expect(velocityOf(s, id)).toBe(100);
    expect(s.project.settings.snapTicks).toBe(1);
    s.preview((b) => setVelocity(50)(b, id));
    s.load(createEmptyProject());
    expect(s.getState().previewBase).toBeNull();
  });

  it('a null command previews the base; cancel without a preview is a no-op', () => {
    const { s } = setup();
    const before = s.getState();
    s.cancelPreview();
    expect(s.getState()).toBe(before);
    s.preview(() => null);
    expect(s.project).toBe(before.project);
    expect(s.getState().previewBase).toBe(before.project);
    s.cancelPreview();
    expect(s.project).toBe(before.project);
  });
});
