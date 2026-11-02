// Low-level, lossless SMF representation (one level above raw bytes). The reader produces it and
// the writer consumes it; conversion to/from MidiProject lives in src/core/project-io.

export type SmfEvent =
  /** Channel voice message. `status` includes the channel nibble; `data` has 1 or 2 bytes. */
  | { kind: 'channel'; tick: number; status: number; data: number[] }
  /** Meta event (FF type len data), except End of Track which is stored as SmfTrack.endOfTrackTick. */
  | { kind: 'meta'; tick: number; metaType: number; data: Uint8Array }
  /** SysEx event. For F0 the data excludes the F0 byte, exactly as stored in the SMF. */
  | { kind: 'sysex'; tick: number; status: 0xf0 | 0xf7; data: Uint8Array };

export interface SmfTrack {
  events: SmfEvent[];
  /** Tick of the End of Track event (or of the last event when EOT was missing). */
  endOfTrackTick: number;
}

export interface SmfFile {
  format: 0 | 1;
  /** Ticks per quarter note, as in the source file (never re-quantized: ADR-002). */
  ppq: number;
  tracks: SmfTrack[];
}

export type IssueSeverity = 'error' | 'warning' | 'info';

/** A reader / importer diagnostic. Byte offsets refer to the original file. */
export interface ImportIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  /** 0-based MTrk index */
  track?: number;
  byteOffset?: number;
  tick?: number;
}

export type SmfReadResult = { ok: true; smf: SmfFile; warnings: ImportIssue[]; byteLength: number } | { ok: false; errors: ImportIssue[] };

/**
 * Defensive limits (ARCHITECTURE I). Generous enough for the 32 track / 100,000 event benchmark;
 * exceeding them is reported with the reason instead of hanging.
 */
export const SMF_LIMITS = {
  maxBytes: 32 * 1024 * 1024,
  maxEvents: 1_000_000,
  maxTracks: 1024,
  maxMetaOrSysExBytes: 1024 * 1024,
  /** absolute tick upper bound (safe integer arithmetic with headroom) */
  /** absolute tick bound = the VLQ bound, so every delta time of a valid song can be written */
  maxTick: 0x0fffffff,
};
