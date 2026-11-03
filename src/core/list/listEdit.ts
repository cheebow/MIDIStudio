// List editor edits (REQ-EDT-10, UI_DESIGN 6.2, ARCHITECTURE G).
// - ST edit ripples every LATER event of the track by the difference (E05).
// - GT edit changes only that note's Note Off (E06).
// - Absolute tick edit moves only that event.
// Display units are converted back exactly or refused (no silent rounding: C15 / E07).
import type { Command } from '../editing/history';
import { EditError, rewriteEvents, updateEvents, type NewEvent } from '../editing/operations';
import type { MidiProject } from '../model/types';
import { classic48ToTicks } from '../timing/classic48';
import { sortedTrackEvents, type ListUnit } from './listRows';
import { setGsValue } from '../gs/gsProject';
import { hasChannel } from '../events/order';
import { t } from '../../i18n';

export type ParsedTicks = { ok: true; ticks: number } | { ok: false; message: string };

/** Parses a ST / GT / tick cell in the current display unit. */
export function parseTicksInput(text: string, unit: ListUnit, ppq: number): ParsedTicks {
  const s = text.trim();
  if (unit === 'native') {
    if (!/^\d+$/.test(s)) return { ok: false, message: t('Tick は 0 以上の整数で入力してください。') };
    return { ok: true, ticks: Number(s) };
  }
  const r = classic48ToTicks(s, ppq);
  if (r.ok) return r.ticks >= 0 ? { ok: true, ticks: r.ticks } : { ok: false, message: t('0 以上の値を入力してください。') };
  if (r.reason === 'syntax') return { ok: false, message: t('数値（例: 12、12.5、25/2）を入力してください。') };
  return { ok: false, message: t('PPQ {ppq} では Tick {display} になり整数になりません。丸めずに中止しました（Native Tick 表示で入力してください）。', { ppq, display: r.display }) };
}

export function setStepTime(project: MidiProject, trackId: string, eventId: string, newSt: number, label = 'ST を変更'): Command | null {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new EditError('track not found');
  if (!Number.isSafeInteger(newSt) || newSt < 0) throw new EditError(t('ST は 0 以上の整数 Tick です。'));
  const events = sortedTrackEvents(track);
  const i = events.findIndex((e) => e.id === eventId);
  if (i < 0) throw new EditError('event not found');
  const next = events[i + 1];
  if (!next) throw new EditError(t('最後のイベントの ST は変更できません（次のイベントがありません）。'));
  const delta = newSt - (next.tick - events[i].tick);
  if (delta === 0) return null;
  const updates = events.slice(i + 1).map((e) => ({ id: e.id, changes: { tick: e.tick + delta } }));
  return updateEvents(project, updates, label);
}

export function setGateTime(project: MidiProject, eventId: string, gt: number): Command | null {
  if (!Number.isSafeInteger(gt) || gt < 1) throw new EditError(t('GT は 1 以上の整数 Tick です。'));
  return updateEvents(project, [{ id: eventId, changes: { durationTicks: gt } }], 'GT を変更');
}

export function setAbsoluteTick(project: MidiProject, eventId: string, tick: number): Command | null {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new EditError(t('Tick は 0 以上の整数です。'));
  return updateEvents(project, [{ id: eventId, changes: { tick } }], '位置を変更');
}

/** VEL column: note velocity 1..127, CC value 0..127, program UI 1..128, pitch bend -8192..8191, pressure 0..127. */
export function setRowValue(project: MidiProject, eventId: string, value: number): Command | null {
  const e = project.tracks.flatMap((t) => t.events).find((x) => x.id === eventId);
  if (!e) throw new EditError('event not found');
  switch (e.kind) {
    case 'note':
      return updateEvents(project, [{ id: eventId, changes: { velocity: value } }], 'VEL を変更');
    case 'cc':
      return updateEvents(project, [{ id: eventId, changes: { value } }], '値を変更');
    case 'program':
      return updateEvents(project, [{ id: eventId, changes: { program: value - 1 } }], '音色を変更');
    case 'pitch-bend':
      return updateEvents(project, [{ id: eventId, changes: { value } }], 'Pitch Bend を変更');
    case 'channel-pressure':
    case 'poly-pressure':
      return updateEvents(project, [{ id: eventId, changes: { pressure: value } }], 'Pressure を変更');
    case 'sysex':
      return setGsValue(project, eventId, value);
    default:
      throw new EditError(t('この行の値は編集できません。'));
  }
}

export function setRowKey(project: MidiProject, eventId: string, key: number): Command | null {
  return updateEvents(project, [{ id: eventId, changes: { pitch: key } }], 'ノート番号を変更');
}

/**
 * CH column: sets the channel override (0..15) of channel events, or clears it (null = follow the
 * track). An override equal to the track channel is stored as "none". Rows without a channel
 * (SysEx / meta / raw) are skipped; when nothing in the selection has one, that is an error.
 */
export function setRowChannel(project: MidiProject, ids: Iterable<string>, channel: number | null): Command | null {
  if (channel !== null && !(Number.isInteger(channel) && channel >= 0 && channel < 16)) throw new EditError(t('チャンネルは 1〜16 です。'));
  let applicable = 0;
  const cmd = rewriteEvents(
    project,
    ids,
    (e, track) => {
      if (!hasChannel(e)) return null;
      applicable++;
      const { channelOverride: old, ...rest } = e as typeof e & { channelOverride?: number };
      const wanted = channel === null || channel === track.channel ? undefined : channel;
      if (old === wanted) return null;
      return (wanted === undefined ? rest : { ...rest, channelOverride: wanted }) as NewEvent;
    },
    'チャンネルを変更',
  );
  if (applicable === 0) throw new EditError(t('チャンネルを持たない行です。'));
  return cmd;
}
