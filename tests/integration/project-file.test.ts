import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import type { MidiProject } from '../../src/core/model/types';
import { parseProjectFile, serializeProject, validateProject } from '../../src/core/project-io/projectFile';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { ProjectStore, StorageError } from '../../src/storage/indexedDb';
import { format1Song } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('p')));

function imported(): MidiProject {
  const r = openMidiFile(format1Song(960));
  if (!r.ok) throw new Error();
  return r.project;
}

describe('.midstudio file', () => {
  it('C12: Project -> .midstudio -> Project keeps events, IDs, settings and PPQ', () => {
    const p = imported();
    const r = parseProjectFile(serializeProject(p, { savedAt: '2026-11-01T00:00:00Z' }));
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.project).toEqual(p);
    expect(r.project.ppq).toBe(960);
  });

  it('O01: loop range, editor settings and key maps are restored', () => {
    const p = createEmptyProject();
    const edited: MidiProject = {
      ...p,
      loop: { enabled: true, startTick: 960, endTick: 3840 },
      settings: { ...p.settings, activePanel: 'list', listDisplayUnit: 'classic48', snapTicks: 160, followPlayback: false },
      inputPresets: { ...p.inputPresets, layout: 'us', drumPadKeys: { ...p.inputPresets.drumPadKeys, KeyQ: 37 }, defaultVelocity: 90 },
    };
    const r = parseProjectFile(serializeProject(edited));
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.project.loop).toEqual(edited.loop);
    expect(r.project.settings).toEqual(edited.settings);
    expect(r.project.inputPresets).toEqual(edited.inputPresets);
  });

  it('invalid view settings (NaN zoom, grid 0, dangling track ids, unknown enums) fall back to defaults instead of rejecting the file', () => {
    const p = imported();
    const json = JSON.parse(serializeProject(p));
    Object.assign(json.project.settings, { horizontalZoom: 0, pianoRollZoom: 'big', grid: { division: 0, kind: 'straight' }, selectedTrackId: 'gone', activePanel: 'nope', controllerLane: 200, laneHeight: -5 });
    json.project.settings.tm = { layout: 'octo', paneTracks: ['gone', p.tracks[0].id], fontSize: 1e9 };
    json.project.settings.recording = { countInBars: 3, latencyMs: 99999, mode: 'replace' };
    json.project.settings.quantize = { grid: { division: 0, kind: 'straight' }, strength: 500, swing: 10, lengths: 'maybe' };
    json.project.settings.humanize = { timingTicks: -5, velocity: 'big', lengthPercent: 10 };
    const r = parseProjectFile(JSON.stringify(json));
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const s = r.project.settings;
    expect(s.horizontalZoom).toBe(24);
    expect(s.pianoRollZoom).toBe(80);
    expect(s.grid).toEqual({ division: 16, kind: 'straight' });
    expect(s.selectedTrackId).toBeUndefined();
    expect(s.activePanel).toBe('piano-roll');
    expect(s.controllerLane).toBe('velocity');
    expect(s.laneHeight).toBe(72);
    expect(s.tm.layout).toBe('single');
    expect(s.tm.paneTracks).toEqual([null, p.tracks[0].id, null, null]);
    expect(s.tm.fontSize).toBe(20);
    expect(s.recording).toMatchObject({ countInBars: 1, latencyMs: 0, mode: 'replace' });
    expect(s.quantize).toEqual({ grid: { division: 16, kind: 'straight' }, strength: 100, swing: 50, lengths: 'keep' });
    expect(s.humanize).toEqual({ timingTicks: Math.max(1, Math.round(p.ppq / 32)), velocity: 10, lengthPercent: 10 });
  });

  it('fills settings fields missing in older files with defaults', () => {
    const p = createEmptyProject();
    const json = JSON.parse(serializeProject(p));
    delete json.project.settings.metronome;
    const r = parseProjectFile(JSON.stringify(json));
    expect(r.ok && r.project.settings.metronome).toBe(false);
  });

  it('ADR-080: files saved with record-arm flags still open; the flags are dropped', () => {
    const p = createEmptyProject();
    const json = JSON.parse(serializeProject(p));
    json.project.tracks[0].recordArm = true;
    json.project.settings.recording.armFollowsSelection = true;
    const r = parseProjectFile(JSON.stringify(json));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('recordArm' in r.project.tracks[0]).toBe(false);
    expect('armFollowsSelection' in r.project.settings.recording).toBe(false);
    expect(serializeProject(r.project)).not.toMatch(/recordArm|armFollowsSelection/);
  });

  it('O04: invalid JSON / wrong format / broken data are rejected with reasons', () => {
    const current = imported();
    const snapshot = JSON.stringify(current);
    const bad = [
      '{not json',
      '{"format":"other"}',
      JSON.stringify({ format: 'midi-studio-project', schemaVersion: 99, project: {} }),
      serializeProject({ ...current, ppq: 0 }),
      serializeProject({ ...current, tracks: [{ ...current.tracks[0], channel: 16 }] }),
    ];
    for (const text of bad) {
      const r = parseProjectFile(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
    }
    // The caller's project object is untouched.
    expect(JSON.stringify(current)).toBe(snapshot);
    // An invalid MIDI file does not produce a project either.
    expect(openMidiFile(new Uint8Array([0x4d, 0x54, 0x68, 0x64])).ok).toBe(false);
  });

  it('validator catches duplicate IDs, dangling clip references and bad Base64', () => {
    const p = imported();
    const dupe = { ...p, tracks: [p.tracks[0], { ...p.tracks[1], events: [...p.tracks[1].events, p.tracks[0].events[0]] }] };
    expect(validateProject(dupe).some((e) => e.includes('重複'))).toBe(true);
    const dangling = { ...p, clips: [{ ...p.clips[0], eventIds: ['nope'] }] };
    expect(validateProject(dangling).some((e) => e.includes('nope'))).toBe(true);
    const sx = p.tracks[0].events.find((e) => e.kind === 'sysex')!;
    const badB64 = { ...p, tracks: [{ ...p.tracks[0], events: p.tracks[0].events.map((e) => (e.id === sx.id ? { ...e, dataBase64: '@@@' } : e)) }, p.tracks[1]] };
    expect(validateProject(badB64).some((e) => e.includes('Base64'))).toBe(true);
  });
});

describe('IndexedDB store', () => {
  it('saves, lists, loads and deletes projects; autosave slot round-trips', async () => {
    const store = new ProjectStore(new IDBFactory());
    const p = imported();
    const json = serializeProject(p);
    await store.saveProject({ id: p.id, title: p.title, savedAt: '2026-11-01T01:00:00Z', json });
    await store.saveProject({ id: 'other', title: 'Other', savedAt: '2026-11-01T02:00:00Z', json: '{}' });
    expect((await store.listProjects()).map((x) => x.id)).toEqual(['other', p.id]);
    const loaded = await store.loadProject(p.id);
    const r = parseProjectFile(loaded!.json);
    expect(r.ok && r.project).toEqual(p);
    await store.deleteProject('other');
    expect((await store.listProjects()).map((x) => x.id)).toEqual([p.id]);

    expect(await store.loadAutosave()).toBeNull();
    await store.saveAutosave({ id: p.id, title: p.title, savedAt: 'now', json });
    expect((await store.loadAutosave())?.json).toBe(json);
    await store.clearAutosave();
    expect(await store.loadAutosave()).toBeNull();
    store.close();
  });

  it('reports a clear error when IndexedDB is unavailable', async () => {
    const store = new ProjectStore(null);
    await expect(store.listProjects()).rejects.toBeInstanceOf(StorageError);
    await expect(store.listProjects()).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
