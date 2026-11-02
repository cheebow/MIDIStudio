// Metronome scheduled on the AudioContext clock (INPUT_RECORDING 5, CLAUDE.md "setTimeout だけを
// 正本クロックにしない"). A short timer only drives the look-ahead; every click's start time is an
// AudioContext time derived from the engine's song position.
import { beatsInWindow } from '../core/timing/beats';
import type { TempoMap } from '../core/timing/tempoMap';
import type { TimeSignatureMap } from '../core/timing/timeSignatureMap';

export interface MetronomeHost {
  readonly audioContext: AudioContext | null;
  getSeconds(): number;
  isPlaying(): boolean;
  songTimeToContextTime(seconds: number): number | null;
}

export interface MetronomeMaps {
  tempo: TempoMap;
  signature: TimeSignatureMap;
}

const LOOKAHEAD_S = 0.12;
const TIMER_MS = 25;

export class Metronome {
  private timer: ReturnType<typeof setInterval> | null = null;
  private scheduledUntil = -1;
  private lastSongTime = -1;
  private nodes = new Set<AudioScheduledSourceNode>();
  volume = 0.5;

  constructor(
    private readonly host: MetronomeHost,
    private readonly maps: () => MetronomeMaps | null,
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.scheduledUntil = -1;
    this.timer = setInterval(() => this.tick(), TIMER_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.nodes.clear();
  }

  private tick(): void {
    const ctx = this.host.audioContext;
    const maps = this.maps();
    if (!ctx || !maps || !this.host.isPlaying()) {
      this.scheduledUntil = -1;
      return;
    }
    const now = this.host.getSeconds();
    // Seek or loop wrap: the song time jumped backwards or far ahead -> restart scheduling.
    if (now < this.lastSongTime - 0.01 || now > this.scheduledUntil + 1) this.scheduledUntil = now;
    this.lastSongTime = now;
    const from = Math.max(this.scheduledUntil, now);
    const to = now + LOOKAHEAD_S;
    if (to <= from) return;
    for (const beat of beatsInWindow(maps.tempo, maps.signature, from, to)) {
      const at = this.host.songTimeToContextTime(beat.seconds);
      if (at === null || at < ctx.currentTime) continue;
      this.click(ctx, at, beat.accent);
    }
    this.scheduledUntil = to;
  }

  /** Schedules one click at an AudioContext time (used for the recording count-in). */
  clickAt(at: number, accent: boolean): void {
    const ctx = this.host.audioContext;
    if (ctx) this.click(ctx, at, accent);
  }

  private click(ctx: AudioContext, at: number, accent: boolean): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1320;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(this.volume * (accent ? 1 : 0.6), at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.06);
    this.nodes.add(osc);
    osc.onended = () => {
      this.nodes.delete(osc);
      gain.disconnect();
    };
  }
}
