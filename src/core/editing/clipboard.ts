// Copy / paste of events (REQ-PRJ-07) and of clips (ADR-057). The clipboard holds events relative
// to the earliest copied tick, without IDs; pasting creates new events (new IDs and origin orders).
// When clips were copied, `clips` keeps their ranges and tracks so a paste rebuilds the regions;
// `events` still holds every copied event flat, so a note editor can paste the same clipboard.
import type { MidiClip, MidiEvent, MidiProject, TrackId } from '../model/types';
import { newId } from '../model/ids';
import { compareEvents } from '../events/order';
import { addEvents, type NewEvent } from './operations';
import type { Command, ProjectPatch } from './history';
import { t } from '../../i18n';

export interface ClipboardClip {
  /** source track: a paste goes back to it while it exists */
  trackId: TrackId;
  /** source track index (for pasting the group onto other tracks by offset) */
  trackIndex: number;
  /** range relative to the clipboard base tick */
  startTick: number;
  endTick: number;
  name?: string;
  color?: string;
  /** the clip's events, relative to the clipboard base tick */
  events: NewEvent[];
}

export interface ClipboardData {
  ppq: number;
  events: NewEvent[];
  /** length of the copied range in ticks (for repeated paste) */
  span: number;
  /** present when clips (regions) were copied */
  clips?: ClipboardClip[];
}

function relative(e: MidiEvent, base: number): NewEvent {
  const { id: _id, originOrder: _o, ...rest } = e;
  void _id;
  void _o;
  const copy = { ...rest, tick: e.tick - base } as NewEvent & { releaseOrder?: number };
  delete copy.releaseOrder;
  return copy as NewEvent;
}

export function copyEvents(project: MidiProject, ids: Iterable<string>): ClipboardData | null {
  const sel = new Set(ids);
  const picked: MidiEvent[] = project.tracks.flatMap((t) => t.events.filter((e) => sel.has(e.id))).sort(compareEvents);
  if (picked.length === 0) return null;
  const base = picked[0].tick;
  let end = 0;
  const events = picked.map((e) => {
    end = Math.max(end, e.kind === 'note' ? e.tick + e.durationTicks - base : e.tick - base + 1);
    return relative(e, base);
  });
  return { ppq: project.ppq, events, span: end };
}

/** Copies clips with their events. The base is the earliest clip start; the span runs to the latest clip end. */
export function copyClips(project: MidiProject, clipIds: Iterable<string>): ClipboardData | null {
  const sel = new Set(clipIds);
  const clips = project.clips.filter((c) => sel.has(c.id)).sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
  if (clips.length === 0) return null;
  const base = clips[0].startTick;
  const items: ClipboardClip[] = clips.map((c) => {
    const track = project.tracks.find((t) => t.id === c.trackId);
    const ids = new Set(c.eventIds);
    const events = (track?.events ?? []).filter((e) => ids.has(e.id)).sort(compareEvents).map((e) => relative(e, base));
    return {
      trackId: c.trackId,
      trackIndex: project.tracks.findIndex((t) => t.id === c.trackId),
      startTick: c.startTick - base,
      endTick: c.endTick - base,
      ...(c.name !== undefined ? { name: c.name } : {}),
      ...(c.color !== undefined ? { color: c.color } : {}),
      events,
    };
  });
  return { ppq: project.ppq, events: items.flatMap((c) => c.events), span: Math.max(...clips.map((c) => c.endTick)) - base, clips: items };
}

function scaleTo(project: MidiProject, data: ClipboardData, v: number): number {
  const r = (v * project.ppq) / data.ppq;
  if (!Number.isInteger(r)) throw new Error(t('PPQ の異なる曲からの貼り付けで Tick が整数になりません。'));
  return r;
}

function shifted(project: MidiProject, data: ClipboardData, events: readonly NewEvent[], tick: number): NewEvent[] {
  return events.map((e) => {
    const t = scaleTo(project, data, e.tick);
    const d = e.kind === 'note' ? scaleTo(project, data, e.durationTicks) : 0;
    return { ...e, tick: tick + t, ...(e.kind === 'note' ? { durationTicks: Math.max(1, d) } : {}) } as NewEvent;
  });
}

/** Pastes at `tick` into a track. Events from a project with another PPQ are scaled only when exact. */
export function pasteEvents(project: MidiProject, trackId: string, tick: number, data: ClipboardData): { command: Command; ids: string[] } | null {
  return addEvents(project, trackId, shifted(project, data, data.events, tick), { label: '貼り付け' });
}

/**
 * Pastes copied clips so that the earliest one starts at `tick`, each onto the track `trackFor`
 * chooses (a clip whose target is undefined or missing is skipped). One command, one undo step.
 */
export function pasteClips(project: MidiProject, tick: number, data: ClipboardData, trackFor: (clip: ClipboardClip) => TrackId | undefined, label = '貼り付け'): { command: Command; clipIds: string[] } | null {
  if (!data.clips || data.clips.length === 0) return null;
  if (!Number.isSafeInteger(tick) || tick < 0) throw new Error(t('貼り付け位置が不正です。'));
  let p = project;
  const patch: ProjectPatch = {};
  const clipIds: string[] = [];
  for (const item of data.clips) {
    const trackId = trackFor(item);
    if (!trackId || !p.tracks.some((t) => t.id === trackId)) continue;
    const clip: MidiClip = {
      id: newId('clp'),
      trackId,
      startTick: tick + scaleTo(project, data, item.startTick),
      endTick: tick + scaleTo(project, data, item.endTick),
      eventIds: [],
      ...(item.name !== undefined ? { name: item.name } : {}),
      ...(item.color !== undefined ? { color: item.color } : {}),
    };
    p = { ...p, clips: [...p.clips, clip] };
    patch.clips = p.clips;
    const r = addEvents(p, trackId, shifted(project, data, item.events, tick), { clipId: clip.id, label });
    if (r) {
      p = { ...p, ...r.command.patch };
      Object.assign(patch, r.command.patch);
    }
    clipIds.push(clip.id);
  }
  if (clipIds.length === 0) return null;
  return { command: { label, patch }, clipIds };
}

/**
 * Duplicates clips as a group: by default right after the group (its span), or shifted by
 * `deltaTick` from where they are and by `trackOffset` lanes (clamped to the track list).
 */
export function duplicateClips(project: MidiProject, clipIds: Iterable<string>, opts: { deltaTick?: number; trackOffset?: number } = {}): { command: Command; clipIds: string[] } | null {
  const sel = new Set(clipIds);
  const data = copyClips(project, sel);
  if (!data) return null;
  const base = Math.min(...project.clips.filter((c) => sel.has(c.id)).map((c) => c.startTick));
  const offset = opts.trackOffset ?? 0;
  const last = project.tracks.length - 1;
  return pasteClips(project, base + (opts.deltaTick ?? data.span), data, (c) => project.tracks[Math.max(0, Math.min(last, c.trackIndex + offset))]?.id, 'クリップを複製');
}
