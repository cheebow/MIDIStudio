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
  const startTick = tempo.secondsToTick(Math.max(0, fromSeconds));
  const pos = sig.tickToBarBeat(startTick);
  let tick = sig.barBeatToTick(pos.bar, pos.beat);
  let bar = pos.bar;
  let beat = pos.beat;
  for (let guard = 0; guard < 10_000; guard++) {
    const s = tempo.tickToSeconds(tick);
    if (s >= toSeconds) break;
    if (s >= fromSeconds) out.push({ tick, seconds: s, accent: beat === 1 });
    const { numerator } = sig.signatureAt(tick);
    beat++;
    if (beat > numerator) {
      beat = 1;
      bar++;
    }
    const next = sig.barBeatToTick(bar, beat);
    tick = next > tick ? next : tick + sig.ticksPerBeat(tick);
  }
  return out;
}
