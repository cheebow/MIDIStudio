// Arpeggio (PT-03, ADR-077; rhythm and ends added in ADR-092): each selected chord becomes a broken
// chord inside its own span (chord end or next chord onset, whichever comes first). Original notes
// keep their ids; extra steps (the turning notes of "up and down", repeats of a note-value rhythm)
// are new notes in the same clip.
//   rhythm 'even': the span is shared equally by the pattern's notes (one pass).
//   rhythm '8', '16t'...: one step per note value from the chord start, the pattern repeating until
//     the span ends.
//   ends 'gate': each step sounds for ARPEGGIO_GATE of its slot (broken chord).
//   ends 'hold': each step sounds to the end of the span (a slow strum), or until the same pitch is
//     struck again.
import type { MidiProject, NoteEvent } from '../../model/types';
import { addEvents, compose, updateEvents, type NewEvent } from '../operations';
import { t } from '../../../i18n';
import { chordGroups } from './chords';
import type { TransformResult } from './types';

export type ArpeggioPattern = 'up' | 'down' | 'updown';
export type ArpeggioRhythm = 'even' | '4' | '8' | '8t' | '16' | '16t' | '32';
export type ArpeggioEnds = 'gate' | 'hold';

export interface ArpeggioOptions {
  pattern: ArpeggioPattern;
  /** default 'even' */
  rhythm?: ArpeggioRhythm;
  /** default 'gate' */
  ends?: ArpeggioEnds;
}

/** Ticks of a note-value rhythm at a PPQ (the quarter note = PPQ). */
const ARPEGGIO_STEPS_PER_QUARTER: Record<Exclude<ArpeggioRhythm, 'even'>, number> = { '4': 1, '8': 2, '8t': 3, '16': 4, '16t': 6, '32': 8 };

export function arpeggioStepTicks(rhythm: Exclude<ArpeggioRhythm, 'even'>, ppq: number): number {
  return Math.max(1, Math.round(ppq / ARPEGGIO_STEPS_PER_QUARTER[rhythm]));
}

/** Each step sounds for this part of its slot (the rest is a small gap). */
export const ARPEGGIO_GATE = 0.8;

export function arpeggiateChords(project: MidiProject, ids: Iterable<string>, opts: ArpeggioOptions): TransformResult {
  const updates: { id: string; changes: Partial<NoteEvent> }[] = [];
  const added: { trackId: string; clipId: string | undefined; events: NewEvent[] }[] = [];
  const all: string[] = [];
  let notes = 0;
  let groups = 0;
  let single = 0;
  let tooShort = 0;
  /** note value too long for every note of the chord to sound once */
  let tooLong = 0;
  const rhythm = opts.rhythm ?? 'even';
  const hold = opts.ends === 'hold';
  for (const list of chordGroups(project, ids)) {
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      groups++;
      notes += g.notes.length;
      for (const n of g.notes) all.push(n.id);
      if (g.notes.length < 2) {
        single++;
        continue;
      }
      const next = list[i + 1];
      const span = Math.min(g.endTick, next ? next.tick : Infinity) - g.tick;
      const asc = [...g.notes].sort((a, b) => a.pitch - b.pitch);
      const seq = opts.pattern === 'up' ? asc : opts.pattern === 'down' ? [...asc].reverse() : asc.length > 2 ? [...asc, ...[...asc].reverse().slice(1, -1)] : asc;
      const k = seq.length;
      // onsets of the steps (relative to the chord); step j plays seq[j % k]
      let onsets: number[];
      if (rhythm === 'even') {
        if (span < k) {
          tooShort++;
          continue;
        }
        onsets = Array.from({ length: k }, (_, j) => Math.floor((span * j) / k));
      } else {
        // each onset is rounded on its own: adding up a rounded step drifts off the beat when the
        // PPQ is not a multiple of the note value (32nds at PPQ 100)
        const per = ARPEGGIO_STEPS_PER_QUARTER[rhythm];
        onsets = [];
        for (let j = 0, o = 0; o < span; o = Math.round((++j * project.ppq) / per)) if (onsets[onsets.length - 1] !== o) onsets.push(o);
        // every note of the chord must sound at least once (or it would stay where it was); the
        // pattern itself may stop part-way (a 6-string up-and-down in eight 8ths turns after 6)
        if (onsets.length < g.notes.length) {
          tooLong++;
          continue;
        }
      }
      const used = new Set<string>();
      const extra: NewEvent[] = [];
      for (let j = 0; j < onsets.length; j++) {
        const on = g.tick + onsets[j];
        const nextOn = g.tick + (j + 1 < onsets.length ? onsets[j + 1] : span);
        const src = seq[j % k];
        let duration: number;
        if (hold) {
          // to the end of the span, or to where the same pitch is struck again
          const again = onsets.findIndex((_, m) => m > j && seq[m % k].pitch === src.pitch);
          duration = Math.max(1, (again >= 0 ? g.tick + onsets[again] : g.tick + span) - on);
        } else duration = Math.max(1, Math.floor((nextOn - on) * ARPEGGIO_GATE));
        if (!used.has(src.id)) {
          used.add(src.id);
          if (on !== src.tick || duration !== src.durationTicks) updates.push({ id: src.id, changes: { tick: on, durationTicks: duration } });
        } else {
          extra.push({ kind: 'note', tick: on, pitch: src.pitch, velocity: src.velocity, durationTicks: duration, releaseVelocity: src.releaseVelocity, ...(src.channelOverride !== undefined ? { channelOverride: src.channelOverride } : {}) });
        }
      }
      if (extra.length) added.push({ trackId: g.trackId, clipId: g.clipId, events: extra });
    }
  }
  const newIds: string[] = [];
  const command =
    updates.length || added.length
      ? compose(project, 'アルペジオ', [
          (p) => updateEvents(p, updates, 'アルペジオ'),
          ...added.map((a) => (p: MidiProject) => {
            const r = addEvents(p, a.trackId, a.events, { clipId: a.clipId, label: 'アルペジオ' });
            if (r) newIds.push(...r.ids);
            return r?.command ?? null;
          }),
        ])
      : null;
  let notice: string | null = null;
  if (tooLong > 0) notice = t('音符が長すぎて全部の音を鳴らせない和音 {n} 個は、そのままにしました。短い音符にしてください。', { n: tooLong });
  else if (tooShort > 0) notice = t('短すぎる和音 {n} 個は分散できないので、そのままにしました。', { n: tooShort });
  else if (single > 0 && single === groups) notice = t('和音がありません。同じ位置に 2 つ以上のノートを選んでください。');
  else if (single > 0) notice = t('1 音だけの位置 {n} 個はそのままにしました。', { n: single });
  return { command, ids: [...all, ...newIds], notice, stats: { notes, groups, skipped: single + tooShort + tooLong } };
}

/**
 * The step length (ticks, may be fractional) of every chord the arpeggio would spread, in order:
 * with 'even' the chord's span shared by its pattern, else the note value. Chords it leaves alone
 * (single notes, too short) are not listed. The dialog names these lengths (ADR-092).
 */
export function arpeggioStepLengths(project: MidiProject, ids: Iterable<string>, opts: ArpeggioOptions): number[] {
  const rhythm = opts.rhythm ?? 'even';
  const out: number[] = [];
  for (const list of chordGroups(project, ids)) {
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (g.notes.length < 2) continue;
      const next = list[i + 1];
      const span = Math.min(g.endTick, next ? next.tick : Infinity) - g.tick;
      const n = g.notes.length;
      const k = opts.pattern === 'updown' && n > 2 ? 2 * n - 2 : n;
      if (rhythm === 'even') {
        if (span >= k) out.push(span / k);
      } else {
        const step = arpeggioStepTicks(rhythm, project.ppq);
        if (Math.ceil(span / step) >= n) out.push(step);
      }
    }
  }
  return out;
}

/** Note values the dialog can name, as parts of a quarter note (Japanese labels, shown with t()). */
const NOTE_NAMES: readonly [number, string][] = [
  [4, '全音符'],
  [3, '付点 2 分'],
  [2, '2 分'],
  [1.5, '付点 4 分'],
  [4 / 3, '3 連 2 分'],
  [1, '4 分'],
  [0.75, '付点 8 分'],
  [2 / 3, '3 連 4 分'],
  [0.5, '8 分'],
  [0.375, '付点 16 分'],
  [1 / 3, '3 連 8 分'],
  [0.25, '16 分'],
  [1 / 6, '3 連 16 分'],
  [0.125, '32 分'],
];

/** The name of a note length in ticks ('3 連 4 分'), or null when it is no usual note value. */
export function noteValueName(ticks: number, ppq: number): string | null {
  for (const [quarters, name] of NOTE_NAMES) if (Math.abs(ticks - quarters * ppq) <= 0.5) return name;
  return null;
}
