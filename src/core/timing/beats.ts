// Metronome beat positions in a time window (used by the audio-clock scheduler).
import type { TempoMap } from './tempoMap';
import type { TimeSignatureMap } from './timeSignatureMap';

export interface Beat {
  tick: number;
  seconds: number;
  /** first beat of a bar */
  accent: boolean;
}

/** Beats whose time t satisfies fromSeconds <= t < toSeconds. */
export function beatsInWindow(tempo: TempoMap, sig: TimeSignatureMap, fromSeconds: number, toSeconds: number): Beat[] {
  const out: Beat[] = [];
  if (toSeconds <= fromSeconds) return out;
  // Beats are counted from the start of each signature: a change in the middle of a bar starts a
  // new bar there (TimeSignatureMap), so the click accents the change like the ruler shows (ADR-084).
  const startTick = tempo.secondsToTick(Math.max(0, fromSeconds));
  const segStart = sig.segmentStartAt(startTick);
  const tpb0 = sig.ticksPerBeat(startTick);
  let index = Math.max(0, Math.floor((startTick - segStart) / tpb0 + 1e-9)); // beat number within the segment
  let tick = segStart + index * tpb0;
  for (let guard = 0; guard < 10_000; guard++) {
    const s = tempo.tickToSeconds(tick);
    if (s >= toSeconds) break;
    const { numerator } = sig.signatureAt(tick);
    if (s >= fromSeconds) out.push({ tick, seconds: s, accent: index % numerator === 0 });
    const next = tick + sig.ticksPerBeat(tick);
    const change = sig.changeAfter(tick);
    if (change !== null && change <= next + 1e-9) {
      tick = change; // the new signature's first beat (a new bar)
      index = 0;
    } else {
      tick = next;
      index++;
    }
  }
  return out;
}
