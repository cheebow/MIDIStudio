// Humanize (ADR-050): random offsets of timing, velocity and length within the given ranges.
// The random source is seedable so the result is reproducible in tests.
import type { MidiProject, NoteEvent } from '../model/types';
import { updateEvents } from './operations';
import type { Command } from './history';

export interface HumanizeOptions {
  /** onsets move by up to ± this many ticks (0 = keep) */
  timingTicks: number;
  /** velocities move by up to ± this (0 = keep) */
  velocity: number;
  /** lengths change by up to ± this percent (0 = keep) */
  lengthPercent: number;
  /** for reproducible results; default: time-based */
  seed?: number;
}

/** Small deterministic PRNG (mulberry32): returns values in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function humanizeNotes(project: MidiProject, ids: Iterable<string>, opts: HumanizeOptions): Command | null {
  const rnd = seededRandom(opts.seed ?? Date.now());
  const spread = (range: number) => (range <= 0 ? 0 : (rnd() * 2 - 1) * range);
  const sel = new Set(ids);
  const updates: { id: string; changes: Partial<NoteEvent> }[] = [];
  for (const t of project.tracks) {
    for (const e of t.events) {
      if (e.kind !== 'note' || !sel.has(e.id)) continue;
      const tick = Math.max(0, Math.round(e.tick + spread(opts.timingTicks)));
      const velocity = Math.max(1, Math.min(127, Math.round(e.velocity + spread(opts.velocity))));
      const durationTicks = Math.max(1, Math.round(e.durationTicks * (1 + spread(opts.lengthPercent) / 100)));
      const changes: Partial<NoteEvent> = {};
      if (tick !== e.tick) changes.tick = tick;
      if (velocity !== e.velocity) changes.velocity = velocity;
      if (durationTicks !== e.durationTicks) changes.durationTicks = durationTicks;
      if (Object.keys(changes).length) updates.push({ id: e.id, changes });
    }
  }
  return updates.length > 0 ? updateEvents(project, updates, 'ヒューマナイズ') : null;
}
