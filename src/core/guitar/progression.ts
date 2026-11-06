// Chord progressions for the guitar-voicing progression dialog (ADR-091 追記). Rows come either from
// the chord analysis (ADR-090) over a range, or from a typed progression in bar notation:
//   "Cmaj7 | Am7 | Dm7 G7 | C"  — bars separated by "|" (or a new line), chords of one bar share it
//   equally; without any "|", every chord is one bar. "%" (or "-") repeats the previous chord.
// Bars are measured from the start tick with the time-signature map, so 3/4 and signature changes work.
import type { ChordSegment } from '../theory/chords';
import type { TimeSignatureMap } from '../timing/timeSignatureMap';

export interface ProgressionRow {
  tick: number;
  length: number;
  /** the chord as written (parsed later, so a bad name stays visible on its row) */
  text: string;
}

/** End tick of `bars` bars counted from `start` (bar lengths follow the signature at each bar's start). */
export function barsEnd(sig: TimeSignatureMap, start: number, bars: number): number {
  let t = start;
  for (let i = 0; i < bars; i++) t += sig.ticksPerBar(t);
  return Math.round(t);
}

export function parseProgression(text: string, start: number, sig: TimeSignatureMap): ProgressionRow[] {
  const src = text.replace(/｜/g, '|').trim();
  if (src === '') return [];
  const barred = /[|\n]/.test(src);
  const bars = barred
    ? src
        .split(/[|\n]/)
        .map((b) => b.trim().split(/\s+/).filter(Boolean))
        .filter((b, i, all) => b.length > 0 || (i > 0 && i < all.length - 1)) // "| C |" edges are not bars
    : src.split(/\s+/).map((c) => [c]);
  const rows: ProgressionRow[] = [];
  let tick = Math.round(start);
  let prev: string | null = null;
  for (const bar of bars) {
    const len = Math.round(sig.ticksPerBar(tick));
    if (bar.length === 0) {
      // an empty bar ("| |") holds the previous chord
      if (rows.length) rows[rows.length - 1].length += len;
      tick += len;
      continue;
    }
    const each = Math.floor(len / bar.length);
    bar.forEach((token, i) => {
      const length = i === bar.length - 1 ? len - each * (bar.length - 1) : each;
      const repeat = token === '%' || token === '-';
      if (repeat && rows.length) rows[rows.length - 1].length += length;
      else {
        const name = repeat ? (prev ?? token) : token;
        rows.push({ tick, length, text: name });
        prev = name;
      }
      tick += length;
    });
  }
  // the same chord twice in a row stays two rows (a re-strike), as written
  return rows;
}

/** Rows from the analysed chords that overlap [start, end), clipped to the range. */
export function rowsFromChords(segments: readonly ChordSegment[], start: number, end: number): ProgressionRow[] {
  const rows: ProgressionRow[] = [];
  for (const s of segments) {
    if (s.endTick <= start || s.tick >= end) continue;
    const tick = Math.max(s.tick, start);
    const stop = Math.min(s.endTick, end);
    if (stop > tick) rows.push({ tick, length: stop - tick, text: s.name });
  }
  return rows;
}

/**
 * The range a progression dialog opens with: the loop range when the right-click is inside it, else
 * `clickEnd` (four bars) from the right-click.
 */
export function defaultProgressionRange(tick: number, loop: { startTick: number; endTick: number }, clickEnd: number): { start: number; end: number } {
  return loop.endTick > loop.startTick && tick >= loop.startTick && tick < loop.endTick ? { start: loop.startTick, end: loop.endTick } : { start: tick, end: clickEnd };
}
