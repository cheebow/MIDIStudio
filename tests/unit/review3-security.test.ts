// ADR-087: hardening found in the third review (security pass).
import { describe, expect, it } from 'vitest';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { parseProjectFile, serializeProject } from '../../src/core/project-io/projectFile';
import { createEmptyProject } from '../../src/core/model/defaults';
import { build, off, on } from '../fixtures/songs';

/** Format 0: `n` Note Ons stacked on one pitch, then `n` Note Offs (running status, 3-4 bytes each) */
function stackedNotes(n: number): Uint8Array {
  const body: number[] = [0x00, 0x90, 60, 100];
  for (let i = 1; i < n; i++) body.push(0x00, 60, 100);
  body.push(0x01, 0x80, 60, 0);
  for (let i = 1; i < n; i++) body.push(0x00, 60, 0);
  body.push(0x00, 0xff, 0x2f, 0x00);
  const len = body.length;
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const trk = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff];
  return new Uint8Array([...head, ...trk, ...body]);
}

describe('third review: hostile input (ADR-087)', () => {
  it('many stacked Note Ons on one pitch import in linear time (no tab freeze)', () => {
    const n = 200_000; // a 1.2 MB file: took ~16 s with Array.shift()
    const t0 = performance.now();
    const o = openMidiFile(stackedNotes(n));
    const ms = performance.now() - t0;
    if (!o.ok) throw new Error('should open');
    const notes = o.project.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'note');
    expect(notes).toHaveLength(n);
    expect(ms).toBeLessThan(5000);
  });

  it('track and clip colours from a project file must be #rrggbb (no url() reaching inline CSS)', () => {
    const o = openMidiFile(build(1, 480, [], [on(0, 0, 60), off(480, 0, 60)]));
    if (!o.ok) throw new Error();
    const bad = 'url(https://tracker.example/pixel)';
    const p = { ...o.project, tracks: o.project.tracks.map((t) => ({ ...t, color: bad })), clips: o.project.clips.map((c) => ({ ...c, color: bad })) };
    const r = parseProjectFile(serializeProject(p));
    if (!r.ok) throw new Error(r.errors.join());
    for (const c of [...r.project.tracks.map((t) => t.color), ...r.project.clips.map((c) => c.color)]) if (c !== undefined) expect(c).toMatch(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
  });

  it('malformed input presets, drum maps and metadata in a project file do not reach the app', () => {
    const p = createEmptyProject();
    const json = JSON.parse(serializeProject(p)) as { project: Record<string, unknown> };
    json.project.inputPresets = { defaultVelocity: 'x', pianoOctaveShift: 1e300 };
    json.project.drumMaps = 'notarray';
    json.project.metadata = { a: 5 };
    const r = parseProjectFile(JSON.stringify(json));
    if (!r.ok) throw new Error(r.errors.join()); // the file still opens, with defaults for the bad values
    const d = createEmptyProject().inputPresets;
    expect(r.project.inputPresets.defaultVelocity).toBe(d.defaultVelocity);
    expect(r.project.inputPresets.pianoOctaveShift).toBe(d.pianoOctaveShift);
    expect(Array.isArray(r.project.drumMaps)).toBe(true);
    expect(Object.values(r.project.metadata ?? {}).every((v) => typeof v === 'string')).toBe(true);
  });
});
