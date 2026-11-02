import { describe, expect, it } from 'vitest';
import { decodeVlq, encodeVlq, VLQ_MAX } from '../../src/core/smf/vlq';

describe('VLQ', () => {
  it.each([
    [0, [0x00]],
    [0x40, [0x40]],
    [0x7f, [0x7f]],
    [0x80, [0x81, 0x00]],
    [0x2000, [0xc0, 0x00]],
    [0x3fff, [0xff, 0x7f]],
    [0x4000, [0x81, 0x80, 0x00]],
    [0x1fffff, [0xff, 0xff, 0x7f]],
    [0x200000, [0x81, 0x80, 0x80, 0x00]],
    [VLQ_MAX, [0xff, 0xff, 0xff, 0x7f]],
  ])('encodes and decodes %i (SMF spec examples)', (value, bytes) => {
    expect(encodeVlq(value)).toEqual(bytes);
    expect(decodeVlq(new Uint8Array(bytes), 0)).toEqual({ ok: true, value, length: bytes.length });
  });

  it('rejects out-of-range values', () => {
    expect(() => encodeVlq(-1)).toThrow(RangeError);
    expect(() => encodeVlq(VLQ_MAX + 1)).toThrow(RangeError);
    expect(() => encodeVlq(1.5)).toThrow(RangeError);
  });

  it('reports truncated and over-long input instead of reading past the end', () => {
    expect(decodeVlq(new Uint8Array([0x81]), 0)).toEqual({ ok: false, reason: 'truncated' });
    expect(decodeVlq(new Uint8Array([0x81, 0x00]), 0, 1)).toEqual({ ok: false, reason: 'truncated' });
    expect(decodeVlq(new Uint8Array([0x81, 0x81, 0x81, 0x81, 0x00]), 0)).toEqual({ ok: false, reason: 'too-long' });
  });
});
