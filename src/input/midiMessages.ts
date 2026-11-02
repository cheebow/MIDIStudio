// Web MIDI message parsing (INPUT_RECORDING 4). Each Web MIDI message is complete (no running
// status across messages). Note On velocity 0 = Note Off. SysEx / clock / active sensing are ignored.

export type ParsedMidiInput =
  | { type: 'note-on'; channel: number; pitch: number; velocity: number }
  | { type: 'note-off'; channel: number; pitch: number; releaseVelocity: number }
  | { type: 'cc'; channel: number; controller: number; value: number }
  | { type: 'pitch-bend'; channel: number; value: number }
  | { type: 'channel-pressure'; channel: number; value: number }
  | { type: 'poly-pressure'; channel: number; pitch: number; value: number }
  | { type: 'program'; channel: number; program: number };

export function parseMidiMessage(data: ArrayLike<number>): ParsedMidiInput | null {
  if (data.length < 1) return null;
  const status = data[0];
  if (status < 0x80 || status >= 0xf0) return null;
  const channel = status & 0x0f;
  const a = data[1] ?? 0;
  const b = data[2] ?? 0;
  if ((a | b) & 0x80) return null;
  switch (status & 0xf0) {
    case 0x80:
      return data.length >= 3 ? { type: 'note-off', channel, pitch: a, releaseVelocity: b } : null;
    case 0x90:
      if (data.length < 3) return null;
      return b === 0 ? { type: 'note-off', channel, pitch: a, releaseVelocity: 0 } : { type: 'note-on', channel, pitch: a, velocity: b };
    case 0xa0:
      return data.length >= 3 ? { type: 'poly-pressure', channel, pitch: a, value: b } : null;
    case 0xb0:
      return data.length >= 3 ? { type: 'cc', channel, controller: a, value: b } : null;
    case 0xc0:
      return { type: 'program', channel, program: a };
    case 0xd0:
      return { type: 'channel-pressure', channel, value: a };
    case 0xe0:
      return data.length >= 3 ? { type: 'pitch-bend', channel, value: ((b << 7) | a) - 8192 } : null;
  }
  return null;
}
