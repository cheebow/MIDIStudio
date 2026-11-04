// Guitar voicing (PT-01, ADR-079): each selected chord (same onset) is recognised by its pitch
// classes and replaced by the notes of a playable form from the library. Unknown chords stay as
// they are and are counted for the dialog.
import type { MidiProject, NoteEvent } from '../../model/types';
import { addEvents, compose, deleteEvents, updateEvents, type NewEvent } from '../operations';
import { t } from '../../../i18n';
import { chordGroups, median } from './chords';
import { chordName, formPitches, formsFor, frettedFrets, QUALITY_INTERVALS, type ChordForm, type ChordQuality } from './chordForms';
import type { TransformResult } from './types';

export type VoicingPreset = 'auto' | 'open' | 'high';

export interface VoicingOptions {
  voicing: VoicingPreset;
}

export interface RecognizedChord {
  root: number;
  quality: ChordQuality;
  name: string;
}

const QUALITY_ORDER: readonly ChordQuality[] = ['maj', 'min', '7', 'maj7', 'm7', 'sus4', 'sus2', 'dim', 'aug'];
const SEVENTHS = new Set<ChordQuality>(['7', 'maj7', 'm7']);

/**
 * Root and quality of a set of pitches, or null. Seventh chords may omit the fifth. When several
 * readings fit (sus2 / sus4, augmented), the lowest note's pitch class wins as the root.
 */
export function recognizeChord(pitches: readonly number[]): RecognizedChord | null {
  if (pitches.length === 0) return null;
  const pcs = new Set(pitches.map((p) => ((p % 12) + 12) % 12));
  if (pcs.size < 3 || pcs.size > 4) return null;
  const lowest = ((Math.min(...pitches) % 12) + 12) % 12;
  const found: RecognizedChord[] = [];
  for (let root = 0; root < 12; root++) {
    for (const quality of QUALITY_ORDER) {
      const full = QUALITY_INTERVALS[quality].map((i) => (root + i) % 12);
      const matches = (set: number[]) => set.length === pcs.size && set.every((x) => pcs.has(x));
      if (matches(full) || (SEVENTHS.has(quality) && matches(full.filter((x) => x !== (root + 7) % 12)))) found.push({ root, quality, name: chordName(root, quality) });
    }
  }
  if (found.length === 0) return null;
  return found.find((c) => c.root === lowest) ?? found[0];
}

/** Scoring weights (lower is better); see ADR-079. */
export const VOICING_SCORE = { barre: 3, openBarre: 8, highBelow: 5, highPenalty: 3, bassDistance: 2, move: 1.5 } as const;

function averageFret(form: ChordForm): number {
  const f = frettedFrets(form);
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0;
}

export function scoreForm(form: ChordForm, preset: VoicingPreset, lowestInput: number, previous: ChordForm | null): number {
  const avg = averageFret(form);
  // "high" does not mind barre chords: they are how high positions are played
  let score = avg + (form.barre && preset !== 'high' ? VOICING_SCORE.barre : 0);
  score += (Math.abs(Math.min(...formPitches(form)) - lowestInput) / 12) * VOICING_SCORE.bassDistance;
  if (previous) score += Math.abs(avg - averageFret(previous)) * VOICING_SCORE.move;
  if (preset === 'open' && form.barre) score += VOICING_SCORE.openBarre;
  if (preset === 'high' && avg < VOICING_SCORE.highBelow) score += (VOICING_SCORE.highBelow - avg) * VOICING_SCORE.highPenalty;
  return score;
}

export function chooseForm(chord: RecognizedChord, preset: VoicingPreset, lowestInput: number, previous: ChordForm | null): ChordForm | null {
  let best: ChordForm | null = null;
  let bestScore = Infinity;
  for (const f of formsFor(chord.root, chord.quality)) {
    const s = scoreForm(f, preset, lowestInput, previous);
    if (s < bestScore) {
      best = f;
      bestScore = s;
    }
  }
  return best;
}

export function voiceChords(project: MidiProject, ids: Iterable<string>, opts: VoicingOptions): TransformResult {
  const updates: { id: string; changes: Partial<NoteEvent> }[] = [];
  const added: { trackId: string; clipId: string | undefined; events: NewEvent[] }[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  let notes = 0;
  let groups = 0;
  let unknown = 0;
  for (const list of chordGroups(project, ids, 0)) {
    let previous: ChordForm | null = null;
    const chosen = new Map<string, ChordForm>(); // same chord name -> same form within the selection
    for (const g of list) {
      groups++;
      notes += g.notes.length;
      const chord = recognizeChord(g.notes.map((n) => n.pitch));
      const form: ChordForm | null = chord ? (chosen.get(chord.name) ?? chooseForm(chord, opts.voicing, Math.min(...g.notes.map((n) => n.pitch)), previous)) : null;
      if (!chord || !form) {
        unknown++;
        for (const n of g.notes) kept.push(n.id);
        continue;
      }
      chosen.set(chord.name, form);
      previous = form;
      const targets = formPitches(form);
      const inputs = [...g.notes].sort((a, b) => a.pitch - b.pitch);
      const k = Math.min(targets.length, inputs.length);
      for (let i = 0; i < k; i++) {
        kept.push(inputs[i].id);
        if (inputs[i].pitch !== targets[i]) updates.push({ id: inputs[i].id, changes: { pitch: targets[i] } });
      }
      for (let i = k; i < inputs.length; i++) removed.push(inputs[i].id);
      if (targets.length > inputs.length) {
        const velocity = median(inputs.map((n) => n.velocity));
        const low = inputs[0];
        added.push({
          trackId: g.trackId,
          clipId: g.clipId,
          events: targets.slice(inputs.length).map((pitch) => ({ kind: 'note', tick: g.tick, pitch, velocity, durationTicks: low.durationTicks, releaseVelocity: low.releaseVelocity, ...(low.channelOverride !== undefined ? { channelOverride: low.channelOverride } : {}) })),
        });
      }
    }
  }
  const newIds: string[] = [];
  const command =
    updates.length || added.length || removed.length
      ? compose(project, 'ギターボイシング', [
          (p) => updateEvents(p, updates, 'ギターボイシング'),
          ...added.map((a) => (p: MidiProject) => {
            const r = addEvents(p, a.trackId, a.events, { clipId: a.clipId, label: 'ギターボイシング' });
            if (r) newIds.push(...r.ids);
            return r?.command ?? null;
          }),
          (p) => deleteEvents(p, removed, 'ギターボイシング'),
        ])
      : null;
  const notice = unknown > 0 ? (unknown === groups ? t('ギターのコードとして読める和音がありません（3〜4 種類の音からなる maj / m / 7 / maj7 / m7 / sus2 / sus4 / dim / aug）。') : t('変換できない和音 {n} 個はそのままにしました。', { n: unknown })) : null;
  return { command, ids: [...kept, ...newIds], notice, stats: { notes, groups, skipped: unknown } };
}
