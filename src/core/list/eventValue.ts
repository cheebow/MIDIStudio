// The VEL column of a list row as a number: which events have one, its range and its current value
// (shared by the +/- increments and the batch dialog so the per-kind rules live in one place).
import type { MidiEvent } from '../model/types';
import { base64ToBytes } from '../model/base64';
import { decodeGs } from '../gs/gsSysex';

/** [min, max] of the VEL cell, or null when the event has no editable value (GS SysEx: the parameter's range). */
export function eventValueRange(e: MidiEvent): [number, number] | null {
  switch (e.kind) {
    case 'note':
      return [1, 127];
    case 'cc':
    case 'channel-pressure':
    case 'poly-pressure':
      return [0, 127];
    case 'program':
      return [1, 128]; // shown 1-based
    case 'pitch-bend':
      return [-8192, 8191];
    case 'sysex': {
      const d = decodeGs(base64ToBytes(e.dataBase64) ?? []);
      return d?.param && d.param.max > d.param.min ? [d.param.min, d.param.max] : null;
    }
    default:
      return null;
  }
}

/** The VEL cell's number (program 1-based), or null. */
export function eventValue(e: MidiEvent): number | null {
  switch (e.kind) {
    case 'note':
      return e.velocity;
    case 'cc':
    case 'pitch-bend':
      return e.value;
    case 'program':
      return e.program + 1;
    case 'channel-pressure':
    case 'poly-pressure':
      return e.pressure;
    case 'sysex':
      return eventValueRange(e) ? (decodeGs(base64ToBytes(e.dataBase64) ?? [])?.data[0] ?? null) : null;
    default:
      return null;
  }
}
