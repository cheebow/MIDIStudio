// The position of a list / conductor row as text (ADR-099): absolute ticks, or "bar.beat.tick"
// (MBT) from the song's time-signature map. This is a notation of the POSITION only — ST / GT are
// lengths and keep their own display unit (Native Tick / Classic 48).
import { parseFieldInput } from '../editing/noteInfo';
import type { ListPositionUnit } from '../model/types';
import type { TimeSignatureMap } from '../timing/timeSignatureMap';
import { SMF_LIMITS } from '../smf/types';
import { t } from '../../i18n';
import { formatTicks, type ListUnit } from './listRows';

export type ParsedPosition = { ok: true; ticks: number } | { ok: false; message: string };

/** The TICK cell: MBT, or the tick in the list's display unit. */
export function formatListPosition(tick: number, position: ListPositionUnit, sig: TimeSignatureMap, unit: ListUnit, ppq: number): string {
  return position === 'mbt' ? sig.format(tick) : formatTicks(tick, unit, ppq);
}

/**
 * A typed position. MBT: "12.3.0", "12.3", "12" (":" and spaces also separate), read with the
 * signature map, so a beat the bar does not have is refused. Tick: a whole number of ticks. In both
 * notations "+120" / "-120" moves from `current` by that many ticks, like the note info bar.
 */
export function parsePositionInput(text: string, position: ListPositionUnit, sig: TimeSignatureMap, current: number): ParsedPosition {
  const absolute = position === 'mbt' ? (s: string) => sig.parse(s) : (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
  const input = parseFieldInput(text, 'tick', absolute);
  if (!input) {
    return {
      ok: false,
      message: position === 'mbt' ? t('位置は 小節.拍.Tick（例 5.1.0）で入力してください。その小節にない拍は入力できません。+120 / -120 で今の位置から動かせます。') : t('位置は 0 以上の整数 Tick で入力してください。+120 / -120 で今の位置から動かせます。'),
    };
  }
  const ticks = input.kind === 'set' ? input.value : current + input.delta;
  if (!Number.isSafeInteger(ticks) || ticks < 0) return { ok: false, message: t('曲の先頭より前には置けません。') };
  if (ticks > SMF_LIMITS.maxTick) return { ok: false, message: t('位置が大きすぎます。') };
  return { ok: true, ticks };
}

/** `tick` moved by whole beats (the beat length where it is; backwards, the one just before it). Never below 0. */
export function shiftByBeats(tick: number, beats: number, sig: TimeSignatureMap): number {
  let at = tick;
  for (let i = 0; i < Math.abs(beats); i++) {
    if (beats > 0) at += Math.max(1, Math.round(sig.ticksPerBeat(at)));
    else if (at === 0) break;
    else at = Math.max(0, at - Math.max(1, Math.round(sig.ticksPerBeat(at - 1))));
  }
  return at;
}
