// Copy / paste of events (REQ-PRJ-07). The clipboard holds events relative to the earliest copied
// tick, without IDs; pasting creates new events (new IDs and origin orders).
import type { MidiEvent, MidiProject } from '../model/types';
import { compareEvents } from '../events/order';
import { addEvents, type NewEvent } from './operations';
import type { Command } from './history';

export interface ClipboardData {
  ppq: number;
  events: NewEvent[];
  /** length of the copied range in ticks (for repeated paste) */
  span: number;
}

export function copyEvents(project: MidiProject, ids: Iterable<string>): ClipboardData | null {
  const sel = new Set(ids);
  const picked: MidiEvent[] = project.tracks.flatMap((t) => t.events.filter((e) => sel.has(e.id))).sort(compareEvents);
  if (picked.length === 0) return null;
  const base = picked[0].tick;
  let end = 0;
  const events = picked.map((e) => {
    const { id: _id, originOrder: _o, ...rest } = e;
    void _id;
    void _o;
    const copy = { ...rest, tick: e.tick - base } as NewEvent & { releaseOrder?: number };
    delete copy.releaseOrder;
    end = Math.max(end, e.kind === 'note' ? e.tick + e.durationTicks - base : e.tick - base + 1);
    return copy as NewEvent;
  });
  return { ppq: project.ppq, events, span: end };
}

/** Pastes at `tick` into a track. Events from a project with another PPQ are scaled only when exact. */
export function pasteEvents(project: MidiProject, trackId: string, tick: number, data: ClipboardData): { command: Command; ids: string[] } | null {
  const scale = (v: number) => (v * project.ppq) / data.ppq;
  const events = data.events.map((e) => {
    const t = scale(e.tick);
    const d = e.kind === 'note' ? scale(e.durationTicks) : 0;
    if (!Number.isInteger(t) || !Number.isInteger(d)) throw new Error('PPQ の異なる曲からの貼り付けで Tick が整数になりません。');
    return { ...e, tick: tick + t, ...(e.kind === 'note' ? { durationTicks: Math.max(1, d) } : {}) } as NewEvent;
  });
  return addEvents(project, trackId, events, { label: '貼り付け' });
}
