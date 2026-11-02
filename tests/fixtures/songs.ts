// Self-made test songs (no third-party material: TEST_PLAN 1). Raw bytes are written by the
// independent builder in smf-build.ts so reader bugs cannot hide behind writer bugs.
import { bend, build, cc, chunk, eot, meta, off, on, program, smf, tempo, text, trackBytes, vlq, type Ev } from './smf-build';

export const sysex = (d: number, data: number[]): Ev => [d, 0xf0, ...vlq(data.length), ...data];
export const sysexF7 = (d: number, data: number[]): Ev => [d, 0xf7, ...vlq(data.length), ...data];
export const timeSig = (d: number, num: number, denPow: number): Ev => meta(d, 0x58, [num, denPow, 24, 8]);
export const port = (d: number, p: number): Ev => meta(d, 0x21, [p]);

/** Roland GS Reset: F0 41 10 42 12 40 00 7F 00 41 F7 (stored in SMF without the leading F0). */
export const GS_RESET = [0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7];
/** GS "Use for Rhythm Part" on part 11 (block 1A): F0 41 10 42 12 40 1A 15 02 0F F7 */
export const GS_RHYTHM_PART_11 = [0x41, 0x10, 0x42, 0x12, 0x40, 0x1a, 0x15, 0x02, 0x0f, 0xf7];

/** Format 1: conductor + piano + drums, with tempo/time changes, GS SysEx, unknown meta. */
export function format1Song(ppq = 480): Uint8Array {
  const q = ppq;
  return build(
    1,
    ppq,
    [text(0, 0x03, 'Test Song'), text(0, 0x02, '(c) MIDI Studio tests'), tempo(0, 500000), timeSig(0, 4, 2), tempo(q * 4, 400000), timeSig(0, 3, 2), meta(q * 3, 0x06, [0x42])],
    [
      text(0, 0x03, 'Piano'),
      sysex(0, GS_RESET),
      cc(0, 0, 0, 0),
      cc(0, 0, 32, 0),
      program(0, 0, 0),
      cc(0, 0, 7, 100),
      on(0, 0, 60),
      on(0, 0, 64),
      on(0, 0, 67),
      off(q, 0, 60),
      off(0, 0, 64),
      off(0, 0, 67),
      bend(0, 0, -8192),
      bend(q, 0, 8191),
      bend(q, 0, 0),
      meta(0, 0x7f, [0x00, 0x00, 0x41, 0x01]), // sequencer specific (kept raw)
      meta(0, 0x60, [1, 2, 3]), // unknown meta type
    ],
    [text(0, 0x03, 'Drums'), on(0, 9, 36, 110), off(q / 2, 9, 36), on(0, 9, 38, 100), off(q / 2, 9, 38), on(0, 9, 42), off(q, 9, 42, 0)],
  );
}

/** Format 0 with several channels and running status. */
export function format0Song(ppq = 96): Uint8Array {
  const events: Ev[] = [
    text(0, 0x03, 'F0 Song'),
    tempo(0, 600000),
    sysex(0, GS_RESET),
    program(0, 0, 5),
    program(0, 1, 33),
    [0, 0x90, 60, 100],
    [0, 62, 90], // running status (Note On ch0)
    [0, 0x91, 40, 80],
    [ppq, 0x80, 60, 0],
    [0, 62, 0], // running status (Note Off ch0)
    [0, 0x91, 40, 0], // Note On vel 0 = Note Off
    eot(ppq),
  ];
  return smf(0, ppq, [trackBytes(events, { addEot: false })]);
}

export { bend, build, cc, chunk, eot, meta, off, on, program, smf, tempo, text, trackBytes, vlq };
export type { Ev };
