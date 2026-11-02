// SMF writer (Format 0/1 container; MIDI Studio exports Format 1: MIDI_GS_SPEC 3).
// Events must already be in their final order with non-decreasing ticks. Running status is not
// used (byte identity with the source file is not a goal: ADR-008).
import { encodeVlq } from './vlq';
import type { SmfFile, SmfTrack } from './types';

class ByteSink {
  private buf = new Uint8Array(1024);
  length = 0;
  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(b: number) {
    this.ensure(1);
    this.buf[this.length++] = b;
  }
  bytes(bs: ArrayLike<number>) {
    this.ensure(bs.length);
    for (let i = 0; i < bs.length; i++) this.buf[this.length++] = bs[i];
  }
  u32At(offset: number, v: number) {
    this.buf[offset] = (v >>> 24) & 0xff;
    this.buf[offset + 1] = (v >>> 16) & 0xff;
    this.buf[offset + 2] = (v >>> 8) & 0xff;
    this.buf[offset + 3] = v & 0xff;
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function writeTrack(out: ByteSink, track: SmfTrack, index: number) {
  out.bytes([0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 0]);
  const lengthAt = out.length - 4;
  const start = out.length;
  let last = 0;
  for (const e of track.events) {
    if (!Number.isSafeInteger(e.tick) || e.tick < last) {
      throw new Error(`writeSmf: track ${index} events are not in tick order (tick ${e.tick} after ${last})`);
    }
    out.bytes(encodeVlq(e.tick - last));
    last = e.tick;
    if (e.kind === 'channel') {
      out.byte(e.status);
      out.bytes(e.data);
    } else if (e.kind === 'meta') {
      out.bytes([0xff, e.metaType]);
      out.bytes(encodeVlq(e.data.length));
      out.bytes(e.data);
    } else {
      out.byte(e.status);
      out.bytes(encodeVlq(e.data.length));
      out.bytes(e.data);
    }
  }
  const eot = Math.max(last, track.endOfTrackTick);
  out.bytes(encodeVlq(eot - last));
  out.bytes([0xff, 0x2f, 0x00]);
  out.u32At(lengthAt, out.length - start);
}

export function writeSmf(file: SmfFile): Uint8Array {
  if (!Number.isInteger(file.ppq) || file.ppq <= 0 || file.ppq > 0x7fff) throw new RangeError(`writeSmf: invalid PPQ ${file.ppq}`);
  if (file.format === 0 && file.tracks.length !== 1) throw new Error('writeSmf: Format 0 needs exactly one track');
  const out = new ByteSink();
  const n = file.tracks.length;
  out.bytes([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, file.format, (n >> 8) & 0xff, n & 0xff, (file.ppq >> 8) & 0xff, file.ppq & 0xff]);
  file.tracks.forEach((t, i) => writeTrack(out, t, i));
  return out.result();
}
