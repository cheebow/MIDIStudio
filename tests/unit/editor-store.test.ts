import { describe, expect, it } from 'vitest';
import { EditorStore } from '../../src/app/store/EditorStore';
import { createEmptyProject } from '../../src/core/model/defaults';
import { addEvents, addTrack } from '../../src/core/editing/operations';

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
});
