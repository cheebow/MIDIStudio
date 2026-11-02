// RCM-style "1/4 = 48" display unit (REQ-EDT-11, ARCHITECTURE E). Display value = ticks * 48 / ppq.
// Conversion back to ticks is accepted only when exact; otherwise the caller must ask the user
// (or use native ticks). Nothing here rounds.
import { formatRational, parseRational, rational, type Rational } from './rational';

export const CLASSIC_UNITS_PER_QUARTER = 48;

export function ticksToClassic48(ticks: number, ppq: number): Rational {
  return rational(ticks * CLASSIC_UNITS_PER_QUARTER, ppq);
}

export function formatClassic48(ticks: number, ppq: number): string {
  return formatRational(ticksToClassic48(ticks, ppq));
}

export type Classic48Parse =
  | { ok: true; ticks: number }
  | { ok: false; reason: 'syntax' }
  /** The value is valid but does not map to a whole number of ticks at this PPQ. */
  | { ok: false; reason: 'inexact'; exactTicks: Rational; display: string };

export function classic48ToTicks(input: string | Rational, ppq: number): Classic48Parse {
  const value = typeof input === 'string' ? parseRational(input) : input;
  if (!value) return { ok: false, reason: 'syntax' };
  const t = rational(value.num * ppq, value.den * CLASSIC_UNITS_PER_QUARTER);
  if (t.den === 1) return { ok: true, ticks: t.num };
  return { ok: false, reason: 'inexact', exactTicks: t, display: formatRational(t) };
}

/** True when every whole tick maps to a whole classic unit (ppq divides 48). */
export function isClassic48Lossless(ppq: number): boolean {
  return CLASSIC_UNITS_PER_QUARTER % ppq === 0;
}
