// Data for the visual-mode views (all-tracks piano roll, keyboard monitor). Built once per
// project change; per-frame lookups are binary searches (no scan of the whole song per frame).
import type { MidiProject, MidiTrack, NoteEvent } from '../model/types';

export interface Series {
  ticks: number[];
  values: number[];
}

export interface MonitorTrack {
  track: MidiTrack;
  /** notes of the track sorted by onset */
  notes: NoteEvent[];
  starts: number[];
  maxDuration: number;
  volume: Series;
  expression: Series;
  pan: Series;
  bend: Series;
  program: Series;
  minPitch: number;
  maxPitch: number;
}

export interface MonitorData {
  tracks: MonitorTrack[];
  minPitch: number;
  maxPitch: number;
}

function series(): Series {
  return { ticks: [], values: [] };
}

export function buildMonitorData(project: MidiProject): MonitorData {
  let minPitch = 127;
  let maxPitch = 0;
  const tracks: MonitorTrack[] = [];
  for (const track of project.tracks) {
    const notes = track.events.filter((e): e is NoteEvent => e.kind === 'note').sort((a, b) => a.tick - b.tick || a.originOrder - b.originOrder);
    if (notes.length === 0) continue;
    const t: MonitorTrack = { track, notes, starts: notes.map((n) => n.tick), maxDuration: 0, volume: series(), expression: series(), pan: series(), bend: series(), program: series(), minPitch: 127, maxPitch: 0 };
    for (const n of notes) {
      t.maxDuration = Math.max(t.maxDuration, n.durationTicks);
      t.minPitch = Math.min(t.minPitch, n.pitch);
      t.maxPitch = Math.max(t.maxPitch, n.pitch);
    }
    const sorted = [...track.events].sort((a, b) => a.tick - b.tick || a.originOrder - b.originOrder);
    const push = (s: Series, tick: number, v: number) => {
      s.ticks.push(tick);
      s.values.push(v);
    };
    for (const e of sorted) {
      if ('channelOverride' in e && e.channelOverride !== undefined && e.channelOverride !== track.channel) continue;
      if (e.kind === 'cc' && e.controller === 7) push(t.volume, e.tick, e.value);
      else if (e.kind === 'cc' && e.controller === 11) push(t.expression, e.tick, e.value);
      else if (e.kind === 'cc' && e.controller === 10) push(t.pan, e.tick, e.value);
      else if (e.kind === 'pitch-bend') push(t.bend, e.tick, e.value);
      else if (e.kind === 'program') push(t.program, e.tick, e.program);
    }
    minPitch = Math.min(minPitch, t.minPitch);
    maxPitch = Math.max(maxPitch, t.maxPitch);
    tracks.push(t);
  }
  // A track without its own Program Change sounds with the program set by another track on the
  // same port / channel (e.g. BRASS2 next to BRASS): use that one for display.
  const byChannel = new Map<string, Series>();
  for (const track of project.tracks) {
    const key = `${track.port}:${track.channel}`;
    const s = byChannel.get(key) ?? series();
    for (const e of track.events) {
      if (e.kind === 'program' && (e.channelOverride === undefined || e.channelOverride === track.channel)) {
        s.ticks.push(e.tick);
        s.values.push(e.program);
      }
    }
    byChannel.set(key, s);
  }
  for (const t of tracks) {
    if (t.program.ticks.length) continue;
    const s = byChannel.get(`${t.track.port}:${t.track.channel}`);
    if (!s || !s.ticks.length) continue;
    const order = s.ticks.map((_, i) => i).sort((a, b) => s.ticks[a] - s.ticks[b]);
    t.program = { ticks: order.map((i) => s.ticks[i]), values: order.map((i) => s.values[i]) };
  }
  return { tracks, minPitch: tracks.length ? minPitch : 48, maxPitch: tracks.length ? maxPitch : 72 };
}

/** Index of the last element <= x in a sorted array, or -1. */
export function lastAtOrBefore(sorted: readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Value of a controller series at a tick; before the first event, the first value (as the mixer shows) or the default. */
export function valueAt(s: Series, tick: number, fallback: number): number {
  const i = lastAtOrBefore(s.ticks, tick);
  if (i >= 0) return s.values[i];
  return s.values.length ? s.values[0] : fallback;
}

/** Notes sounding at a tick (onset <= tick < end). */
export function notesAt(t: MonitorTrack, tick: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = lastAtOrBefore(t.starts, tick); i >= 0; i--) {
    const n = t.notes[i];
    if (n.tick < tick - t.maxDuration) break;
    if (tick < n.tick + n.durationTicks) out.push(n);
  }
  return out;
}

/** Notes overlapping [from, to) for drawing (onset < to and end > from). */
export function notesIn(t: MonitorTrack, from: number, to: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  const last = lastAtOrBefore(t.starts, to - 1);
  for (let i = last; i >= 0; i--) {
    const n = t.notes[i];
    if (n.tick + t.maxDuration < from) break;
    if (n.tick + n.durationTicks > from) out.push(n);
  }
  return out;
}
