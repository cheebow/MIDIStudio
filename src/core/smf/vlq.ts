// Variable-length quantity (SMF delta time / meta length). Pure functions, no DOM.

/** Largest value representable in 4 VLQ bytes (SMF limit). */
export const VLQ_MAX = 0x0fffffff;

export function encodeVlq(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > VLQ_MAX) {
    throw new RangeError(`VLQ value out of range: ${value}`);
  }
  const out = [value & 0x7f];
  let v = value >>> 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return out;
}

export type VlqResult = { ok: true; value: number; length: number } | { ok: false; reason: 'truncated' | 'too-long' };

/** Decodes a VLQ at `offset`, reading no further than `end`. At most 4 bytes (SMF spec). */
export function decodeVlq(bytes: Uint8Array, offset: number, end: number = bytes.length): VlqResult {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    const p = offset + i;
    if (p >= end) return { ok: false, reason: 'truncated' };
    const b = bytes[p];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) return { ok: true, value: value >>> 0, length: i + 1 };
  }
  return { ok: false, reason: 'too-long' };
}
