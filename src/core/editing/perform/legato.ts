// Legato (PT-04, ADR-077): note ends follow the next selected note / chord of the same track.
// Onsets, pitches and velocities never change. Only the selection is looked at, so notes outside
// it are neither moved nor used as the reference.
import type { MidiProject, NoteEvent } from '../../model/types';
import { SMF_LIMITS } from '../../smf/types';
import { updateEvents } from '../operations';
import { t } from '../../../i18n';
import { chordGroups, msToTicks, tempoMapOf } from './chords';
import type { TransformResult } from './types';

export type LegatoMode = 'connect' | 'overlap' | 'detach';

export interface LegatoOptions {
  mode: LegatoMode;
}

/** "Overlap" / "detach" distance (time based, so it feels the same at every tempo and PPQ). */
export const LEGATO_GAP_MS = 15;

export function legatoNotes(project: MidiProject, ids: Iterable<string>, opts: LegatoOptions): TransformResult {
  const tempo = tempoMapOf(project);
  const updates: { id: string; changes: Partial<NoteEvent> }[] = [];
  const all: string[] = [];
  let notes = 0;
  let groups = 0;
  let pedal = 0;
  let lonely = 0;
  for (const list of chordGroups(project, ids, 0)) {
    groups += list.length;
    for (const g of list) for (const n of g.notes) all.push(n.id);
    if (list.length < 2) {
      lonely += list.length;
      for (const g of list) notes += g.notes.length;
      continue;
    }
    for (let i = 0; i < list.length - 1; i++) {
      const g = list[i];
      const next = list[i + 1];
      const after = list[i + 2];
      const gap = next.tick - g.tick;
      // the overlap / gap is capped by a quarter of the distance, so very fast passages keep their order
      const d = Math.min(msToTicks(LEGATO_GAP_MS, g.tick, tempo), Math.floor(gap / 4));
      const target = opts.mode === 'connect' ? next.tick : opts.mode === 'overlap' ? next.tick + d : Math.max(g.tick + 1, next.tick - d);
      for (const n of g.notes) {
        notes++;
        const end = n.tick + n.durationTicks;
        // a note held through the following chord is a pedal tone / inner voice: left alone
        if (after && end > after.tick) {
          pedal++;
          continue;
        }
        const duration = Math.max(1, Math.min(target, SMF_LIMITS.maxTick) - n.tick);
        if (duration !== n.durationTicks) updates.push({ id: n.id, changes: { durationTicks: duration } });
      }
    }
    notes += list[list.length - 1].notes.length;
  }
  const command = updates.length ? updateEvents(project, updates, 'レガート調整') : null;
  let notice: string | null = null;
  if (pedal > 0) notice = t('長く伸ばした音 {n} 個はそのままにしました。', { n: pedal });
  else if (all.length > 0 && groups === lonely) notice = t('次のノートがないので、長さを決められません。');
  return { command, ids: all, notice, stats: { notes, groups, skipped: pedal + lonely } };
}
