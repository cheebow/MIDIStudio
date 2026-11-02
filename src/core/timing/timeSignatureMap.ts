// Bar/beat positions over time-signature changes (ARCHITECTURE E). Exact integer arithmetic:
// a beat lasts ppq*4/denominator ticks, which may be fractional for unusual PPQ values.

export interface TimeSignaturePoint {
  tick: number;
  numerator: number;
  denominator: number;
}

interface Segment {
  tick: number;
  num: number;
  den: number;
  /** 0-based bar index at segment start */
  bar: number;
}

export interface BarBeat {
  /** 1-based */
  bar: number;
  /** 1-based */
  beat: number;
  /** ticks from the start of the beat (may be fractional when a beat is not a whole number of ticks) */
  tickInBeat: number;
  numerator: number;
  denominator: number;
}

export class TimeSignatureMap {
  private readonly segments: Segment[];

  constructor(
    readonly ppq: number,
    sigs: readonly TimeSignaturePoint[],
  ) {
    const sorted = [...sigs].map((t, i) => ({ ...t, i })).sort((a, b) => a.tick - b.tick || a.i - b.i);
    const segs: Segment[] = [{ tick: 0, num: 4, den: 4, bar: 0 }];
    for (const t of sorted) {
      const last = segs[segs.length - 1];
      if (t.tick === last.tick) {
        last.num = t.numerator;
        last.den = t.denominator;
        continue;
      }
      // A change in the middle of a bar starts a new bar at the change (the partial bar counts).
      const span = (t.tick - last.tick) * last.den; // in units of 1/(ppq*4) bars-per-numerator
      const barLen = ppq * 4 * last.num;
      const bars = Math.ceil(span / barLen);
      segs.push({ tick: t.tick, num: t.numerator, den: t.denominator, bar: last.bar + bars });
    }
    this.segments = segs;
  }

  private segmentAt(tick: number): Segment {
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

  signatureAt(tick: number): { numerator: number; denominator: number } {
    const s = this.segmentAt(tick);
    return { numerator: s.num, denominator: s.den };
  }

  /** Beat length in ticks (may be fractional). */
  ticksPerBeat(tick: number): number {
    return (this.ppq * 4) / this.segmentAt(tick).den;
  }

  ticksPerBar(tick: number): number {
    const s = this.segmentAt(tick);
    return (this.ppq * 4 * s.num) / s.den;
  }

  tickToBarBeat(tick: number): BarBeat {
    const s = this.segmentAt(tick);
    const unit = this.ppq * 4; // ticks per whole note
    const scaled = (tick - s.tick) * s.den; // position in (1/den whole-note) * unit
    const barLen = unit * s.num;
    const barOffset = Math.floor(scaled / barLen);
    const inBar = scaled - barOffset * barLen;
    const beat = Math.floor(inBar / unit);
    return {
      bar: s.bar + barOffset + 1,
      beat: beat + 1,
      tickInBeat: (inBar - beat * unit) / s.den,
      numerator: s.num,
      denominator: s.den,
    };
  }

  /** Start tick of a 1-based bar (and optional 1-based beat). May be fractional for odd PPQ. */
  barBeatToTick(bar: number, beat = 1): number {
    const target = bar - 1;
    let seg = this.segments[0];
    for (const s of this.segments) if (s.bar <= target) seg = s;
    return seg.tick + ((target - seg.bar) * this.ppq * 4 * seg.num + (beat - 1) * this.ppq * 4) / seg.den;
  }

  /**
   * Inverse of format: "5", "5.2", "5.2.240", "005.02.240" (also ":" or spaces as separators) to a
   * tick (integer, rounded). null when the text is not a position or the beat is outside the bar.
   */
  parse(text: string): number | null {
    const m = /^\s*(\d+)(?:[.:\s]+(\d+)(?:[.:\s]+(\d+))?)?\s*$/.exec(text);
    if (!m) return null;
    const bar = Number(m[1]);
    const beat = m[2] === undefined ? 1 : Number(m[2]);
    const tickInBeat = m[3] === undefined ? 0 : Number(m[3]);
    if (bar < 1 || beat < 1) return null;
    const start = this.barBeatToTick(bar);
    if (beat > this.signatureAt(start).numerator) return null;
    return Math.round(this.barBeatToTick(bar, beat) + tickInBeat);
  }

  /** "001.01.000" style label (tick within beat rounded down for display). */
  format(tick: number): string {
    const p = this.tickToBarBeat(tick);
    return `${String(p.bar).padStart(3, '0')}.${String(p.beat).padStart(2, '0')}.${String(Math.floor(p.tickInBeat)).padStart(3, '0')}`;
  }
}
