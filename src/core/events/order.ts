// Stable event ordering (ARCHITECTURE C): tick -> originOrder -> id.
// See DECISIONS ADR-014 for how originOrder encodes both the imported file order and the
// generation policy of new events.
import type { ConductorEvent, MidiEvent, MidiTrack, NoteEvent } from '../model/types';

type Ordered = { tick: number; originOrder: number; id: string };

export function compareEvents(a: Ordered, b: Ordered): number {
  return a.tick - b.tick || a.originOrder - b.originOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Returns a sorted copy (does not mutate). */
export function sortEvents<T extends Ordered>(events: readonly T[]): T[] {
  return [...events].sort(compareEvents);
}

export function isSorted(events: readonly Ordered[]): boolean {
  for (let i = 1; i < events.length; i++) if (compareEvents(events[i - 1], events[i]) > 0) return false;
  return true;
}

/** Channel voice kinds: the events that have a MIDI channel (and may carry channelOverride). */
export function hasChannel(e: MidiEvent): e is Extract<MidiEvent, { kind: 'note' | 'cc' | 'program' | 'pitch-bend' | 'channel-pressure' | 'poly-pressure' }> {
  return e.kind === 'note' || e.kind === 'cc' || e.kind === 'program' || e.kind === 'pitch-bend' || e.kind === 'channel-pressure' || e.kind === 'poly-pressure';
}

/** Effective MIDI channel (0..15) of a channel event, honouring channelOverride. */
export function eventChannel(track: MidiTrack, e: MidiEvent): number | null {
  return hasChannel(e) ? (e.channelOverride ?? track.channel) : null;
}

export function noteEndTick(n: NoteEvent): number {
  return n.tick + n.durationTicks;
}

/**
 * Generation policy rank for events created at the same tick in one operation
 * (MIDI_GS_SPEC 3): Bank Select -> Program -> other controls -> Note On.
 * Callers assign increasing originOrder in this rank order.
 */
export function policyRank(e: MidiEvent | ConductorEvent): number {
  switch (e.kind) {
    case 'tempo':
    case 'time-signature':
    case 'key-signature':
    case 'marker':
    case 'meta':
    case 'sysex':
      return 0;
    case 'cc':
      return e.controller === 0 || e.controller === 32 ? 1 : 3;
    case 'program':
      return 2;
    case 'pitch-bend':
    case 'channel-pressure':
    case 'poly-pressure':
    case 'raw':
      return 3;
    case 'note':
      return 5;
  }
}
