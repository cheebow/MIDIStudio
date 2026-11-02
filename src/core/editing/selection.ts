// Selection state: event IDs plus track / clip IDs, kept separately (ARCHITECTURE D).
import type { MidiProject } from '../model/types';

export interface Selection {
  eventIds: ReadonlySet<string>;
  trackIds: ReadonlySet<string>;
  clipIds: ReadonlySet<string>;
}

export const EMPTY_SELECTION: Selection = { eventIds: new Set(), trackIds: new Set(), clipIds: new Set() };

export function selectEvents(sel: Selection, ids: Iterable<string>, mode: 'replace' | 'add' | 'toggle' = 'replace'): Selection {
  const next = mode === 'replace' ? new Set<string>() : new Set(sel.eventIds);
  for (const id of ids) {
    if (mode === 'toggle' && next.has(id)) next.delete(id);
    else next.add(id);
  }
  return { ...sel, eventIds: next };
}

/** Removes IDs that no longer exist (after undo, delete, project load). Returns the same object when unchanged. */
export function pruneSelection(sel: Selection, project: MidiProject): Selection {
  const events = new Set<string>();
  for (const t of project.tracks) for (const e of t.events) events.add(e.id);
  const tracks = new Set(project.tracks.map((t) => t.id));
  const clips = new Set(project.clips.map((c) => c.id));
  const keep = (s: ReadonlySet<string>, valid: Set<string>) => {
    let changed = false;
    const out = new Set<string>();
    for (const id of s) {
      if (valid.has(id)) out.add(id);
      else changed = true;
    }
    return changed ? out : s;
  };
  const eventIds = keep(sel.eventIds, events);
  const trackIds = keep(sel.trackIds, tracks);
  const clipIds = keep(sel.clipIds, clips);
  return eventIds === sel.eventIds && trackIds === sel.trackIds && clipIds === sel.clipIds ? sel : { eventIds, trackIds, clipIds };
}
