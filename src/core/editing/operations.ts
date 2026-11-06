// Pure editing operations. Each returns a Command (a reversible project patch) or null when the
// operation does nothing. Track.events is the only source of truth; clips are ID groups (ADR-005).
import { newId } from '../model/ids';
import { portIndex } from '../model/ports';
import { createTrack } from '../model/defaults';
import type { MidiClip, MidiEvent, MidiProject, MidiTrack, NoteEvent, TrackId } from '../model/types';
import { compareEvents, policyRank, sortEvents } from '../events/order';
import type { Command, ProjectPatch } from './history';
import { SMF_LIMITS } from '../smf/types';
import { maxOf, minOf } from '../model/numbers';
import { TimeSignatureMap } from '../timing/timeSignatureMap';
import { t } from '../../i18n';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A new event before it gets an ID and an origin order. */
export type NewEvent = DistributiveOmit<MidiEvent, 'id' | 'originOrder'>;

export class EditError extends Error {}

function cmd(label: string, patch: ProjectPatch): Command {
  return { label, patch };
}

function replaceTracks(project: MidiProject, changed: Map<TrackId, MidiTrack>): MidiTrack[] {
  return project.tracks.map((t) => changed.get(t.id) ?? t);
}

function findTrack(project: MidiProject, trackId: TrackId): MidiTrack {
  const t = project.tracks.find((x) => x.id === trackId);
  if (!t) throw new EditError(`track ${trackId} not found`);
  return t;
}

const MAX_TICK = SMF_LIMITS.maxTick;

/** Validates value ranges of an event (throws EditError). */
export function assertValidEvent(e: NewEvent | MidiEvent): void {
  const in7 = (v: number) => Number.isInteger(v) && v >= 0 && v <= 127;
  if (!Number.isSafeInteger(e.tick) || e.tick < 0 || e.tick > MAX_TICK) throw new EditError(`invalid tick ${e.tick}`);
  if ('channelOverride' in e && e.channelOverride !== undefined && !(Number.isInteger(e.channelOverride) && e.channelOverride >= 0 && e.channelOverride < 16)) {
    throw new EditError(`invalid channel ${e.channelOverride}`);
  }
  switch (e.kind) {
    case 'note':
      if (!in7(e.pitch) || !in7(e.velocity) || e.velocity === 0 || !in7(e.releaseVelocity)) throw new EditError('invalid note values');
      if (!Number.isSafeInteger(e.durationTicks) || e.durationTicks < 1 || e.tick + e.durationTicks > MAX_TICK) throw new EditError(`invalid note duration ${e.durationTicks}`);
      break;
    case 'cc':
      if (!in7(e.controller) || !in7(e.value)) throw new EditError('invalid CC values');
      break;
    case 'program':
      if (!in7(e.program)) throw new EditError('invalid program');
      break;
    case 'pitch-bend':
      if (!Number.isInteger(e.value) || e.value < -8192 || e.value > 8191) throw new EditError('invalid pitch bend');
      break;
    case 'channel-pressure':
      if (!in7(e.pressure)) throw new EditError('invalid pressure');
      break;
    case 'poly-pressure':
      if (!in7(e.pitch) || !in7(e.pressure)) throw new EditError('invalid poly pressure');
      break;
    case 'meta':
      if (!Number.isInteger(e.metaType) || e.metaType < 0 || e.metaType > 127) throw new EditError('invalid meta type');
      break;
    default:
      break;
  }
}

/**
 * Adds events to a track. New events at the same tick are ordered by the generation policy
 * (Bank Select -> Program -> controls -> notes) and get increasing originOrder (ADR-014).
 * Optionally adds them to a clip.
 */
export function addEvents(project: MidiProject, trackId: TrackId, events: readonly NewEvent[], opts: { clipId?: string; label?: string } = {}): { command: Command; ids: string[] } | null {
  if (events.length === 0) return null;
  const track = findTrack(project, trackId);
  events.forEach(assertValidEvent);
  const ordered = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.tick - b.e.tick || policyRank(a.e as MidiEvent) - policyRank(b.e as MidiEvent) || a.i - b.i);
  let next = project.nextOriginOrder;
  const created: MidiEvent[] = new Array(events.length);
  for (const { e, i } of ordered) created[i] = { ...e, id: newId('evt'), originOrder: next++ } as MidiEvent;
  // A new event takes the newest originOrder, so at a tick that already has events it would follow
  // them all: a Program Change set after the notes at tick 0 would sound only after the first note
  // (which then plays the previous / default sound). Follow the generation policy across old and new
  // events at that tick (MIDI_GS_SPEC 3, ADR-081): existing events of a later rank (e.g. notes after a
  // new Program Change) are renumbered after the new ones. Old events never move ahead of each other,
  // and adding notes never renumbers anything (notes have the last rank).
  const renumbered = new Map<string, number>();
  const releases = new Map<string, number>();
  const newAt = new Map<number, MidiEvent[]>();
  for (const { i } of ordered) newAt.set(created[i].tick, [...(newAt.get(created[i].tick) ?? []), created[i]]);
  for (const [tick, fresh] of newAt) {
    const minRank = Math.min(...fresh.map(policyRank));
    const later = sortEvents(track.events.filter((x) => x.tick === tick && policyRank(x) > minRank));
    if (later.length === 0) continue;
    const pending = [...fresh]; // already in policy order
    const merged: MidiEvent[] = [];
    for (const old of later) {
      while (pending.length && policyRank(pending[0]) < policyRank(old)) merged.push(pending.shift()!);
      merged.push(old);
    }
    merged.push(...pending);
    const orders = new Map<string, number>();
    next = numberTick(track.events, tick, merged, new Set(later.map((x) => x.id)), next, orders, releases);
    for (const x of merged) {
      if (x.originOrder >= project.nextOriginOrder) x.originOrder = orders.get(x.id)!; // created here: safe to mutate
      else renumbered.set(x.id, orders.get(x.id)!);
    }
  }
  const kept = renumbered.size || releases.size ? renumber(track.events, renumbered, releases) : track.events;
  const newTrack: MidiTrack = { ...track, events: sortEvents([...kept, ...created]) };
  const ids = created.map((e) => e.id);
  const patch: ProjectPatch = { tracks: replaceTracks(project, new Map([[trackId, newTrack]])), nextOriginOrder: next };
  if (opts.clipId) {
    patch.clips = project.clips.map((c) => (c.id === opts.clipId ? extendClip({ ...c, eventIds: [...c.eventIds, ...ids] }, created) : c));
  } else {
    // No clip named: an event whose onset lands inside a clip of this track joins that clip (the first one in
    // project order when clips overlap), so recorded / drawn / pasted material belongs to the region it was
    // put into and the clip's quantize, move and delete act on it. Events outside every clip stay free (ADR-059).
    const own = project.clips.filter((c) => c.trackId === trackId);
    const joined = new Map<string, string[]>();
    const free: MidiEvent[] = [];
    for (const e of created) {
      const c = own.find((x) => x.startTick <= e.tick && e.tick < x.endTick);
      if (c) joined.set(c.id, [...(joined.get(c.id) ?? []), e.id]);
      else free.push(e);
    }
    let clips = joined.size ? project.clips.map((c) => (joined.has(c.id) ? { ...c, eventIds: [...c.eventIds, ...joined.get(c.id)!] } : c)) : project.clips;
    // Notes put where no clip is get a clip of their own, as recording onto an empty track does in a DAW
    // (ADR-060): whole bars around the material, clamped to the gap between the neighbouring clips. CC / Program
    // / SysEx alone (mixer and patch setup) make no clip.
    if (free.some((e) => e.kind === 'note')) clips = [...clips, ...clipsAroundFreeEvents(project, trackId, own, free)];
    if (clips !== project.clips) patch.clips = clips;
  }
  return { command: cmd(opts.label ?? 'イベントを追加', patch), ids };
}

/**
 * Gives every loose note of the project a clip (ADR-064): projects saved before clips adopted new
 * notes automatically (ADR-059 / 060) would otherwise go silent. Same bar-aligned rule as addEvents.
 */
export function adoptLooseNotes(project: MidiProject): MidiProject {
  let clips = project.clips;
  for (const track of project.tracks) {
    const own = clips.filter((c) => c.trackId === track.id);
    const inClip = new Set(own.flatMap((c) => c.eventIds));
    const free = track.events.filter((e) => e.kind === 'note' && !inClip.has(e.id));
    if (free.length) clips = [...clips, ...clipsAroundFreeEvents(project, track.id, own, free)];
  }
  return clips === project.clips ? project : { ...project, clips };
}

/** One new clip per gap between the track's existing clips that holds free events, on bar boundaries. */
function clipsAroundFreeEvents(project: MidiProject, trackId: TrackId, own: readonly MidiClip[], free: readonly MidiEvent[]): MidiClip[] {
  const sig = new TimeSignatureMap(project.ppq, project.conductor.filter((c) => c.kind === 'time-signature'));
  const barStart = (tick: number) => Math.round(sig.barBeatToTick(sig.tickToBarBeat(tick).bar));
  const barEndAfter = (tick: number) => Math.round(sig.barBeatToTick(sig.tickToBarBeat(Math.max(0, tick - 1)).bar + 1));
  const sorted = [...free].sort((a, b) => a.tick - b.tick);
  const gapOf = (tick: number) => ({
    lo: maxOf(own.filter((c) => c.endTick <= tick), (c) => c.endTick),
    hi: minOf(own.filter((c) => c.startTick > tick), (c) => c.startTick),
  });
  const groups = new Map<string, MidiEvent[]>();
  for (const e of sorted) {
    const g = gapOf(e.tick);
    const key = `${g.lo}:${g.hi}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()].map((events) => {
    const g = gapOf(events[0].tick);
    const first = events[0].tick;
    const last = maxOf(events, (e) => (e.kind === 'note' ? e.tick + e.durationTicks : e.tick + 1));
    const startTick = Math.max(Number.isFinite(g.lo) ? g.lo : 0, barStart(first));
    const endTick = Math.max(startTick + 1, Math.min(Number.isFinite(g.hi) ? g.hi : Infinity, barEndAfter(last)));
    return { id: newId('clp'), trackId, startTick, endTick, eventIds: events.map((e) => e.id) };
  });
}

function extendClip(c: MidiClip, events: readonly MidiEvent[]): MidiClip {
  let start = c.startTick;
  let end = c.endTick;
  for (const e of events) {
    start = Math.min(start, e.tick);
    end = Math.max(end, e.kind === 'note' ? e.tick + e.durationTicks : e.tick + 1);
  }
  return start === c.startTick && end === c.endTick ? c : { ...c, startTick: start, endTick: end };
}

export function deleteEvents(project: MidiProject, ids: Iterable<string>, label = 'イベントを削除'): Command | null {
  const del = new Set(ids);
  if (del.size === 0) return null;
  const changed = new Map<TrackId, MidiTrack>();
  for (const t of project.tracks) {
    if (!t.events.some((e) => del.has(e.id))) continue;
    changed.set(t.id, { ...t, events: t.events.filter((e) => !del.has(e.id)) });
  }
  if (changed.size === 0) return null;
  const clips = project.clips.map((c) => (c.eventIds.some((id) => del.has(id)) ? { ...c, eventIds: c.eventIds.filter((id) => !del.has(id)) } : c));
  return cmd(label, { tracks: replaceTracks(project, changed), clips });
}

/**
 * After events moved to another tick (or changed kind), keeps the generation policy at their new
 * ticks (ADR-082, the move counterpart of ADR-081): a moved event goes before the events already
 * there whose kind comes later (a Program Change moved onto a note's tick sounds before it; a note
 * moved onto a tick with a Program Change sounds after it). Events of the same kind keep their
 * existing order, moved events keep their order among themselves and the others keep theirs. Only
 * ticks whose order changes are renumbered, from `next`.
 */
/**
 * Numbers the events of one tick in `merged` order, starting at `next`. Imported Note Offs that end
 * at this tick (notes with a releaseOrder) keep their place among the events that were already
 * there (`anchors`, old numbers): a kept Note Off that followed a pedal-down still follows it after
 * the renumbering, and one that came before every anchor keeps its number (ADR-086).
 */
function numberTick(all: readonly MidiEvent[], tick: number, merged: readonly MidiEvent[], anchors: ReadonlySet<string>, next: number, orders: Map<string, number>, releases: Map<string, number>): number {
  const old = merged.filter((e) => anchors.has(e.id)).sort((a, b) => a.originOrder - b.originOrder);
  const after = new Map<string, NoteEvent[]>();
  for (const n of all) {
    if (n.kind !== 'note' || n.releaseOrder === undefined || n.tick + n.durationTicks !== tick) continue;
    let anchor: MidiEvent | undefined;
    for (const e of old) if (e.originOrder < n.releaseOrder) anchor = e;
    if (anchor) after.set(anchor.id, [...(after.get(anchor.id) ?? []), n]);
  }
  for (const e of merged) {
    orders.set(e.id, next++);
    for (const n of (after.get(e.id) ?? []).sort((a, b) => a.releaseOrder! - b.releaseOrder!)) releases.set(n.id, next++);
  }
  return next;
}

/** applies numberTick results */
function renumber(events: readonly MidiEvent[], orders: ReadonlyMap<string, number>, releases: ReadonlyMap<string, number>): MidiEvent[] {
  return events.map((e) => {
    const o = orders.get(e.id);
    const r = releases.get(e.id);
    if (o === undefined && r === undefined) return e;
    return { ...e, ...(o !== undefined ? { originOrder: o } : {}), ...(r !== undefined ? { releaseOrder: r } : {}) } as MidiEvent;
  });
}

function settleMoved(events: readonly MidiEvent[], moved: ReadonlySet<string>, next: number): { events: MidiEvent[]; next: number } {
  const sorted = sortEvents(events);
  const ticks = new Set(sorted.filter((e) => moved.has(e.id)).map((e) => e.tick));
  if (ticks.size === 0) return { events: sorted, next };
  const byTick = new Map<number, MidiEvent[]>();
  for (const e of sorted) if (ticks.has(e.tick)) byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e]);
  const orders = new Map<string, number>();
  const releases = new Map<string, number>();
  for (const [tick, group] of byTick) {
    const stay = group.filter((e) => !moved.has(e.id));
    if (stay.length === 0) continue;
    const before: MidiEvent[][] = stay.map(() => []);
    const tail: MidiEvent[] = [];
    let floor = 0;
    for (const m of group.filter((e) => moved.has(e.id))) {
      // before the first event of a later kind; among the same kind the existing order stands
      const first = stay.findIndex((e) => policyRank(e) > policyRank(m) || (policyRank(e) === policyRank(m) && e.originOrder > m.originOrder));
      const pos = Math.max(floor, first < 0 ? stay.length : first);
      floor = pos;
      (pos < stay.length ? before[pos] : tail).push(m);
    }
    const merged = [...stay.flatMap((e, i) => [...before[i], e]), ...tail];
    if (merged.every((e, i) => e === group[i])) continue;
    next = numberTick(sorted, tick, merged, new Set(stay.map((e) => e.id)), next, orders, releases);
  }
  if (orders.size === 0) return { events: sorted, next };
  return { events: sortEvents(renumber(sorted, orders, releases)), next };
}

/** Fields an edit may change. Kind and id are fixed. */
export type EventChanges = Partial<Omit<NoteEvent, 'id' | 'kind' | 'originOrder'>> & Record<string, unknown>;

/**
 * Updates event fields. When a note's onset or length changes, its imported Note Off order is
 * dropped so the generated Note Off follows the policy order (ADR-014).
 */
export function updateEvents(project: MidiProject, updates: ReadonlyArray<{ id: string; changes: EventChanges }>, label = 'イベントを変更'): Command | null {
  const byId = new Map(updates.map((u) => [u.id, u.changes]));
  const changed = new Map<TrackId, MidiTrack>();
  let order = project.nextOriginOrder;
  for (const t of project.tracks) {
    let touched = false;
    const moved = new Set<string>();
    const events = t.events.map((e) => {
      const ch = byId.get(e.id);
      if (!ch) return e;
      touched = true;
      const { id: _id, kind: _kind, originOrder: _o, ...rest } = ch as Record<string, unknown>;
      void _id;
      void _kind;
      void _o;
      const next = { ...e, ...rest } as MidiEvent;
      if (next.kind === 'note' && e.kind === 'note' && (next.tick !== e.tick || next.durationTicks !== e.durationTicks) && next.releaseOrder !== undefined) {
        delete (next as NoteEvent).releaseOrder;
      }
      assertValidEvent(next);
      // a new tick, or a new kind of position at the same tick (CC 7 → CC 0 Bank Select): re-placed by the policy (ADR-086)
      if (next.tick !== e.tick || policyRank(next) !== policyRank(e)) moved.add(e.id);
      return next;
    });
    if (!touched) continue;
    const settled = settleMoved(events, moved, order);
    order = settled.next;
    changed.set(t.id, { ...t, events: settled.events });
  }
  if (changed.size === 0) return null;
  return cmd(label, { tracks: replaceTracks(project, changed), clips: refreshClipBounds(project.clips, changed), ...orderPatch(project, order) });
}

/** nextOriginOrder in the patch only when the edit used new numbers. */
function orderPatch(project: MidiProject, next: number): ProjectPatch {
  return next !== project.nextOriginOrder ? { nextOriginOrder: next } : {};
}

/**
 * Rewrites whole events (kind changes included) while keeping each event's id and originOrder, so
 * selection, clip membership and the stable order at the same tick survive (ADR-066). `fn` returns
 * the new event body or null to leave the event alone.
 */
export function rewriteEvents(project: MidiProject, ids: Iterable<string>, fn: (e: MidiEvent, track: MidiTrack) => NewEvent | null, label = 'イベントを変更'): Command | null {
  const wanted = new Set(ids);
  if (wanted.size === 0) return null;
  const changed = new Map<TrackId, MidiTrack>();
  let order = project.nextOriginOrder;
  for (const t of project.tracks) {
    let touched = false;
    const moved = new Set<string>();
    const events = t.events.map((e) => {
      if (!wanted.has(e.id)) return e;
      const body = fn(e, t);
      if (!body) return e;
      touched = true;
      const next = { ...body, id: e.id, originOrder: e.originOrder } as MidiEvent;
      assertValidEvent(next);
      if (next.tick !== e.tick || policyRank(next) !== policyRank(e)) moved.add(e.id);
      return next;
    });
    if (!touched) continue;
    const settled = settleMoved(events, moved, order);
    order = settled.next;
    changed.set(t.id, { ...t, events: settled.events });
  }
  if (changed.size === 0) return null;
  return cmd(label, { tracks: replaceTracks(project, changed), clips: refreshClipBounds(project.clips, changed), ...orderPatch(project, order) });
}

/** Replaces one event with another body (normally of a different kind), keeping its id and originOrder. */
export function replaceEvent(project: MidiProject, id: string, next: NewEvent, label = '種類を変更'): Command | null {
  return rewriteEvents(project, [id], () => next, label);
}

/** Clip bounds grow to contain their (possibly moved) events; they never shrink implicitly. */
function refreshClipBounds(clips: readonly MidiClip[], changed: Map<TrackId, MidiTrack>): MidiClip[] {
  return clips.map((c) => {
    const t = changed.get(c.trackId);
    if (!t) return c;
    const ids = new Set(c.eventIds);
    return extendClip(c, t.events.filter((e) => ids.has(e.id)));
  });
}

/**
 * Moves events in time and/or pitch. The group keeps its shape: the deltas are limited so that
 * no event goes below tick 0 or outside pitch 0..127 (only pitched events are transposed).
 */
export function moveEvents(project: MidiProject, ids: Iterable<string>, deltaTick: number, deltaPitch = 0, label = 'イベントを移動'): Command | null {
  const sel = new Set(ids);
  const targets = project.tracks.flatMap((t) => t.events.filter((e) => sel.has(e.id)));
  if (targets.length === 0) return null;
  const minTick = minOf(targets, (e) => e.tick);
  let dt = Math.max(deltaTick, -minTick);
  const pitched = targets.filter((e): e is NoteEvent | Extract<MidiEvent, { kind: 'poly-pressure' }> => e.kind === 'note' || e.kind === 'poly-pressure');
  let dp = deltaPitch;
  if (pitched.length > 0 && dp !== 0) {
    const lo = minOf(pitched, (e) => e.pitch);
    const hi = maxOf(pitched, (e) => e.pitch);
    dp = Math.min(Math.max(dp, -lo), 127 - hi);
  } else dp = 0;
  if (!Number.isSafeInteger(dt)) throw new EditError('tick delta must be an integer');
  if (dt === 0 && dp === 0) return null;
  dt = Math.trunc(dt);
  return updateEvents(
    project,
    targets.map((e) => ({
      id: e.id,
      changes: { tick: e.tick + dt, ...(dp !== 0 && (e.kind === 'note' || e.kind === 'poly-pressure') ? { pitch: e.pitch + dp } : {}) },
    })),
    label,
  );
}

/** Copies events (new IDs and origin orders) shifted by deltaTick, into the same track. */
/**
 * Copies events by deltaTick. `ids` are the copies in event order (not in the order of the given
 * ids); `sourceIds[i]` is the original of `ids[i]` (ADR-083: map copies back through this).
 */
export function duplicateEvents(project: MidiProject, ids: Iterable<string>, deltaTick: number, label = 'イベントを複製'): { command: Command; ids: string[]; sourceIds: string[] } | null {
  const sel = new Set(ids);
  let p = project;
  const newIds: string[] = [];
  const sourceIds: string[] = [];
  const patch: ProjectPatch = {};
  for (const t of project.tracks) {
    const src = t.events.filter((e) => sel.has(e.id)).sort(compareEvents);
    if (src.length === 0) continue;
    const copies = src.map((e) => stripForCopy(e, deltaTick));
    const r = addEvents(p, t.id, copies, { label });
    if (!r) continue;
    p = { ...p, ...r.command.patch };
    Object.assign(patch, r.command.patch);
    newIds.push(...r.ids);
    sourceIds.push(...src.map((e) => e.id));
  }
  if (newIds.length === 0) return null;
  return { command: cmd(label, patch), ids: newIds, sourceIds };
}

function stripForCopy(e: MidiEvent, deltaTick: number): NewEvent {
  const { id: _id, originOrder: _o, ...rest } = e;
  void _id;
  void _o;
  const copy = { ...rest, tick: e.tick + deltaTick } as NewEvent & { releaseOrder?: number };
  delete copy.releaseOrder; // copies are generated events
  if (copy.tick < 0) throw new EditError('copy would start before tick 0');
  return copy;
}

// ---------------------------------------------------------------- clips

export function createClip(project: MidiProject, trackId: TrackId, startTick: number, endTick: number, label = 'クリップを作成'): { command: Command; clipId: string } {
  findTrack(project, trackId);
  if (!(Number.isSafeInteger(startTick) && Number.isSafeInteger(endTick) && startTick >= 0 && endTick > startTick)) throw new EditError('invalid clip range');
  const track = findTrack(project, trackId);
  const inClip = new Set(project.clips.filter((c) => c.trackId === trackId).flatMap((c) => c.eventIds));
  // Events whose onset is inside the range and that are not in another clip join the new clip.
  const eventIds = track.events.filter((e) => e.tick >= startTick && e.tick < endTick && !inClip.has(e.id)).map((e) => e.id);
  const clip: MidiClip = { id: newId('clp'), trackId, startTick, endTick, eventIds };
  return { command: cmd(label, { clips: [...project.clips, clip] }), clipId: clip.id };
}

/**
 * Events of the clip's track whose onset is inside its range but that belong to no clip (ADR-059: material
 * added before clips adopted new events automatically, or left behind by an older project).
 */
export function freeEventsInClip(project: MidiProject, clipId: string): string[] {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new EditError(`clip ${clipId} not found`);
  const track = findTrack(project, clip.trackId);
  const inClip = new Set(project.clips.filter((c) => c.trackId === clip.trackId).flatMap((c) => c.eventIds));
  return track.events.filter((e) => e.tick >= clip.startTick && e.tick < clip.endTick && !inClip.has(e.id)).map((e) => e.id);
}

/** Makes the free events inside the clip's range members of the clip. */
export function adoptFreeEvents(project: MidiProject, clipId: string, label = '範囲内のノートをクリップに取り込む'): Command | null {
  const ids = freeEventsInClip(project, clipId);
  if (ids.length === 0) return null;
  return cmd(label, { clips: project.clips.map((c) => (c.id === clipId ? { ...c, eventIds: [...c.eventIds, ...ids] } : c)) });
}

/** Moves a clip and all its events (CC / Program / SysEx included) by deltaTick. */
export function moveClip(project: MidiProject, clipId: string, deltaTick: number, label = 'クリップを移動'): Command | null {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new EditError(`clip ${clipId} not found`);
  const dt = Math.max(deltaTick, -clip.startTick);
  if (dt === 0) return null;
  const ids = new Set(clip.eventIds);
  const track = findTrack(project, clip.trackId);
  const minEvent = minOf(track.events.filter((e) => ids.has(e.id)), (e) => e.tick);
  const delta = Number.isFinite(minEvent) ? Math.max(dt, -minEvent) : dt;
  const events = sortEvents(
    track.events.map((e) => {
      if (!ids.has(e.id)) return e;
      return { ...e, tick: e.tick + delta } as MidiEvent; // duration unchanged, so the imported Note Off order stays valid relative to the note
    }),
  );
  // releaseOrder only orders against other events at the same tick; after a move the old order is meaningless.
  const cleaned = events.map((e) => (ids.has(e.id) && e.kind === 'note' && e.releaseOrder !== undefined ? dropReleaseOrder(e) : e));
  const settled = settleMoved(cleaned, ids, project.nextOriginOrder);
  const newTrack = { ...track, events: settled.events };
  const clips = project.clips.map((c) => (c.id === clipId ? { ...c, startTick: c.startTick + delta, endTick: c.endTick + delta } : c));
  return cmd(label, { tracks: replaceTracks(project, new Map([[track.id, newTrack]])), clips, ...orderPatch(project, settled.next) });
}

/**
 * Moves several clips by the same delta (clamped so the earliest stays at tick 0 or later) and,
 * with `trackOffset`, by that many tracks (clamped so the group stays inside the track list, ADR-062),
 * as one command. Events keep their IDs when they change track.
 */
export function moveClips(project: MidiProject, clipIds: Iterable<string>, deltaTick: number, opts: { trackOffset?: number; label?: string } = {}): Command | null {
  const label = opts.label ?? 'クリップを移動';
  const sel = new Set(clipIds);
  const clips = project.clips.filter((c) => sel.has(c.id));
  if (clips.length === 0) return null;
  const delta = Math.max(deltaTick, -Math.min(...clips.map((c) => c.startTick)));
  const offset = clampedTrackOffset(project, clips, opts.trackOffset ?? 0);
  if (delta === 0 && offset === 0) return null;
  const steps: ((p: MidiProject) => Command | null)[] = [];
  if (delta !== 0) steps.push(...clips.map((c) => (p: MidiProject) => moveClip(p, c.id, delta, label)));
  if (offset !== 0) steps.push(...clips.map((c) => (p: MidiProject) => moveClipToTrack(p, c.id, project.tracks[project.tracks.findIndex((tk) => tk.id === c.trackId) + offset].id, label)));
  return compose(project, label, steps);
}

/** The track offset limited so that none of the clips would leave the track list. */
export function clampedTrackOffset(project: MidiProject, clips: readonly MidiClip[], offset: number): number {
  if (clips.length === 0 || offset === 0) return 0;
  const idx = clips.map((c) => project.tracks.findIndex((tk) => tk.id === c.trackId));
  return Math.max(-Math.min(...idx), Math.min(project.tracks.length - 1 - Math.max(...idx), offset));
}

/** Moves a clip and its events to another track (same ticks, same IDs). */
export function moveClipToTrack(project: MidiProject, clipId: string, trackId: TrackId, label = 'クリップを移動'): Command | null {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new EditError(`clip ${clipId} not found`);
  if (clip.trackId === trackId) return null;
  const src = findTrack(project, clip.trackId);
  const dst = findTrack(project, trackId);
  const ids = new Set(clip.eventIds);
  const moving = src.events.filter((e) => ids.has(e.id)).map((e) => (e.kind === 'note' && e.releaseOrder !== undefined ? dropReleaseOrder(e) : e));
  const settled = settleMoved([...dst.events, ...moving], ids, project.nextOriginOrder);
  const tracks = replaceTracks(
    project,
    new Map([
      [src.id, { ...src, events: src.events.filter((e) => !ids.has(e.id)) }],
      [dst.id, { ...dst, events: settled.events }],
    ]),
  );
  const clips = project.clips.map((c) => (c.id === clipId ? { ...c, trackId } : c));
  return cmd(label, { tracks, clips, ...orderPatch(project, settled.next) });
}

/** Deletes several clips as one command. */
export function deleteClips(project: MidiProject, clipIds: Iterable<string>, opts: { deleteEvents: boolean } = { deleteEvents: true }, label = 'クリップを削除'): Command | null {
  return compose(project, label, [...clipIds].map((id) => (p) => deleteClip(p, id, opts, label)));
}

/** Runs steps one after another on the intermediate project and merges their patches into one command. */
export function compose(project: MidiProject, label: string, steps: readonly ((p: MidiProject) => Command | null)[]): Command | null {
  let p = project;
  const patch: ProjectPatch = {};
  let any = false;
  for (const step of steps) {
    const c = step(p);
    if (!c) continue;
    p = { ...p, ...c.patch };
    Object.assign(patch, c.patch);
    any = true;
  }
  return any ? cmd(label, patch) : null;
}

function dropReleaseOrder(n: NoteEvent): NoteEvent {
  const { releaseOrder: _r, ...rest } = n;
  void _r;
  return rest;
}

/** Copies a clip and its events to start at targetTick (optionally on another track). */
export function duplicateClip(project: MidiProject, clipId: string, targetTick: number, targetTrackId?: TrackId, label = 'クリップを複製'): { command: Command; clipId: string } {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new EditError(`clip ${clipId} not found`);
  const src = findTrack(project, clip.trackId);
  const dstId = targetTrackId ?? clip.trackId;
  findTrack(project, dstId);
  if (!Number.isSafeInteger(targetTick) || targetTick < 0) throw new EditError('invalid clip position');
  const delta = targetTick - clip.startTick;
  const ids = new Set(clip.eventIds);
  const copies = src.events.filter((e) => ids.has(e.id)).sort(compareEvents).map((e) => stripForCopy(e, delta));
  const newClip: MidiClip = { ...clip, id: newId('clp'), trackId: dstId, startTick: clip.startTick + delta, endTick: clip.endTick + delta, eventIds: [] };
  const withClip = { ...project, clips: [...project.clips, newClip] };
  const r = addEvents(withClip, dstId, copies, { clipId: newClip.id, label });
  const patch: ProjectPatch = r ? { ...r.command.patch } : { clips: withClip.clips };
  if (!patch.clips) patch.clips = withClip.clips;
  return { command: cmd(label, patch), clipId: newClip.id };
}

/**
 * Splits a clip at `tick`. Events belong to the side of their onset; a note crossing the split
 * stays on the left with its full length (REQ-PRJ-06). The MIDI content does not change.
 */
export function splitClip(project: MidiProject, clipId: string, tick: number, label = 'クリップを分割'): Command | null {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new EditError(`clip ${clipId} not found`);
  if (tick <= clip.startTick || tick >= clip.endTick) return null;
  const track = findTrack(project, clip.trackId);
  const ids = new Set(clip.eventIds);
  const left: string[] = [];
  const right: string[] = [];
  for (const e of track.events) if (ids.has(e.id)) (e.tick < tick ? left : right).push(e.id);
  const a: MidiClip = { ...clip, endTick: tick, eventIds: left };
  const b: MidiClip = { ...clip, id: newId('clp'), startTick: tick, eventIds: right };
  const clips = project.clips.flatMap((c) => (c.id === clipId ? [a, b] : [c]));
  return cmd(label, { clips });
}

/**
 * Merges the selected clips of each track into one clip (ADR-065): the earliest clip grows to the
 * latest end and takes the events of the others; free events whose onset falls inside the new range
 * join too (as when a clip is extended). Clips of other tracks, and tracks with only one selected
 * clip, are left alone. Nothing is moved or cut, so the MIDI content does not change.
 */
export function mergeClips(project: MidiProject, clipIds: Iterable<string>, label = 'クリップを結合'): Command | null {
  const sel = new Set(clipIds);
  const byTrack = new Map<TrackId, MidiClip[]>();
  for (const c of project.clips) if (sel.has(c.id)) byTrack.set(c.trackId, [...(byTrack.get(c.trackId) ?? []), c]);
  const groups = [...byTrack.values()].filter((g) => g.length >= 2);
  if (groups.length === 0) return null;
  const removed = new Set<string>();
  const merged = new Map<string, MidiClip>();
  for (const g of groups) {
    const sorted = [...g].sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
    const first = sorted[0];
    const startTick = first.startTick;
    const endTick = Math.max(...sorted.map((c) => c.endTick));
    const track = findTrack(project, first.trackId);
    const others = new Set(project.clips.filter((c) => c.trackId === first.trackId && !sel.has(c.id)).flatMap((c) => c.eventIds));
    const own = new Set(sorted.flatMap((c) => c.eventIds));
    // the merged clip's events in track order: its own, plus free events now inside the range
    const eventIds = track.events.filter((e) => own.has(e.id) || (!others.has(e.id) && e.tick >= startTick && e.tick < endTick)).map((e) => e.id);
    merged.set(first.id, { ...first, startTick, endTick, eventIds });
    for (const c of sorted.slice(1)) removed.add(c.id);
  }
  const clips = project.clips.filter((c) => !removed.has(c.id)).map((c) => merged.get(c.id) ?? c);
  return cmd(label, { clips });
}

/**
 * Changes a clip's range without moving or cutting any event (non-destructive trim / extend,
 * ADR-040). Events whose onset leaves the range leave the clip but stay on the track; free events
 * (in no other clip) whose onset is inside the new range join it, as in createClip. The MIDI
 * content does not change.
 */
export function resizeClip(project: MidiProject, clipId: string, range: { startTick?: number; endTick?: number }, label = 'クリップの長さを変更'): Command | null {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new EditError(`clip ${clipId} not found`);
  const startTick = range.startTick ?? clip.startTick;
  const endTick = range.endTick ?? clip.endTick;
  if (!(Number.isSafeInteger(startTick) && Number.isSafeInteger(endTick) && startTick >= 0 && endTick > startTick)) throw new EditError('invalid clip range');
  if (startTick === clip.startTick && endTick === clip.endTick) return null;
  const track = findTrack(project, clip.trackId);
  const others = new Set(project.clips.filter((c) => c.trackId === clip.trackId && c.id !== clipId).flatMap((c) => c.eventIds));
  const eventIds = track.events.filter((e) => e.tick >= startTick && e.tick < endTick && !others.has(e.id)).map((e) => e.id);
  return cmd(label, { clips: project.clips.map((c) => (c.id === clipId ? { ...c, startTick, endTick, eventIds } : c)) });
}

export function updateClip(project: MidiProject, clipId: string, changes: { name?: string; color?: string }, label = 'クリップを変更'): Command | null {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  return cmd(label, { clips: project.clips.map((c) => (c.id === clipId ? { ...c, ...changes } : c)) });
}

export function deleteClip(project: MidiProject, clipId: string, opts: { deleteEvents: boolean } = { deleteEvents: true }, label = 'クリップを削除'): Command | null {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const clips = project.clips.filter((c) => c.id !== clipId);
  if (!opts.deleteEvents) return cmd(label, { clips });
  const del = deleteEvents({ ...project, clips }, clip.eventIds, label);
  return cmd(label, { clips, ...(del ? { tracks: del.patch.tracks } : {}) });
}

// ---------------------------------------------------------------- tracks

export function addTrack(project: MidiProject, partial: Partial<MidiTrack> = {}, index = project.tracks.length, label = 'トラックを追加'): { command: Command; trackId: string } {
  const t = createTrack({ name: `Track ${project.tracks.length + 1}`, events: [], ...partial }, project.tracks.length);
  const tracks = [...project.tracks];
  tracks.splice(index, 0, t);
  return { command: cmd(label, { tracks }), trackId: t.id };
}

export function removeTrack(project: MidiProject, trackId: TrackId, label = 'トラックを削除'): Command | null {
  if (!project.tracks.some((t) => t.id === trackId)) return null;
  return cmd(label, { tracks: project.tracks.filter((t) => t.id !== trackId), clips: project.clips.filter((c) => c.trackId !== trackId) });
}

export type TrackChanges = Partial<Pick<MidiTrack, 'name' | 'color' | 'port' | 'channel' | 'displayMode' | 'drumMapId' | 'mute' | 'solo'>>;

export function updateTrack(project: MidiProject, trackId: TrackId, changes: TrackChanges, label = 'トラックを変更'): Command | null {
  const t = findTrack(project, trackId);
  if (changes.channel !== undefined && !(Number.isInteger(changes.channel) && changes.channel >= 0 && changes.channel < 16)) throw new EditError('invalid channel');
  const next = { ...t, ...changes };
  return cmd(label, { tracks: replaceTracks(project, new Map([[trackId, next]])) });
}

export function reorderTracks(project: MidiProject, orderedIds: readonly TrackId[], label = 'トラックを並べ替え'): Command | null {
  if (orderedIds.length !== project.tracks.length || new Set(orderedIds).size !== orderedIds.length) throw new EditError('reorder needs every track exactly once');
  const byId = new Map(project.tracks.map((t) => [t.id, t]));
  const tracks = orderedIds.map((id) => {
    const t = byId.get(id);
    if (!t) throw new EditError(`track ${id} not found`);
    return t;
  });
  return cmd(label, { tracks });
}

/** Moves a track up (delta < 0) or down (delta > 0) by |delta| places; null at the ends. */
export function moveTrack(project: MidiProject, trackId: TrackId, delta: number): Command | null {
  const from = project.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) throw new EditError(`track ${trackId} not found`);
  const to = Math.max(0, Math.min(project.tracks.length - 1, from + Math.trunc(delta)));
  if (to === from) return null;
  const ids = project.tracks.map((t) => t.id);
  ids.splice(to, 0, ...ids.splice(from, 1));
  return reorderTracks(project, ids, delta < 0 ? 'トラックを上へ移動' : 'トラックを下へ移動');
}

export function duplicateTrack(project: MidiProject, trackId: TrackId, label = 'トラックを複製'): { command: Command; trackId: string } {
  const src = findTrack(project, trackId);
  let next = project.nextOriginOrder;
  const idMap = new Map<string, string>();
  const events = src.events.map((e) => {
    const id = newId('evt');
    idMap.set(e.id, id);
    const copy = { ...e, id, originOrder: next++ } as MidiEvent;
    return copy.kind === 'note' && copy.releaseOrder !== undefined ? dropReleaseOrder(copy) : copy;
  });
  const dup: MidiTrack = { ...src, id: newId('trk'), name: t('{name} (コピー)', { name: src.name }), events: sortEvents(events), solo: false };
  const tracks = [...project.tracks];
  tracks.splice(project.tracks.indexOf(src) + 1, 0, dup);
  const clips = [
    ...project.clips,
    ...project.clips.filter((c) => c.trackId === trackId).map((c) => ({ ...c, id: newId('clp'), trackId: dup.id, eventIds: c.eventIds.map((id) => idMap.get(id)!).filter(Boolean) })),
  ];
  return { command: cmd(label, { tracks, clips, nextOriginOrder: next }), trackId: dup.id };
}

/**
 * Track order: SysEx-only setup tracks first, then tracks with channel data by port and channel
 * (A1..A16, B1..), then empty / meta-only tracks last (their channel is only a default).
 * Equal keys keep their current order.
 */
export function tracksInChannelOrder(tracks: readonly MidiTrack[]): MidiTrack[] {
  const group = (t: MidiTrack) => {
    const channelData = t.events.some((e) => e.kind !== 'sysex' && e.kind !== 'meta');
    if (channelData) return 1;
    return t.events.some((e) => e.kind === 'sysex') ? 0 : 2;
  };
  return tracks
    .map((t, i) => ({ t, i, g: group(t) }))
    .sort((a, b) => a.g - b.g || (a.g === 1 ? portIndex(a.t.port) - portIndex(b.t.port) || a.t.channel - b.t.channel : 0) || a.i - b.i)
    .map((x) => x.t);
}

export function sortTracksByChannel(project: MidiProject, label = 'トラックをチャンネル順に並べ替え'): Command | null {
  const sorted = tracksInChannelOrder(project.tracks);
  if (sorted.every((t, i) => t === project.tracks[i])) return null;
  return cmd(label, { tracks: sorted });
}

/** Index where a new track with this port / channel belongs in channel order (after equal ones). */
/**
 * First channel of `port` no track uses, skipping channel 10 (drums), or null when every one is taken
 * (shared by トラックを追加 and the new guitar track, ADR-092 review).
 */
export function freeChannel(project: MidiProject, port = 'A'): number | null {
  const used = new Set(project.tracks.filter((t) => t.port === port).map((t) => t.channel));
  return [...Array(16).keys()].find((c) => c !== 9 && !used.has(c)) ?? null;
}

export function channelInsertIndex(project: MidiProject, port: string, channel: number): number {
  const key = portIndex(port) * 16 + channel;
  const i = project.tracks.findIndex((t) => portIndex(t.port) * 16 + t.channel > key);
  return i < 0 ? project.tracks.length : i;
}
