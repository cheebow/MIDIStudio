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
  /** the loop the engine plays, in song seconds (clicks follow the wrap) */
  loop?: { startSeconds: number; endSeconds: number } | null;
}

const LOOKAHEAD_S = 0.12;
const TIMER_MS = 25;
/** how far behind the position a (re)start may be noticed and its beat still clicked */
const START_GRACE_S = 0.04;

export class Metronome {
  private timer: ReturnType<typeof setInterval> | null = null;
  private scheduledUntil = -1;
  private lastSongTime = -1;
  /** song time up to which the beats after the loop start were scheduled before the wrap */
  private afterWrap: number | null = null;
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
    this.afterWrap = null;
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

  /** one look-ahead step (protected for tests) */
  protected tick(): void {
    const ctx = this.host.audioContext;
    const maps = this.maps();
    if (!ctx || !maps || !this.host.isPlaying()) {
      this.scheduledUntil = -1;
      return;
    }
    const now = this.host.getSeconds();
    const loop = maps.loop && maps.loop.endSeconds > maps.loop.startSeconds ? maps.loop : null;
    // Seek or loop wrap: the song time jumped backwards or far ahead -> restart scheduling. At a
    // loop wrap the beats just after the loop start were already scheduled before the wrap.
    // A (re)start is noticed a few ms after it happened: the beat playback started on (bar 1 after
    // Space, the downbeat after the count-in) is then just behind `now`. It is still clicked.
    let catchUp = false;
    if (now < this.lastSongTime - 0.01 || now > this.scheduledUntil + 1) {
      const carried = this.afterWrap;
      if (loop && carried !== null && now >= loop.startSeconds - 0.01 && now <= carried + LOOKAHEAD_S) this.scheduledUntil = carried;
      else {
        this.scheduledUntil = Math.max(0, now - START_GRACE_S);
        catchUp = true;
      }
      this.afterWrap = null;
    }
    this.lastSongTime = now;
    const from = catchUp ? this.scheduledUntil : Math.max(this.scheduledUntil, now);
    const to = now + LOOKAHEAD_S;
    if (to <= from) return;
    if (loop && now < loop.endSeconds && to > loop.endSeconds) {
      // The look-ahead crosses the loop end (ADR-084): click up to the loop end only, then the
      // beats from the loop start, timed after the loop end — the click exactly on the loop start
      // used to be lost (the wrap is noticed only after it), and beats past the loop end were heard.
      this.schedule(ctx, maps, from, loop.endSeconds, 0, catchUp);
      const endAt = this.host.songTimeToContextTime(loop.endSeconds);
      const startAt = this.host.songTimeToContextTime(loop.startSeconds);
      const wrapTo = loop.startSeconds + (to - loop.endSeconds);
      const wrapFrom = this.afterWrap ?? loop.startSeconds; // part already scheduled by earlier steps
      if (endAt !== null && startAt !== null) this.schedule(ctx, maps, wrapFrom, wrapTo, endAt - startAt);
      this.afterWrap = Math.max(wrapFrom, wrapTo);
      this.scheduledUntil = loop.endSeconds;
      return;
    }
    this.schedule(ctx, maps, from, loop && now < loop.endSeconds ? Math.min(to, loop.endSeconds) : to, 0, catchUp);
    this.scheduledUntil = to;
  }

  /** Clicks for the beats in [from, to) song seconds, shifted by `shift` seconds of context time. */
  private schedule(ctx: { currentTime: number }, maps: MetronomeMaps, from: number, to: number, shift: number, late = false): void {
    if (to <= from) return;
    for (const beat of beatsInWindow(maps.tempo, maps.signature, from, to)) {
      const at = this.host.songTimeToContextTime(beat.seconds);
      // `late`: a beat a few ms in the past is the one playback just started on — it sounds at once
      if (at === null || (at + shift < ctx.currentTime && !late)) continue;
      this.click(ctx as AudioContext, at + shift, beat.accent);
    }
  }

  /** Schedules one click at an AudioContext time (used for the recording count-in). */
  clickAt(at: number, accent: boolean): void {
    const ctx = this.host.audioContext;
    if (ctx) this.click(ctx, at, accent);
  }

  protected click(ctx: AudioContext, at: number, accent: boolean): void {
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
