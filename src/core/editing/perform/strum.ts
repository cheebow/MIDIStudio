// Strum (PT-02, ADR-078). The chords keep their rhythm and notes; the strings (low to high pitch)
// are spread in time by the stroke direction, which follows the hand's up / down motion over the
// bar (eighth or sixteenth grid, rests included) rather than alternating per chord. (The cutting
// style was removed: without mute strokes it only sounded like a shortened strum.)
import type { MidiProject, NoteEvent } from '../../model/types';
import type { TimeSignatureMap } from '../../timing/timeSignatureMap';
import { updateEvents } from '../operations';
import { seededRandom } from '../humanize';
import { t } from '../../../i18n';
import { barStartOf, chordGroups, clampVelocity, groupByOnset, msToTicks, playedChordRule, signatureMapOf, tempoMapOf, type ChordGroup } from './chords';
import type { TransformResult } from './types';

export type StrokeMode = 'auto' | 'down' | 'up';
export type StrumSpeed = 'slow' | 'normal' | 'fast';
export type Stroke = 'down' | 'up';

export interface StrumOptions {
  stroke: StrokeMode;
  speed: StrumSpeed;
  /** small timing jitter and a per-string velocity taper (fixed seed) */
  natural: boolean;
}

/** Whole-strum width (first to last string) per speed, in milliseconds (spec 4.4.4). */
export const STRUM_WIDTH_MS: Record<StrumSpeed, number> = { fast: 20, normal: 45, slow: 85 };
/** Jitter of each string's offset as a part of the string step (natural = on). */
export const STRUM_JITTER = 0.15;
/** Per-string velocity taper (natural = on): the n-th string sounds (1 - n * taper) as loud. */
export const STRUM_TAPER = 0.02;
/** Up strokes are lighter than down strokes (natural = on). */
export const UP_STROKE_GAIN = 0.92;
/**
 * Already-spread chords stay one chord: a note joins the chord when it starts within this many ms
 * of the chord's previous note (time based, like the strum widths), the chord has not grown wider
 * than `STRUM_GROUP_SPREAD_MS`, and the pitch is not in the chord yet (a repeated chord is a new one).
 */
export const STRUM_GROUP_GAP_MS = 40;
export const STRUM_GROUP_SPREAD_MS = 120;

/**
 * Stroke directions of chord onsets from their place in the bar: the hand moves down on even and
 * up on odd eighths (sixteenths when any onset sits on an odd sixteenth), rests included, so the
 * first selected chord is not automatically a down stroke (spec 4.3).
 */
export function detectStrokes(signature: TimeSignatureMap, ppq: number, ticks: readonly number[]): Stroke[] {
  const sixteenth = ppq / 4;
  const positions = ticks.map((tick) => tick - barStartOf(signature, tick));
  const fine = positions.some((pos) => {
    const idx = Math.round(pos / sixteenth);
    return Math.abs(pos - idx * sixteenth) <= ppq / 16 && idx % 2 === 1;
  });
  const unit = fine ? sixteenth : ppq / 2;
  return positions.map((pos) => (Math.round(pos / unit) % 2 === 0 ? 'down' : 'up'));
}

export function strumChords(project: MidiProject, ids: Iterable<string>, opts: StrumOptions): TransformResult {
  const tempo = tempoMapOf(project);
  const signature = signatureMapOf(project);
  // wider than a played chord: a strum this tool made (up to 85 ms) is still one chord
  const joins = playedChordRule(project, tempo, STRUM_GROUP_GAP_MS, STRUM_GROUP_SPREAD_MS, Infinity);
  const played = playedChordRule(project, tempo);
  const updates: { id: string; changes: Partial<NoteEvent> }[] = [];
  const all: string[] = [];
  let notes = 0;
  let groups = 0;
  let spread = 0;
  for (const list of chordGroups(project, ids, joins)) {
    const strokes = opts.stroke === 'auto' ? detectStrokes(signature, project.ppq, list.map((g) => g.tick)) : list.map(() => opts.stroke as Stroke);
    list.forEach((g, i) => {
      groups++;
      notes += g.notes.length;
      for (const n of g.notes) all.push(n.id);
      // wider than a played chord: probably strummed already (re-applying recomputes from its first note)
      if (groupByOnset(g.trackId, g.clipId, g.notes, played).length > 1) spread++;
      const next: ChordGroup | undefined = list[i + 1];
      const gap = next ? next.tick - g.tick : Infinity;
      const stroke = strokes[i];
      const order = [...g.notes].sort((a, b) => (stroke === 'down' ? a.pitch - b.pitch : b.pitch - a.pitch) || (a.id < b.id ? -1 : 1));
      const n = order.length;
      // the spread never takes more than half of what the chord has (its length or the time to the next chord)
      const width = Math.min(msToTicks(STRUM_WIDTH_MS[opts.speed], g.tick, tempo), Math.floor(Math.min(gap, g.endTick - g.tick) / 2));
      const step = n > 1 ? width / (n - 1) : 0;
      const rnd = seededRandom(g.tick * 31 + n);
      const strokeGain = opts.natural && stroke === 'up' ? UP_STROKE_GAIN : 1;
      let prev = 0;
      order.forEach((note, s) => {
        const jitter = opts.natural && n > 1 ? (rnd() * 2 - 1) * STRUM_JITTER * step : 0;
        const offset = s === 0 ? 0 : Math.max(prev, Math.round(step * s + jitter));
        prev = offset;
        const tick = g.tick + offset;
        const end = note.tick + note.durationTicks; // the end stays: a later string sounds a little shorter
        const durationTicks = Math.max(1, end - tick);
        const velocity = clampVelocity(note.velocity * strokeGain * (opts.natural ? 1 - STRUM_TAPER * s : 1));
        const changes: Partial<NoteEvent> = {};
        if (tick !== note.tick) changes.tick = tick;
        if (durationTicks !== note.durationTicks) changes.durationTicks = durationTicks;
        if (velocity !== note.velocity) changes.velocity = velocity;
        if (Object.keys(changes).length) updates.push({ id: note.id, changes });
      });
    });
  }
  const command = updates.length ? updateEvents(project, updates, 'ストラム') : null;
  const notice = spread > 0 ? t('{n} 個の和音はすでに広がっていたので、先頭の音の位置を基準にしました。', { n: spread }) : null;
  return { command, ids: all, notice, stats: { notes, groups, skipped: 0 } };
}
