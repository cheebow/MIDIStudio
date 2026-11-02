// MIDI port numbers are data; "A", "B", ... are labels (ARCHITECTURE C). Port 0 = "A".
import type { PortId } from './types';

export const MAX_PORTS = 128; // SMF FF 21 carries 0..127

export function portLabel(index: number): PortId {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PORTS) throw new RangeError(`port index ${index}`);
  // A..Z, then AA, AB ... (only the first four are shown prominently in the UI)
  return index < 26 ? String.fromCharCode(65 + index) : String.fromCharCode(65 + Math.floor(index / 26) - 1) + String.fromCharCode(65 + (index % 26));
}

export function portIndex(label: PortId): number {
  if (/^[A-Z]$/.test(label)) return label.charCodeAt(0) - 65;
  if (/^[A-Z]{2}$/.test(label)) return (label.charCodeAt(0) - 64) * 26 + (label.charCodeAt(1) - 65);
  throw new RangeError(`invalid port label "${label}"`);
}

export function isValidPort(label: unknown): label is PortId {
  if (typeof label !== 'string') return false;
  try {
    return portIndex(label) < MAX_PORTS;
  } catch {
    return false;
  }
}
