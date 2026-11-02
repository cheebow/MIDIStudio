// RCM-style event list rows (REQ-EDT-09..12, UI_DESIGN 6). Pure functions over the shared project.
// ST = delta to the next event of the same track in time order, counting ALL events (also those
// hidden by a filter). GT = Note On -> Note Off ticks. Nothing here rounds: display units are exact.
import { base64ToBytes } from '../model/base64';
import type { MidiEvent, MidiProject, MidiTrack } from '../model/types';
import { compareEvents } from '../events/order';
import { TimeSignatureMap } from '../timing/timeSignatureMap';
import { formatClassic48 } from '../timing/classic48';
import { CC_NAMES } from '../gm/ccNames';
import { GM_PROGRAMS } from '../gm/instruments';
import { drumName, findDrumMap } from '../gm/drumMaps';
import { decodeGs } from '../gs/gsSysex';

export type ListUnit = 'native' | 'classic48';
export type RowCategory = 'note' | 'cc' | 'program' | 'pitch-bend' | 'pressure' | 'sysex' | 'meta' | 'raw';

export interface ListRow {
  id: string;
  event: MidiEvent;
  category: RowCategory;
  /** index in the full (unfiltered) time-ordered list */
  index: number;
  tick: number;
  /** 1-based bar */
  meas: number;
  /** 1-based order of the row within its bar (among rows of the same view) */
  step: number;
  /** "C4", "CC7", "PC49", "PB", "SysEx" ... */
  name: string;
  /** note number for notes / poly pressure */
  key: number | null;
  /** delta to the next event in ticks; null for the last event */
  stTicks: number | null;
  /** note length in ticks */
  gtTicks: number | null;
  /** velocity for notes, value for CC / pressure / program (UI 1..128) / pitch bend */
  value: number | null;
  detail: string;
}

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/**
 * Absolute note name ("C4", "F#4"). Black keys are named with sharps, or with flats ("Bb4") under a
 * flat key signature (sharpsFlats < 0). The name is never shortened by the key signature: a list
 * row must name the sounding pitch by itself.
 */
export const noteName = (p: number, sharpsFlats = 0) => `${(sharpsFlats < 0 ? NOTE_FLAT : NOTE)[p % 12]}${Math.floor(p / 12) - 1}`;

/** Key signature (sharps > 0 / flats < 0) in effect at a tick, from the conductor; 0 when none. */
export function keySignatureLookup(project: MidiProject): (tick: number) => number {
  const keys = project.conductor
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.kind === 'key-signature')
    .sort((a, b) => a.c.tick - b.c.tick || a.i - b.i)
    .map((x) => x.c as Extract<typeof x.c, { kind: 'key-signature' }>);
  if (keys.length === 0) return () => 0;
  return (tick) => {
    let sf = 0;
    for (const k of keys) {
      if (k.tick > tick) break;
      sf = k.sharpsFlats;
    }
    return sf;
  };
}

const META_NAMES: Record<number, string> = { 0x01: 'Text', 0x02: 'Copyright', 0x03: 'Track Name', 0x04: 'Instrument', 0x05: 'Lyric', 0x06: 'Marker', 0x07: 'Cue', 0x20: 'Channel Prefix', 0x21: 'Port', 0x54: 'SMPTE Offset', 0x7f: 'Sequencer Specific' };

function hex(bytes: Uint8Array | null, max = 12): string {
  if (!bytes) return '';
  const s = Array.from(bytes.subarray(0, max), (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  return bytes.length > max ? `${s} …(${bytes.length} bytes)` : s;
}

export function categoryOf(e: MidiEvent): RowCategory {
  switch (e.kind) {
    case 'note':
      return 'note';
    case 'cc':
      return 'cc';
    case 'program':
      return 'program';
    case 'pitch-bend':
      return 'pitch-bend';
    case 'channel-pressure':
    case 'poly-pressure':
      return 'pressure';
    case 'sysex':
      return 'sysex';
    case 'meta':
      return 'meta';
    case 'raw':
      return 'raw';
  }
}

function describe(e: MidiEvent, track: MidiTrack, drumLabel?: (pitch: number) => string, sharpsFlats = 0): Pick<ListRow, 'name' | 'key' | 'gtTicks' | 'value' | 'detail'> {
  const ch = 'channelOverride' in e && e.channelOverride !== undefined && e.channelOverride !== track.channel ? ` (ch${e.channelOverride + 1})` : '';
  switch (e.kind) {
    case 'note':
      return { name: noteName(e.pitch, sharpsFlats), key: e.pitch, gtTicks: e.durationTicks, value: e.velocity, detail: `${drumLabel ? drumLabel(e.pitch) : 'Note'}${ch}` };
    case 'cc':
      return { name: `CC${e.controller}`, key: null, gtTicks: null, value: e.value, detail: `${CC_NAMES[e.controller] ?? 'Control Change'}${ch}` };
    case 'program':
      return { name: `PC${e.program + 1}`, key: null, gtTicks: null, value: e.program + 1, detail: `${GM_PROGRAMS[e.program] ?? ''}${ch}` };
    case 'pitch-bend':
      return { name: 'PB', key: null, gtTicks: null, value: e.value, detail: `Pitch Bend${ch}` };
    case 'channel-pressure':
      return { name: 'CP', key: null, gtTicks: null, value: e.pressure, detail: `Channel Pressure${ch}` };
    case 'poly-pressure':
      return { name: `PP ${noteName(e.pitch, sharpsFlats)}`, key: e.pitch, gtTicks: null, value: e.pressure, detail: `Poly Pressure${ch}` };
    case 'sysex': {
      const b = base64ToBytes(e.dataBase64);
      const gs = e.status === 'F0' && b ? decodeGs(b) : null;
      if (gs?.param) {
        const engine = gs.param.engine ? '' : '（内蔵音源は未対応）';
        return { name: gs.param.name === 'GS Reset' ? 'GS Reset' : 'GS', key: null, gtTicks: null, value: gs.param.max > gs.param.min ? gs.data[0] : null, detail: `${gs.text}${engine}` };
      }
      if (gs) return { name: 'SysEx', key: null, gtTicks: null, value: null, detail: `${gs.text}: ${hex(b)}` };
      return { name: 'SysEx', key: null, gtTicks: null, value: null, detail: `SysEx (unknown) ${e.status} ${hex(b)}` };
    }
    case 'meta': {
      const b = base64ToBytes(e.dataBase64);
      return { name: 'Meta', key: null, gtTicks: null, value: null, detail: `${META_NAMES[e.metaType] ?? `FF ${e.metaType.toString(16).toUpperCase().padStart(2, '0')}`} ${hex(b)}` };
    }
    case 'raw': {
      const b = base64ToBytes(e.rawBase64);
      return { name: 'Raw', key: null, gtTicks: null, value: null, detail: `${e.reason}: ${hex(b)}` };
    }
  }
}

export function sortedTrackEvents(track: MidiTrack): MidiEvent[] {
  return [...track.events].sort(compareEvents);
}

/** All rows of a track (time order). `visible` filters the view; ST still counts hidden events. */
export function listRows(project: MidiProject, track: MidiTrack, visible?: ReadonlySet<RowCategory>, sig?: TimeSignatureMap): ListRow[] {
  const map = sig ?? new TimeSignatureMap(project.ppq, project.conductor.filter((c) => c.kind === 'time-signature'));
  const events = sortedTrackEvents(track);
  const dmap = track.displayMode === 'drum' ? findDrumMap(track.drumMapId, project.drumMaps) : null;
  const drumLabel = dmap ? (p: number) => drumName(dmap, p) : undefined;
  // drum notes are instruments, not pitches: keep the plain (sharp) names there
  const keyAt = dmap ? () => 0 : keySignatureLookup(project);
  const rows: ListRow[] = [];
  const param = new Map<number, { kind: 'RPN' | 'NRPN'; msb: number; lsb: number }>();
  let lastBar = -1;
  let step = 0;
  events.forEach((e, index) => {
    const category = categoryOf(e);
    if (visible && !visible.has(category)) return;
    const meas = map.tickToBarBeat(e.tick).bar;
    if (meas !== lastBar) {
      lastBar = meas;
      step = 0;
    }
    step++;
    const next = events[index + 1];
    const d = describe(e, track, drumLabel, keyAt(e.tick));
    if (e.kind === 'cc') {
      const ch = e.channelOverride ?? track.channel;
      const cur = param.get(ch);
      if (e.controller === 101 || e.controller === 100) {
        const p = cur?.kind === 'RPN' ? cur : { kind: 'RPN' as const, msb: 127, lsb: 127 };
        param.set(ch, { ...p, kind: 'RPN', [e.controller === 101 ? 'msb' : 'lsb']: e.value });
      } else if (e.controller === 99 || e.controller === 98) {
        const p = cur?.kind === 'NRPN' ? cur : { kind: 'NRPN' as const, msb: 127, lsb: 127 };
        param.set(ch, { ...p, kind: 'NRPN', [e.controller === 99 ? 'msb' : 'lsb']: e.value });
      } else if ((e.controller === 6 || e.controller === 38) && cur && !(cur.msb === 127 && cur.lsb === 127)) {
        d.detail = `${d.detail} → ${parameterName(cur.kind, cur.msb, cur.lsb)}`;
      }
    }
    rows.push({ id: e.id, event: e, category, index, tick: e.tick, meas, step, stTicks: next ? next.tick - e.tick : null, ...d });
  });
  return rows;
}

export function formatTicks(ticks: number | null, unit: ListUnit, ppq: number): string {
  if (ticks === null) return '--';
  return unit === 'classic48' ? formatClassic48(ticks, ppq) : String(ticks);
}

/** Number of hidden events between two visible rows (for "… n events hidden" markers). */
export function hiddenBetween(a: ListRow, b: ListRow): number {
  return b.index - a.index - 1;
}

const RPN_NAMES: Record<string, string> = { '0:0': 'Pitch Bend Sensitivity', '0:1': 'Fine Tuning', '0:2': 'Coarse Tuning', '0:5': 'Modulation Depth Range' };
/** GS / XG NRPN names (common; whether the sound engine reacts depends on it). */
const NRPN_NAMES: Record<string, string> = { '1:8': 'Vibrato Rate', '1:9': 'Vibrato Depth', '1:10': 'Vibrato Delay', '1:32': 'TVF Cutoff', '1:33': 'TVF Resonance', '1:99': 'TVF&TVA Env Attack', '1:100': 'TVF&TVA Env Decay', '1:102': 'TVF&TVA Env Release' };
const NRPN_DRUM: Record<number, string> = { 24: 'Drum Pitch', 26: 'Drum Level', 28: 'Drum Pan', 29: 'Drum Reverb', 30: 'Drum Chorus' };

export function parameterName(kind: 'RPN' | 'NRPN', msb: number, lsb: number): string {
  if (kind === 'RPN') return `RPN ${msb}/${lsb} ${RPN_NAMES[`${msb}:${lsb}`] ?? ''}`.trim();
  const drum = NRPN_DRUM[msb];
  return `NRPN ${msb}/${lsb} ${drum ? `${drum} (key ${lsb})` : (NRPN_NAMES[`${msb}:${lsb}`] ?? '')}`.trim();
}
