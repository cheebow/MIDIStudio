import { describe, expect, it } from 'vitest';
import { Metronome, type MetronomeHost, type MetronomeMaps } from '../../src/playback/Metronome';
import { TempoMap } from '../../src/core/timing/tempoMap';
import { TimeSignatureMap } from '../../src/core/timing/timeSignatureMap';

/** Song clock = context clock (rate 1); the song wraps at the loop end like the engine does. */
class FakeHost implements MetronomeHost {
  ctxTime = 10;
  song = 0;
  readonly audioContext = { get currentTime() { return host.ctxTime; } } as unknown as AudioContext;
  getSeconds() {
    return this.song;
  }
  isPlaying() {
    return true;
  }
  songTimeToContextTime(seconds: number) {
    return this.ctxTime + (seconds - this.song);
  }
}
let host: FakeHost;

class TestMetronome extends Metronome {
  clicks: { at: number; accent: boolean }[] = [];
  step() {
    this.tick();
  }
  protected override click(_ctx: AudioContext, at: number, accent: boolean) {
    this.clicks.push({ at: Math.round(at * 1000) / 1000, accent });
  }
}

describe('metronome at a loop wrap (ADR-084)', () => {
  // 120 BPM: a beat every 0.5 s. Loop 0 .. 1.9 s: the end is just before the beat at 2.0 s.
  const maps: MetronomeMaps = {
    tempo: new TempoMap(480, [{ tick: 0, usPerQuarter: 500000 }]),
    signature: new TimeSignatureMap(480, []),
    loop: { startSeconds: 0, endSeconds: 1.9 },
  };

  it('clicks the loop start right at the wrap and never past the loop end', () => {
    host = new FakeHost();
    const m = new TestMetronome(host, () => maps);
    // advance in uneven 30 ms steps: like the engine, the wrap is noticed a little after it happens
    for (let i = 0; i < 100; i++) {
      m.step();
      host.ctxTime += 0.03;
      host.song += 0.03;
      if (host.song >= 1.9 - 1e-9) host.song -= 1.9;
    }
    const ctxBeats = m.clicks.map((c) => c.at);
    // song beats 0, 0.5, 1.0, 1.5, then the wrap at ctx 11.9: 0 -> 11.9, 0.5 -> 12.4, 1.0 -> 12.9 (no beat at song 2.0)
    expect(ctxBeats.slice(0, 7)).toEqual([10, 10.5, 11, 11.5, 11.9, 12.4, 12.9]);
    expect(m.clicks[4].accent).toBe(true); // the loop start (bar 1)
    expect(new Set(ctxBeats).size).toBe(ctxBeats.length); // nothing scheduled twice
  });
});
