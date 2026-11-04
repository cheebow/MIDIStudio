// Arpeggio (PT-03, ADR-077): each selected chord becomes a broken chord inside its own span
// (chord end or next chord onset, whichever comes first). Original notes keep their ids; the extra
// steps of "up and down" are new notes in the same clip.
import type { MidiProject, NoteEvent } from '../../model/types';
import { addEvents, compose, updateEvents, type NewEvent } from '../operations';
import { t } from '../../../i18n';
import { chordGroups } from './chords';
import type { TransformResult } from './types';

export type ArpeggioPattern = 'up' | 'down' | 'updown';

export interface ArpeggioOptions {
  pattern: ArpeggioPattern;
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
      if (span < k) {
        tooShort++;
        continue;
      }
      const used = new Set<string>();
      const extra: NewEvent[] = [];
      for (let j = 0; j < k; j++) {
        const on = g.tick + Math.floor((span * j) / k);
        const nextOn = g.tick + Math.floor((span * (j + 1)) / k);
        const duration = Math.max(1, Math.floor((nextOn - on) * ARPEGGIO_GATE));
        const src = seq[j];
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
  if (tooShort > 0) notice = t('短すぎる和音 {n} 個は分散できないので、そのままにしました。', { n: tooShort });
  else if (single > 0 && single === groups) notice = t('和音がありません。同じ位置に 2 つ以上のノートを選んでください。');
  else if (single > 0) notice = t('1 音だけの位置 {n} 個はそのままにしました。', { n: single });
  return { command, ids: [...all, ...newIds], notice, stats: { notes, groups, skipped: single + tooShort } };
}
