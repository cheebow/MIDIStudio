// Tick <-> seconds by piecewise integration over tempo segments (ARCHITECTURE E).
// Tempo values are integer microseconds per quarter note; BPM is display only.
import { DEFAULT_TEMPO_US } from '../model/defaults';

export interface TempoPoint {
  tick: number;
  usPerQuarter: number;
}

interface Segment {
  tick: number;
  us: number;
  /** microseconds elapsed at segment start */
  startUs: number;
}

export function bpmFromUs(usPerQuarter: number): number {
  return 60_000_000 / usPerQuarter;
}

export function usFromBpm(bpm: number): number {
  return Math.round(60_000_000 / bpm);
}

export class TempoMap {
  private readonly segments: Segment[];

  constructor(
    readonly ppq: number,
    tempos: readonly TempoPoint[],
  ) {
    if (!Number.isInteger(ppq) || ppq <= 0) throw new RangeError(`invalid PPQ ${ppq}`);
    // Stable by tick; for several tempos at one tick the last one wins (SMF semantics).
    const sorted = [...tempos].map((t, i) => ({ ...t, i })).sort((a, b) => a.tick - b.tick || a.i - b.i);
    const segs: Segment[] = [{ tick: 0, us: DEFAULT_TEMPO_US, startUs: 0 }];
    for (const t of sorted) {
      const last = segs[segs.length - 1];
      if (t.tick === last.tick) {
        last.us = t.usPerQuarter;
        continue;
      }
      const startUs = last.startUs + ((t.tick - last.tick) * last.us) / ppq;
      segs.push({ tick: t.tick, us: t.usPerQuarter, startUs });
    }
    this.segments = segs;
  }

  private segmentForTick(tick: number): Segment {
    const s = this.segments;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return s[lo];
  }

  private segmentForUs(us: number): Segment {
    const s = this.segments;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].startUs <= us) lo = mid;
      else hi = mid - 1;
    }
    return s[lo];
  }

  usPerQuarterAt(tick: number): number {
    return this.segmentForTick(tick).us;
  }

  bpmAt(tick: number): number {
    return bpmFromUs(this.usPerQuarterAt(tick));
  }

  /** tick may be fractional (e.g. a playhead position). */
  tickToSeconds(tick: number): number {
    const s = this.segmentForTick(tick);
    return (s.startUs + ((tick - s.tick) * s.us) / this.ppq) / 1e6;
  }

  /** Fractional tick at the given time. Round explicitly at the call site when committing edits. */
  secondsToTick(seconds: number): number {
    const us = Math.max(0, seconds) * 1e6;
    const s = this.segmentForUs(us);
    return s.tick + ((us - s.startUs) * this.ppq) / s.us;
  }

  get tempoPoints(): readonly TempoPoint[] {
    return this.segments.map((s) => ({ tick: s.tick, usPerQuarter: s.us }));
  }
}
