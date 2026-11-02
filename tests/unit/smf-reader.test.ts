import { describe, expect, it } from 'vitest';
import { readSmf } from '../../src/core/smf/reader';
import { SMF_LIMITS } from '../../src/core/smf/types';
import { build, chunk, format0Song, format1Song, meta, off, on, smf, sysex, sysexF7, tempo, trackBytes, vlq, GS_RESET } from '../fixtures/songs';

const ok = (bytes: Uint8Array) => {
  const r = readSmf(bytes);
  if (!r.ok) throw new Error(r.errors[0].message);
  return r;
};

describe('SMF reader', () => {
  it('C01: reads Format 1 tracks and Format 0 with running status', () => {
    const f1 = ok(format1Song()).smf;
    expect(f1.format).toBe(1);
    expect(f1.tracks).toHaveLength(3);
    const f0 = ok(format0Song()).smf;
    expect(f0.format).toBe(0);
    const ch = f0.tracks[0].events.filter((e) => e.kind === 'channel');
    expect(ch.map((e) => e.kind === 'channel' && [e.status, ...e.data])).toEqual([
      [0xc0, 5],
      [0xc1, 33],
      [0x90, 60, 100],
      [0x90, 62, 90],
      [0x91, 40, 80],
      [0x80, 60, 0],
      [0x80, 62, 0],
      [0x91, 40, 0],
    ]);
  });

  it.each([96, 480, 960, 1920, 1000])('C02: keeps PPQ %i', (ppq) => {
    const r = ok(build(1, ppq, [on(0, 0, 60), off(ppq, 0, 60)]));
    expect(r.smf.ppq).toBe(ppq);
    expect(r.smf.tracks[0].events[1].tick).toBe(ppq);
  });

  it('C07: decodes multi-byte VLQ deltas and rejects broken VLQ', () => {
    const r = ok(build(0, 480, [on(0x0fffffff >> 8, 0, 60), off(0x3fff, 0, 60)]));
    expect(r.smf.tracks[0].events[0].tick).toBe(0x0fffffff >> 8);
    const broken = smf(0, 480, [chunk('MTrk', [0x81, 0x81, 0x81, 0x81, 0x00, 0x90, 60, 100])]);
    const b = readSmf(broken);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors[0].code).toBe('E_SMF_VLQ');
  });

  it('C07: running status without a previous status byte is an error', () => {
    const r = readSmf(smf(0, 480, [chunk('MTrk', [0x00, 60, 100])]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('E_SMF_RUNNING_STATUS');
  });

  it('C08: keeps F0 / F7 SysEx payloads and unknown metas byte for byte', () => {
    const r = ok(build(1, 480, [sysex(0, GS_RESET), sysexF7(10, [0x43, 0x10, 0x4c]), meta(5, 0x60, [9, 8, 7]), meta(0, 0x7f, [0, 0, 0x41])]));
    const ev = r.smf.tracks[0].events;
    expect(ev[0]).toMatchObject({ kind: 'sysex', status: 0xf0, tick: 0 });
    expect([...(ev[0] as { data: Uint8Array }).data]).toEqual(GS_RESET);
    expect(ev[1]).toMatchObject({ kind: 'sysex', status: 0xf7, tick: 10 });
    expect(ev[2]).toMatchObject({ kind: 'meta', metaType: 0x60, tick: 15 });
    expect([...(ev[3] as { data: Uint8Array }).data]).toEqual([0, 0, 0x41]);
  });

  it('C11: random garbage never throws or hangs', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff);
    for (let i = 0; i < 300; i++) {
      const len = 14 + (rnd() % 200);
      const bytes = new Uint8Array(len);
      for (let k = 0; k < len; k++) bytes[k] = rnd();
      // half of them get a valid header so the track parser is exercised
      if (i % 2 === 0) bytes.set([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b].slice(0, Math.min(18, len)));
      expect(() => readSmf(bytes)).not.toThrow();
    }
  });

  it('C11: corrupt chunk lengths and truncated files give structured errors', () => {
    const good = build(1, 480, [on(0, 0, 60), off(480, 0, 60)]);
    const truncated = good.slice(0, good.length - 6);
    const r = readSmf(truncated);
    expect(r.ok).toBe(false);
    const hugeLen = good.slice();
    hugeLen.set([0x7f, 0xff, 0xff, 0xff], 18);
    expect(readSmf(hugeLen).ok).toBe(true); // recovered: EOT is present and followed by end of file
    const r2 = readSmf(new Uint8Array(SMF_LIMITS.maxBytes + 1));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors[0].code).toBe('E_SMF_TOO_LARGE');
  });

  it('C11: oversized SysEx length is rejected without allocating', () => {
    const r = readSmf(smf(0, 480, [chunk('MTrk', [0x00, 0xf0, ...vlq(SMF_LIMITS.maxMetaOrSysExBytes + 1), 0x41])]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('E_SMF_SYSEX_TOO_LARGE');
  });

  it('C14: refuses Format 2 and SMPTE division with a reason', () => {
    const f2 = readSmf(smf(2, 480, [trackBytes([on(0, 0, 60)])]));
    expect(f2.ok).toBe(false);
    if (!f2.ok) {
      expect(f2.errors[0].code).toBe('E_SMF_FORMAT2');
      expect(f2.errors[0].message).toMatch(/Format 2/);
    }
    const smpte = readSmf(smf(1, 0xe728, [trackBytes([on(0, 0, 60)])]));
    expect(smpte.ok).toBe(false);
    if (!smpte.ok) expect(smpte.errors[0].code).toBe('E_SMF_SMPTE');
  });

  it('rejects a zero tempo and a non-SMF file', () => {
    expect(readSmf(build(0, 480, [tempo(0, 0)])).ok).toBe(false);
    expect(readSmf(new Uint8Array([1, 2, 3])).ok).toBe(false);
  });

  it('warns about unknown chunks and missing End of Track', () => {
    const bytes = smf(1, 480, [chunk('XFIH', [1, 2, 3]), trackBytes([on(0, 0, 60), off(10, 0, 60)], { addEot: false })], 1);
    const r = ok(bytes);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['W_SMF_UNKNOWN_CHUNK', 'W_SMF_NO_EOT']));
  });
});
