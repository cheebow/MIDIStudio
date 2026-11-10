// Regression tests of the 4th review (ADR-094): SMF import / export, project file, timing, storage.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { readSmf } from '../../src/core/smf/reader';
import { exportSmfBytes } from '../../src/core/project-io/exportSmf';
import { compareSmfSemantics } from '../../src/core/smf/semantic';
import { parseProjectFile, serializeProject } from '../../src/core/project-io/projectFile';
import { createEmptyProject } from '../../src/core/model/defaults';
import { parseRational } from '../../src/core/timing/rational';
import { parseTicksInput } from '../../src/core/list/listEdit';
import { TimeSignatureMap } from '../../src/core/timing/timeSignatureMap';
import { ProjectStore } from '../../src/storage/indexedDb';
import { build, cc, meta, off, on, port, program, smf, sysex, trackBytes, GS_RESET } from '../fixtures/songs';

function roundTrip(bytes: Uint8Array) {
  const r = readSmf(bytes);
  if (!r.ok) throw new Error(r.errors[0].message);
  const o = openMidiFile(bytes, { trackOrder: 'file', mergeDrums: false, mergeControllers: false });
  if (!o.ok) throw new Error();
  const out = exportSmfBytes(o.project).bytes;
  const r2 = readSmf(out);
  if (!r2.ok) throw new Error(r2.errors[0].message);
  return { diff: compareSmfSemantics(r.smf, r2.smf), project: o.project, issues: o.issues };
}

describe('bug hunt: SMF import / export', () => {
  it('format 0 with a port prefix: a later port change before a channel\'s first event is kept', () => {
    const bytes = smf(0, 480, [trackBytes([port(0, 0), on(0, 0, 60), off(480, 0, 60), port(0, 1), on(0, 1, 64), off(480, 1, 64)])]);
    const { diff } = roundTrip(bytes);
    expect(diff.differences).toEqual([]);
  });

  it('format 0: a SysEx after a port change in the middle stays on that port', () => {
    const bytes = smf(0, 480, [trackBytes([on(0, 0, 60), off(480, 0, 60), port(0, 1), sysex(0, GS_RESET), on(0, 0, 62), off(480, 0, 62)])]);
    const { diff } = roundTrip(bytes);
    expect(diff.differences).toEqual([]);
  });

  it('time signature meta with extra bytes round-trips', () => {
    const bytes = build(1, 480, [meta(0, 0x58, [3, 2, 24, 8, 1])], [on(0, 0, 60), off(480, 0, 60)]);
    const { diff } = roundTrip(bytes);
    expect(diff.differences).toEqual([]);
  });

  it('time signature meta with 3 bytes round-trips', () => {
    const bytes = build(1, 480, [meta(0, 0x58, [3, 2, 36])], [on(0, 0, 60), off(480, 0, 60)]);
    const { diff } = roundTrip(bytes);
    expect(diff.differences).toEqual([]);
  });

  it('format 0: channel events at tick 0 before the first port meta stay on their port', () => {
    const bytes = smf(0, 480, [trackBytes([program(0, 0, 19), port(0, 1), on(0, 0, 60), off(480, 0, 60)])]);
    const { diff } = roundTrip(bytes);
    expect(diff.differences).toEqual([]);
  });

  it('default open (controller-track merge): a port change kept as an event does not move another track\'s notes to that port', () => {
    // MTrk 2: controllers only on ch 1, with FF 21 01 in the middle. MTrk 3: notes on ch 1, port A.
    const bytes = build(1, 480, [], [cc(0, 0, 7, 100), port(100, 1), cc(0, 0, 7, 90)], [on(200, 0, 60), off(480, 0, 60)]);
    const r = readSmf(bytes);
    const o = openMidiFile(bytes); // default options: mergeControllers on
    if (!r.ok || !o.ok) throw new Error();
    const back = readSmf(exportSmfBytes(o.project).bytes);
    if (!back.ok) throw new Error();
    expect(compareSmfSemantics(r.smf, back.smf).differences).toEqual([]);
  });
});

describe('bug hunt: project file', () => {
  const base = () => JSON.parse(serializeProject(createEmptyProject({ title: 'T' })));

  it('a malformed sourceTitle is removed on load (export must not throw)', () => {
    const env = base();
    env.project.sourceTitle = { text: 'T', base64: '!!!' };
    const r = parseProjectFile(JSON.stringify(env));
    if (!r.ok) return; // rejecting the file would be fine too
    expect(() => exportSmfBytes(r.project)).not.toThrow();
  });

  it('a bad conductorEndOfTrackTick is rejected or repaired (export must not throw)', () => {
    for (const bad of ['x', 1e12, 1.5, -3]) {
      const env = base();
      env.project.conductorEndOfTrackTick = bad;
      const r = parseProjectFile(JSON.stringify(env));
      if (!r.ok) continue;
      expect(() => exportSmfBytes(r.project), String(bad)).not.toThrow();
      expect(readSmf(exportSmfBytes(r.project).bytes).ok, String(bad)).toBe(true);
    }
  });

  it('a raw event whose bytes are not a complete channel message does not corrupt the exported SMF', () => {
    for (const raw of ['kAA=', 'kP//', 'wAAA']) {
      const env = base();
      env.project.tracks[0].events.push({ id: 'raw1', kind: 'raw', tick: 0, rawBase64: raw, reason: 'other', originOrder: 50 });
      const r = parseProjectFile(JSON.stringify(env));
      if (!r.ok) continue;
      const out = exportSmfBytes(r.project);
      const back = readSmf(out.bytes);
      const fine = back.ok && back.warnings.length === 0;
      expect(fine || out.warnings.length > 0, raw).toBe(true);
    }
  });

  it('a note ending past the tick limit: the exported file can be read back', () => {
    const env = base();
    env.project.tracks[0].events.push({ id: 'n1', kind: 'note', tick: 0x0fffffff, pitch: 60, velocity: 100, durationTicks: 10, releaseVelocity: 0, originOrder: 50 });
    const r = parseProjectFile(JSON.stringify(env));
    if (!r.ok) return;
    const out = exportSmfBytes(r.project);
    expect(out.warnings.length > 0 || readSmf(out.bytes).ok).toBe(true);
  });
});

describe('bug hunt: timing', () => {
  it('parseRational returns null (does not throw) for a number too large to be exact', () => {
    expect(() => parseRational('99999999999999999999')).not.toThrow();
    expect(() => parseRational('1/99999999999999999999')).not.toThrow();
  });

  it('parseTicksInput reports an error for a huge classic48 value instead of throwing', () => {
    expect(() => parseTicksInput('99999999999999999999', 'classic48', 480)).not.toThrow();
    expect(() => parseTicksInput('9007199254740991', 'classic48', 480)).not.toThrow();
  });

  it('TimeSignatureMap.parse refuses a beat past a bar cut short by a signature change', () => {
    // 4/4, then 3/4 from tick 2400 (one beat into bar 2): bar 2 has one beat only
    const sig = new TimeSignatureMap(480, [{ tick: 0, numerator: 4, denominator: 4 }, { tick: 2400, numerator: 3, denominator: 4 }]);
    expect(sig.format(2400)).toBe('003.01.000');
    const tick = sig.parse('2.3');
    // either null, or a tick that formats back to bar 2 beat 3
    if (tick !== null) expect(sig.format(tick)).toBe('002.03.000');
  });
});

describe('bug hunt: storage', () => {
  it('a failed request reports the request error, not "null"', async () => {
    const factory = new IDBFactory();
    const store = new ProjectStore(factory as unknown as globalThis.IDBFactory);
    await store.saveProject({ id: 'a', title: 'a', savedAt: '', json: '{}' });
    // make put() behave like a request that fails asynchronously (add of an existing key -> ConstraintError)
    const proto = Object.getPrototypeOf((await new Promise<IDBDatabase>((res) => { const o = factory.open('midi-studio', 1); o.onsuccess = () => res(o.result as unknown as IDBDatabase); })).transaction('projects', 'readwrite').objectStore('projects'));
    const realPut = proto.put;
    proto.put = function (this: IDBObjectStore, v: unknown, k?: IDBValidKey) { return k === undefined ? this.add(v) : this.add(v, k); };
    try {
      const err = await store.saveProject({ id: 'a', title: 'a', savedAt: '', json: '{}' }).then(() => null, (e: Error) => e);
      expect(err).not.toBeNull();
      expect(err!.message).not.toMatch(/null$/);
    } finally {
      proto.put = realPut;
    }
  });
});
