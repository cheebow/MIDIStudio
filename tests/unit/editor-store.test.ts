import { describe, expect, it } from 'vitest';
import { EditorStore } from '../../src/app/store/EditorStore';
import { createEmptyProject } from '../../src/core/model/defaults';
import { addEvents, addTrack, updateEvents, type NewEvent } from '../../src/core/editing/operations';
import { mergeTracks } from '../../src/core/editing/trackMerge';
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

  it('ADR-082: Undo / Redo of an edit keep the current mute / solo', () => {
    const s = new EditorStore(createEmptyProject());
    const id = s.project.tracks[0].id;
    s.run(addEvents(s.project, id, [{ kind: 'note', tick: 0, pitch: 60, velocity: 100, durationTicks: 480, releaseVelocity: 64 }])!.command);
    s.setTrackFlags(id, { mute: true, solo: true });
    s.undo();
    expect(s.project.tracks[0].events).toHaveLength(0);
    expect(s.project.tracks[0]).toMatchObject({ mute: true, solo: true });
    s.setTrackFlags(id, { solo: false });
    s.redo();
    expect(s.project.tracks[0].events).toHaveLength(1);
    expect(s.project.tracks[0]).toMatchObject({ mute: true, solo: false });
  });

  it('ADR-080: selecting a track is a view setting only (no arm flags to update)', () => {
    const s = new EditorStore(createEmptyProject());
    s.run(addTrack(s.project, { name: 'B' }).command);
    s.markSaved();
    const rev = s.getState().revision;
    s.updateSettings({ selectedTrackId: s.project.tracks[1].id });
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().revision).toBe(rev);
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

  it('ADR-086: Undo of a track merge restores the flags the merge changed; flags set later are kept', () => {
    const s = new EditorStore(createEmptyProject());
    s.run(addTrack(s.project, { name: 'B' }).command);
    const [a, b] = s.project.tracks;
    s.setTrackFlags(a.id, { mute: true });
    s.setTrackFlags(b.id, { solo: true });
    s.run(mergeTracks(s.project, [a.id, b.id]));
    s.undo();
    expect(s.project.tracks.map((t) => [t.mute, t.solo])).toEqual([
      [true, false],
      [false, true],
    ]);
    // a flag set after the merge is still kept by its undo
    s.redo();
    s.setTrackFlags(a.id, { solo: false });
    s.undo();
    expect(s.project.tracks.map((t) => [t.mute, t.solo])).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});

describe('EditorStore preview (ADR-077)', () => {
  const noteAt = (tick: number): NewEvent => ({ kind: 'note', tick, pitch: 60, velocity: 100, durationTicks: 100, releaseVelocity: 64 });
  const setup = () => {
    const s = new EditorStore(createEmptyProject());
    const r = addEvents(s.project, s.project.tracks[0].id, [noteAt(0)])!;
    s.run(r.command);
    s.markSaved();
    return { s, id: r.ids[0] };
  };
  /** the velocity the views show (the preview included) */
  const velocityOf = (s: EditorStore, id: string) => (s.getState().project.tracks[0].events.find((e) => e.id === id) as { velocity: number }).velocity;
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
    expect(s.getState().project).toBe(committed);
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
    const n = s.getState().project.tracks[0].events.find((e) => e.id === id) as { pitch: number; velocity: number };
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

  it('store.project is the real song during a preview: an edit built from it (recording, step input) never saves the preview', () => {
    const { s, id } = setup();
    const committed = s.project;
    s.preview((b) => setVelocity(50)(b, id));
    expect(s.project).toBe(committed);
    expect(velocityOf(s, id)).toBe(50);
    // what the recorder does: build a command from store.project, run it
    const rec = addEvents(s.project, s.project.tracks[0].id, [noteAt(480)])!;
    s.run(rec.command);
    expect(s.getState().previewBase).toBeNull();
    expect(velocityOf(s, id)).toBe(100);
    expect(s.getState().project.tracks[0].events.filter((e) => e.kind === 'note').length).toBe(2);
    // the preview of the dialog is rebuilt on the new song, once
    s.preview((b) => setVelocity(50)(b, id));
    s.commitPreview((b) => ({ command: setVelocity(50)(b, id) }));
    expect(velocityOf(s, id)).toBe(50);
    s.undo();
    expect(velocityOf(s, id)).toBe(100);
  });

  it('dropping a preview tells the listeners and moves the revision (a failed apply, a settings change)', () => {
    const { s, id } = setup();
    let calls = 0;
    s.subscribe(() => calls++);
    s.preview((b) => setVelocity(50)(b, id));
    const rev = s.getState().revision;
    calls = 0;
    expect(() =>
      s.commitPreview(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(s.getState().previewBase).toBeNull();
    expect(velocityOf(s, id)).toBe(100);
    expect(calls).toBeGreaterThan(0);
    expect(s.getState().revision).toBeGreaterThan(rev);
    // a settings change during a preview: the Transport (following the revision) reloads the real song
    s.preview((b) => setVelocity(50)(b, id));
    const rev2 = s.getState().revision;
    s.updateSettings({ snapTicks: 2 });
    expect(s.getState().previewBase).toBeNull();
    expect(s.getState().revision).toBeGreaterThan(rev2);
    // a command that changes nothing still ends the preview visibly
    s.preview((b) => setVelocity(50)(b, id));
    calls = 0;
    s.run(updateEvents(s.project, [{ id, changes: { velocity: 100 } }], 'same'));
    expect(velocityOf(s, id)).toBe(100);
    expect(calls).toBeGreaterThan(0);
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
