// What a committed edit means for the song the engine is playing (ADR-039).
// 'none': the playback snapshot would be identical (clip names, colours, track names...).
// 'live': only controller values changed, all at or before the playhead: the transport can send the
//         values in effect and keep the engine running instead of reloading (an audible gap).
// 'reload': anything else (notes, programs, tempo, loop, mute / solo...).
import { portIndex } from '../model/ports';
import type { ConductorEvent, MidiEvent, MidiProject, MidiTrack, TrackMetaEvent } from '../model/types';

export interface LiveController {
  port: number;
  channel: number;
  controller: number;
}

export type PlaybackChange =
  | { kind: 'none' }
  | { kind: 'reload'; reason: string }
  | {
      kind: 'live';
      controllers: LiveController[];
      /** highest tick among the changed / added / removed events (where the old song is stale) */
      maxTick: number;
    };

/** Controllers that are not plain values (bank select, data entry, RPN / NRPN, channel modes). */
const NOT_LIVE_CC = new Set([0, 32, 6, 38, 96, 97, 98, 99, 100, 101, 120, 121, 122, 123, 124, 125, 126, 127]);

function sameConductor(a: readonly (ConductorEvent | TrackMetaEvent)[], b: readonly (ConductorEvent | TrackMetaEvent)[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as unknown as Record<string, unknown>;
    const y = b[i] as unknown as Record<string, unknown>;
    if (x === y) continue;
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) if (x[k] !== y[k]) return false;
  }
  return true;
}

function onlyOrderChanged(a: MidiEvent, b: MidiEvent): boolean {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (k !== 'originOrder' && x[k] !== y[k]) return false;
  return true;
}

function trackSettingsEqual(a: MidiTrack, b: MidiTrack): boolean {
  return a.port === b.port && a.channel === b.channel && a.mute === b.mute && a.solo === b.solo && a.endOfTrackTick === b.endOfTrackTick && a.hasPortPrefix === b.hasPortPrefix;
}

export function classifyPlaybackChange(prev: MidiProject, next: MidiProject, playheadTick: number): PlaybackChange {
  if (prev === next) return { kind: 'none' };
  const reload = (reason: string): PlaybackChange => ({ kind: 'reload', reason });
  if (prev.ppq !== next.ppq) return reload('ppq');
  const pl = prev.loop;
  const nl = next.loop;
  if (pl.enabled !== nl.enabled || (nl.enabled && (pl.startTick !== nl.startTick || pl.endTick !== nl.endTick))) return reload('loop');
  if (!sameConductor(prev.conductor, next.conductor)) return reload('conductor');
  if (!sameConductor(prev.conductorMeta, next.conductorMeta)) return reload('conductor meta');
  if (prev.conductorEndOfTrackTick !== next.conductorEndOfTrackTick) return reload('song end');
  if (prev.tracks.length !== next.tracks.length) return reload('tracks');

  const touched = new Map<string, LiveController>();
  let maxTick = -1;
  const touch = (port: number, channel: number, controller: number, tick: number) => {
    touched.set(`${port}:${channel}:${controller}`, { port, channel, controller });
    maxTick = Math.max(maxTick, tick);
  };
  /** false when the event cannot be applied live */
  const liveCc = (e: MidiEvent, track: MidiTrack): boolean => {
    if (e.kind !== 'cc' || NOT_LIVE_CC.has(e.controller) || e.tick > playheadTick) return false;
    touch(portIndex(track.port), e.channelOverride ?? track.channel, e.controller, e.tick);
    return true;
  };

  for (let i = 0; i < prev.tracks.length; i++) {
    const a = prev.tracks[i];
    const b = next.tracks[i];
    if (a.id !== b.id) return reload('track order');
    if (!trackSettingsEqual(a, b)) return reload('track settings');
    if (a.events === b.events) continue;
    const old = new Map<string, MidiEvent>();
    for (const e of a.events) old.set(e.id, e);
    for (const e of b.events) {
      const o = old.get(e.id);
      if (o === e) {
        old.delete(e.id);
        continue;
      }
      if (o) {
        old.delete(e.id);
        // Only renumbered (an event added before it at the same tick, ADR-081) and already played:
        // the change itself is the added event; the tick still marks the old song as stale here.
        if (e.tick <= playheadTick && onlyOrderChanged(o, e)) {
          maxTick = Math.max(maxTick, e.tick);
          continue;
        }
        if (!liveCc(o, a) || !liveCc(e, b)) return reload('event changed');
      } else if (!liveCc(e, b)) return reload('event added');
    }
    for (const o of old.values()) if (!liveCc(o, a)) return reload('event removed');
  }
  if (touched.size === 0) return { kind: 'none' };
  return { kind: 'live', controllers: [...touched.values()], maxTick };
}
