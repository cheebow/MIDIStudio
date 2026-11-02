// Velocity edits for a set of notes (ADR-050): set, add, scale, or a ramp over time.
import type { MidiProject, NoteEvent } from '../model/types';
import { updateEvents } from './operations';
import type { Command } from './history';

export type VelocityOp =
  | { kind: 'set'; value: number }
  | { kind: 'add'; delta: number }
  | { kind: 'scale'; percent: number }
  /** linear from `from` at the earliest selected note to `to` at the latest (by onset tick) */
  | { kind: 'ramp'; from: number; to: number };

const clampVelocity = (v: number) => Math.max(1, Math.min(127, Math.round(v)));

export function editVelocities(project: MidiProject, ids: Iterable<string>, op: VelocityOp): Command | null {
  const sel = new Set(ids);
  const notes: NoteEvent[] = [];
  for (const t of project.tracks) for (const e of t.events) if (e.kind === 'note' && sel.has(e.id)) notes.push(e);
  if (notes.length === 0) return null;
  let minTick = Infinity;
  let maxTick = -Infinity;
  for (const n of notes) {
    minTick = Math.min(minTick, n.tick);
    maxTick = Math.max(maxTick, n.tick);
  }
  const target = (n: NoteEvent): number => {
    switch (op.kind) {
      case 'set':
        return op.value;
      case 'add':
        return n.velocity + op.delta;
      case 'scale':
        return (n.velocity * op.percent) / 100;
      case 'ramp': {
        const p = maxTick === minTick ? 1 : (n.tick - minTick) / (maxTick - minTick);
        return op.from + (op.to - op.from) * p;
      }
    }
  };
  const updates = notes.map((n) => ({ id: n.id, velocity: clampVelocity(target(n)), was: n.velocity })).filter((u) => u.velocity !== u.was);
  return updates.length > 0 ? updateEvents(project, updates.map((u) => ({ id: u.id, changes: { velocity: u.velocity } })), 'ベロシティを変更') : null;
}
