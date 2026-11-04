// Velocity shaper (PT-05, ADR-076): a musical gain curve over the selected notes. Only velocities
// change, every note of a chord gets the same factor, so the original balance survives.
import type { MidiProject, NoteEvent } from '../../model/types';
import type { BarBeat } from '../../timing/timeSignatureMap';
import { updateEvents } from '../operations';
import { t } from '../../../i18n';
import { clampVelocity, selectedNoteLists, signatureMapOf, sortNotes } from './chords';
import type { TransformResult } from './types';

export type VelocityShape = 'crescendo' | 'decrescendo' | 'alternate' | 'beat';

export interface VelocityShaperOptions {
  shape: VelocityShape;
}

/** Internal constants (docs/PERFORMANCE_TOOLS_SPEC.md 7.2: ±10–20 %). */
export const SHAPER_GAIN = {
  /** crescendo runs from `rampLow` at the first onset to `rampHigh` at the last (decrescendo the reverse) */
  rampLow: 0.85,
  rampHigh: 1.15,
  /** alternate accent: even onset groups / odd onset groups */
  alternateStrong: 1.1,
  alternateWeak: 0.9,
  /** beat accent */
  downbeat: 1.15,
  secondaryBeat: 1.07,
  otherBeat: 1.0,
  offBeat: 0.9,
} as const;

/** Gain of a position by its place in the bar: downbeat, secondary strong beat, other beats, off the beat. */
export function beatGain(bb: BarBeat): number {
  if (bb.tickInBeat > 1e-9) return SHAPER_GAIN.offBeat;
  if (bb.beat === 1) return SHAPER_GAIN.downbeat;
  const { numerator: n, denominator: d, beat } = bb;
  // 6/8, 9/8, 12/8: every third eighth; 4/4, 6/4, 2/2...: the middle of the bar
  const secondary = d >= 8 && n % 3 === 0 ? (beat - 1) % 3 === 0 : n % 2 === 0 && n >= 4 && beat === n / 2 + 1;
  return secondary ? SHAPER_GAIN.secondaryBeat : SHAPER_GAIN.otherBeat;
}

export function shapeVelocities(project: MidiProject, ids: Iterable<string>, opts: VelocityShaperOptions): TransformResult {
  // groups span tracks: a chord played by two tracks still swells together
  const notes = sortNotes(selectedNoteLists(project, ids).flatMap((l) => l.notes));
  const all = notes.map((n) => n.id);
  if (notes.length === 0) return { command: null, ids: all, notice: null, stats: { notes: 0, groups: 0, skipped: 0 } };
  const onsets: number[] = [];
  for (const n of notes) if (onsets.length === 0 || onsets[onsets.length - 1] !== n.tick) onsets.push(n.tick);
  const first = onsets[0];
  const last = onsets[onsets.length - 1];
  if ((opts.shape === 'crescendo' || opts.shape === 'decrescendo') && first === last) {
    return { command: null, ids: all, notice: t('選択したノートがすべて同じ位置なので、強弱の流れを作れません。'), stats: { notes: notes.length, groups: 1, skipped: notes.length } };
  }
  const signature = opts.shape === 'beat' ? signatureMapOf(project) : null;
  const gainAt = new Map<number, number>();
  onsets.forEach((tick, i) => {
    let g: number;
    switch (opts.shape) {
      case 'crescendo':
      case 'decrescendo': {
        const p = (tick - first) / (last - first);
        const up = SHAPER_GAIN.rampLow + (SHAPER_GAIN.rampHigh - SHAPER_GAIN.rampLow) * p;
        g = opts.shape === 'crescendo' ? up : SHAPER_GAIN.rampHigh + SHAPER_GAIN.rampLow - up;
        break;
      }
      case 'alternate':
        g = i % 2 === 0 ? SHAPER_GAIN.alternateStrong : SHAPER_GAIN.alternateWeak;
        break;
      case 'beat':
        g = beatGain(signature!.tickToBarBeat(tick));
        break;
    }
    gainAt.set(tick, g);
  });
  const updates: { id: string; changes: Partial<NoteEvent> }[] = [];
  for (const n of notes) {
    const v = clampVelocity(n.velocity * gainAt.get(n.tick)!);
    if (v !== n.velocity) updates.push({ id: n.id, changes: { velocity: v } });
  }
  return { command: updates.length ? updateEvents(project, updates, 'ベロシティ・シェイパー') : null, ids: all, notice: null, stats: { notes: notes.length, groups: onsets.length, skipped: 0 } };
}
