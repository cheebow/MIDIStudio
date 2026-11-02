// Quantize (REQ-EDT-03, ADR-043). Moves note onsets (and optionally ends) to the grid, with
// strength and shuffle; lengths can be rounded to a multiple of the grid. Inexact grids
// (non-integer tick lines) are refused unless the caller explicitly allows rounding.
import type { MidiProject, NoteEvent, QuantizeSettings } from '../model/types';
import { gridTicks, snapTickSwing } from '../timing/grid';
import type { Rational } from '../timing/rational';
import { updateEvents, EditError } from './operations';
import type { Command } from './history';

export interface QuantizeOptions {
  grid: Rational;
  /** 0..1, 1 = fully onto the grid */
  strength?: number;
  /** shuffle: 50 = straight … 75 = dotted feel (percentage of a two-line pair for the off-beat line) */
  swing?: number;
  /** note ends snap to the grid too (lengths change) */
  quantizeEnds?: boolean;
  /** lengths are then rounded to a multiple of this grid (at least one) */
  lengthGrid?: Rational | null;
  allowRounding?: boolean;
}

/** Options for the quantize dialog's settings (the dialog shows the rounding note itself). */
export function quantizeOptionsFrom(ppq: number, s: QuantizeSettings): QuantizeOptions {
  const grid = gridTicks(ppq, s.grid);
  return { grid, strength: s.strength / 100, swing: s.swing, quantizeEnds: s.lengths === 'ends', lengthGrid: s.lengths === 'grid' ? grid : null, allowRounding: true };
}

export function quantizeNotes(project: MidiProject, ids: Iterable<string>, opts: QuantizeOptions): Command | null {
  if ((opts.grid.den !== 1 || (opts.lengthGrid && opts.lengthGrid.den !== 1)) && !opts.allowRounding) {
    throw new EditError('このグリッドは Tick の整数にならないため、クオンタイズすると位置が丸められます。確認のうえ実行してください。');
  }
  const strength = Math.min(1, Math.max(0, opts.strength ?? 1));
  const swing = opts.swing ?? 50;
  const snap = (tick: number) => snapTickSwing(tick, opts.grid, swing).tick;
  const lengthUnit = opts.lengthGrid ? opts.lengthGrid.num / opts.lengthGrid.den : 0;
  const sel = new Set(ids);
  const updates: { id: string; changes: Partial<NoteEvent> }[] = [];
  for (const t of project.tracks) {
    for (const e of t.events) {
      if (e.kind !== 'note' || !sel.has(e.id)) continue;
      const on = snap(e.tick);
      const newOn = Math.round(e.tick + (on - e.tick) * strength);
      let end = e.tick + e.durationTicks;
      if (opts.quantizeEnds) {
        const q = snap(end);
        end = Math.round(end + (q - end) * strength);
      } else end = newOn + e.durationTicks;
      if (lengthUnit > 0) end = newOn + Math.round(Math.max(1, Math.round((end - newOn) / lengthUnit)) * lengthUnit);
      const duration = Math.max(1, end - newOn);
      if (newOn !== e.tick || duration !== e.durationTicks) updates.push({ id: e.id, changes: { tick: newOn, durationTicks: duration } });
    }
  }
  return updates.length > 0 ? updateEvents(project, updates, 'クオンタイズ') : null;
}
