// Roland GS SysEx decode / encode (MIDI_GS_SPEC 5, REQ-MIDI-04/05).
// Only DT1 messages with a valid checksum to the addresses below get a meaning; everything else
// stays raw hex. The address list was checked against the GS handler of the installed
// spessasynth_core@4.4.3 (`rolandSystemExclusive`), which also tells whether the built-in engine
// processes the parameter (DECISIONS ADR-023). Not a claim of complete GS / SC-88Pro support.

export type GsCategory = 'system' | 'reverb' | 'chorus' | 'delay' | 'part';

export interface GsParamDef {
  /** 3 address bytes; for part parameters the middle byte is 0x10 (part number is added) */
  address: [number, number, number];
  name: string;
  category: GsCategory;
  /** value formatter for display */
  format?: (v: number) => string;
  min: number;
  max: number;
  /** processed by the built-in SpessaSynth engine (verified in source) */
  engine: boolean;
}

const signed64 = (v: number) => `${v - 64 >= 0 ? '+' : ''}${v - 64}`;
const pan = (v: number) => (v === 0 ? 'Random' : v === 64 ? 'Center' : v < 64 ? `L${64 - v}` : `R${v - 64}`);
const REVERB_MACROS = ['Room 1', 'Room 2', 'Room 3', 'Hall 1', 'Hall 2', 'Plate', 'Delay', 'Panning Delay'];
const CHORUS_MACROS = ['Chorus 1', 'Chorus 2', 'Chorus 3', 'Chorus 4', 'Feedback Chorus', 'Flanger', 'Short Delay', 'Short Delay (FB)'];
const RHYTHM = ['OFF', 'MAP1', 'MAP2'];

export const GS_PARAMS: GsParamDef[] = [
  { address: [0x40, 0x00, 0x7f], name: 'GS Reset', category: 'system', min: 0, max: 0, engine: true, format: () => '' },
  { address: [0x40, 0x00, 0x04], name: 'Master Volume', category: 'system', min: 0, max: 127, engine: true },
  { address: [0x40, 0x00, 0x05], name: 'Master Key-Shift', category: 'system', min: 0x28, max: 0x58, engine: true, format: signed64 },
  { address: [0x40, 0x00, 0x06], name: 'Master Pan', category: 'system', min: 1, max: 127, engine: true, format: pan },
  { address: [0x40, 0x01, 0x30], name: 'Reverb Macro', category: 'reverb', min: 0, max: 7, engine: true, format: (v) => REVERB_MACROS[v] ?? String(v) },
  { address: [0x40, 0x01, 0x31], name: 'Reverb Character', category: 'reverb', min: 0, max: 7, engine: true },
  { address: [0x40, 0x01, 0x32], name: 'Reverb Pre-LPF', category: 'reverb', min: 0, max: 7, engine: true },
  { address: [0x40, 0x01, 0x33], name: 'Reverb Level', category: 'reverb', min: 0, max: 127, engine: true },
  { address: [0x40, 0x01, 0x34], name: 'Reverb Time', category: 'reverb', min: 0, max: 127, engine: true },
  { address: [0x40, 0x01, 0x35], name: 'Reverb Delay Feedback', category: 'reverb', min: 0, max: 127, engine: true },
  { address: [0x40, 0x01, 0x38], name: 'Chorus Macro', category: 'chorus', min: 0, max: 7, engine: true, format: (v) => CHORUS_MACROS[v] ?? String(v) },
  { address: [0x40, 0x01, 0x39], name: 'Chorus Pre-LPF', category: 'chorus', min: 0, max: 7, engine: true },
  { address: [0x40, 0x01, 0x3a], name: 'Chorus Level', category: 'chorus', min: 0, max: 127, engine: true },
  { address: [0x40, 0x01, 0x3b], name: 'Chorus Feedback', category: 'chorus', min: 0, max: 127, engine: true },
  { address: [0x40, 0x01, 0x3c], name: 'Chorus Delay', category: 'chorus', min: 0, max: 127, engine: true },
  { address: [0x40, 0x01, 0x3d], name: 'Chorus Rate', category: 'chorus', min: 0, max: 127, engine: true },
  { address: [0x40, 0x01, 0x3e], name: 'Chorus Depth', category: 'chorus', min: 0, max: 127, engine: true },
  { address: [0x40, 0x01, 0x3f], name: 'Chorus Send Level To Reverb', category: 'chorus', min: 0, max: 127, engine: true },
  { address: [0x40, 0x10, 0x02], name: 'Rx. Channel', category: 'part', min: 0, max: 16, engine: true, format: (v) => (v === 16 ? 'OFF' : `Ch${v + 1}`) },
  { address: [0x40, 0x10, 0x15], name: 'Use for Rhythm Part', category: 'part', min: 0, max: 2, engine: true, format: (v) => RHYTHM[v] ?? String(v) },
  { address: [0x40, 0x10, 0x16], name: 'Pitch Key Shift', category: 'part', min: 0x28, max: 0x58, engine: true, format: signed64 },
  { address: [0x40, 0x10, 0x19], name: 'Part Level', category: 'part', min: 0, max: 127, engine: true },
  { address: [0x40, 0x10, 0x1c], name: 'Part Pan', category: 'part', min: 0, max: 127, engine: true, format: pan },
  { address: [0x40, 0x10, 0x21], name: 'Chorus Send Level', category: 'part', min: 0, max: 127, engine: true },
  { address: [0x40, 0x10, 0x22], name: 'Reverb Send Level', category: 'part', min: 0, max: 127, engine: true },
];

/** GS part number (low nibble of the 2nd address byte) -> MIDI channel 0..15: 0 = Ch10, 1..9 = Ch1..9, A..F = Ch11..16. */
export function gsPartToChannel(part: number): number {
  const p = part & 0x0f;
  return p === 0 ? 9 : p <= 9 ? p - 1 : p;
}
export function channelToGsPart(channel: number): number {
  return channel === 9 ? 0 : channel < 9 ? channel + 1 : channel;
}

export function rolandChecksum(bytes: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i];
  return (128 - (sum % 128)) % 128;
}

export interface GsDecoded {
  deviceId: number;
  address: [number, number, number];
  data: number[];
  checksumOk: boolean;
  /** recognised parameter, or null when the address is not in the table */
  param: GsParamDef | null;
  /** MIDI channel for part parameters */
  channel?: number;
  /** "Part Level Ch3 = 100" */
  text: string;
}

/**
 * Decodes the SMF payload of an F0 SysEx (bytes after F0, normally ending with F7).
 * Returns null when it is not a Roland GS DT1 message.
 */
export function decodeGs(payload: ArrayLike<number>): GsDecoded | null {
  const b = Array.from(payload);
  if (b[b.length - 1] === 0xf7) b.pop();
  // 41 dev 42 12 a1 a2 a3 data... sum
  if (b.length < 9 || b[0] !== 0x41 || b[2] !== 0x42 || b[3] !== 0x12) return null;
  const deviceId = b[1];
  const address: [number, number, number] = [b[4], b[5], b[6]];
  const data = b.slice(7, -1);
  const checksumOk = rolandChecksum(b.slice(4, -1)) === b[b.length - 1];
  const isPart = address[0] === 0x40 && (address[1] & 0xf0) === 0x10;
  const lookup: [number, number, number] = isPart ? [0x40, 0x10, address[2]] : address;
  const param = checksumOk && data.length === 1 ? (GS_PARAMS.find((p) => p.address[0] === lookup[0] && p.address[1] === lookup[1] && p.address[2] === lookup[2]) ?? null) : null;
  const channel = isPart ? gsPartToChannel(address[1]) : undefined;
  const hexAddr = address.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  let text: string;
  if (!checksumOk) text = `Roland DT1 ${hexAddr}（チェックサム不一致 — 解釈しません）`;
  else if (!param) text = `Roland GS DT1 ${hexAddr}（未対応のアドレス）`;
  else if (param.name === 'GS Reset') text = 'GS Reset';
  else text = `${param.name}${channel !== undefined ? ` Ch${channel + 1}` : ''} = ${param.format ? param.format(data[0]) : data[0]}`;
  return { deviceId, address, data, checksumOk, param, channel, text };
}

/** Builds the SMF payload (bytes after F0, including the checksum and F7) of a GS DT1 message. */
export function encodeGsDt1(address: [number, number, number], data: number[], deviceId = 0x10): number[] {
  const body = [...address, ...data];
  return [0x41, deviceId, 0x42, 0x12, ...body, rolandChecksum(body), 0xf7];
}

export function gsResetPayload(deviceId = 0x10): number[] {
  return encodeGsDt1([0x40, 0x00, 0x7f], [0x00], deviceId);
}

/** Address of a part parameter for a MIDI channel. */
export function partAddress(paramLow: number, channel: number): [number, number, number] {
  return [0x40, 0x10 | channelToGsPart(channel), paramLow];
}
