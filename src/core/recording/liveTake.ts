// Real-time recording (REQ-IN-04, INPUT_RECORDING 5/8). Pure: input events arrive with a song-time
// (seconds, already mapped from the input clock by the caller) and are converted to ticks through
// the TempoMap, so tempo changes during the take are handled (I10).
import type { NewEvent } from '../editing/operations';
import type { TempoMap } from '../timing/tempoMap';

export type RecordInput = (
  | { type: 'note-on'; pitch: number; velocity: number; songSeconds: number; channel?: number }
  | { type: 'note-off'; pitch: number; releaseVelocity: number; songSeconds: number; channel?: number }
  | { type: 'cc'; controller: number; value: number; songSeconds: number; channel?: number }
  | { type: 'pitch-bend'; value: number; songSeconds: number; channel?: number }
  | { type: 'channel-pressure'; value: number; songSeconds: number; channel?: number }
  | { type: 'poly-pressure'; pitch: number; value: number; songSeconds: number; channel?: number }
) & {
  /**
   * Loop recording: the 0-based pass this input belongs to, when the caller knows it from its own
   * clock. Without it a pass starts only when the song time jumps back, so a pass with no input
   * (or one played later in the bar) merged with the next one (ADR-084).
   */
  pass?: number;
};

export interface TakeOptions {
  tempo: TempoMap;
  /** Latency compensation: subtracted from every input time (I15). */
  latencyMs?: number;
  /** Only events whose onset tick is in [in, out) are kept; notes are cut at `out` (INPUT_RECORDING 5). */
  punch?: { inTick: number; outTick: number };
  /** Loop recording: song time wraps; each pass becomes a take. */
  loop?: { startTick: number; endTick: number };
}

export interface RecordedTake {
  /** 0-based pass number for loop recording (0 when not looping) */
  pass: number;
  events: NewEvent[];
}

export interface TakeResult {
  takes: RecordedTake[];
  /** notes still held when recording stopped (closed at the stop tick) */
  closedAtStop: number;
  /** recorded range in ticks (for Replace) */
  range: { startTick: number; endTick: number };
}

/**
 * Builds the recorded events. Inputs must be in arrival order. In loop recording, a time that
 * goes backwards starts the next pass; notes held across the loop end are closed at the loop end.
 */
export class LiveTake {
  private takes: RecordedTake[] = [{ pass: 0, events: [] }];
  private open = new Map<string, { tick: number; velocity: number; channel?: number; pass: number }>();
  private lastTick = -1;
  private pass = 0;
  private minTick = Infinity;
  private maxTick = 0;

  constructor(private readonly opts: TakeOptions) {}

  private toTick(seconds: number): number {
    const s = seconds - (this.opts.latencyMs ?? 0) / 1000;
    return Math.max(0, Math.round(this.opts.tempo.secondsToTick(s)));
  }

  private inPunch(tick: number): boolean {
    const p = this.opts.punch;
    return !p || (tick >= p.inTick && tick < p.outTick);
  }

  private push(e: NewEvent, pass = this.pass) {
    this.takes[pass].events.push(e);
    this.minTick = Math.min(this.minTick, e.tick);
    this.maxTick = Math.max(this.maxTick, e.kind === 'note' ? e.tick + e.durationTicks : e.tick + 1);
  }

  private closeNote(key: string, offTick: number, releaseVelocity: number, offPass = this.pass) {
    const on = this.open.get(key);
    if (!on) return;
    this.open.delete(key);
    let end = offTick;
    if (this.opts.punch) end = Math.min(end, this.opts.punch.outTick);
    if (this.opts.loop && on.pass !== offPass) end = this.opts.loop.endTick;
    const pitch = Number(key.split(':')[1]);
    this.push({ kind: 'note', tick: on.tick, pitch, velocity: on.velocity, durationTicks: Math.max(1, end - on.tick), releaseVelocity, ...(on.channel !== undefined ? { channelOverride: on.channel } : {}) }, on.pass);
  }

  /**
   * A finished note of the same key that still sounds at `tick` ends there: two notes of one key
   * must not overlap (the first one's Note Off would cut the second). A count-in pickup keeps its
   * held length and can reach past the downbeat (ADR-084 / 086).
   */
  private trimOverlap(pitch: number, channel: number | undefined, tick: number) {
    const events = this.takes[this.pass].events;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind !== 'note' || e.pitch !== pitch || e.channelOverride !== channel) continue;
      if (e.tick < tick && e.tick + e.durationTicks > tick) events[i] = { ...e, durationTicks: tick - e.tick };
    }
  }

  add(input: RecordInput): void {
    const tick = this.toTick(input.songSeconds);
    const loop = this.opts.loop;
    const target = input.pass !== undefined ? input.pass : loop && this.lastTick >= 0 && tick + this.opts.tempo.ppq / 8 < this.lastTick ? this.pass + 1 : this.pass;
    if (loop && target > this.pass) {
      // a new pass: close held notes at the loop end; passes without input stay empty
      for (const key of [...this.open.keys()]) this.closeNote(key, loop.endTick, 64);
      while (this.pass < target) {
        this.pass++;
        this.takes.push({ pass: this.pass, events: [] });
      }
    }
    this.lastTick = tick;
    // An input the caller places in an earlier pass (the end of the loop, arriving just after a
    // pickup started the next pass, ADR-088) stays in that pass.
    const at = input.pass !== undefined ? Math.min(input.pass, this.pass) : this.pass;
    const ch = input.channel !== undefined ? { channelOverride: input.channel } : {};
    switch (input.type) {
      case 'note-on':
        if (!this.inPunch(tick)) return;
        this.closeNote(`${input.channel ?? -1}:${input.pitch}`, tick, 64); // re-trigger without note-off
        this.trimOverlap(input.pitch, input.channel, tick);
        this.open.set(`${input.channel ?? -1}:${input.pitch}`, { tick, velocity: Math.max(1, Math.min(127, input.velocity)), channel: input.channel, pass: this.pass });
        return;
      case 'note-off':
        this.closeNote(`${input.channel ?? -1}:${input.pitch}`, tick, input.releaseVelocity, at);
        return;
      case 'cc':
        if (this.inPunch(tick)) this.push({ kind: 'cc', tick, controller: input.controller, value: input.value, ...ch }, at);
        return;
      case 'pitch-bend':
        if (this.inPunch(tick)) this.push({ kind: 'pitch-bend', tick, value: input.value, ...ch }, at);
        return;
      case 'channel-pressure':
        if (this.inPunch(tick)) this.push({ kind: 'channel-pressure', tick, pressure: input.value, ...ch }, at);
        return;
      case 'poly-pressure':
        if (this.inPunch(tick)) this.push({ kind: 'poly-pressure', tick, pitch: input.pitch, pressure: input.value, ...ch }, at);
        return;
    }
  }

  /**
   * Live view of the take so far (for drawing while recording): finished notes plus held notes
   * extended to `currentSeconds`. Does not change the take.
   */
  preview(currentSeconds: number): { tick: number; pitch: number; durationTicks: number; velocity: number; held: boolean }[] {
    const now = this.toTick(currentSeconds);
    const out: { tick: number; pitch: number; durationTicks: number; velocity: number; held: boolean }[] = [];
    for (const t of this.takes) for (const e of t.events) if (e.kind === 'note') out.push({ tick: e.tick, pitch: e.pitch, durationTicks: e.durationTicks, velocity: e.velocity, held: false });
    for (const [key, on] of this.open) out.push({ tick: on.tick, pitch: Number(key.split(':')[1]), durationTicks: Math.max(1, now - on.tick), velocity: on.velocity, held: true });
    return out;
  }

  /**
   * Stop: held notes are closed at the stop position (REQ: "recording ended" warning). `stopPass`
   * is the loop pass at the stop when the caller counts passes itself (ADR-086).
   */
  finish(stopSeconds: number, stopPass?: number): TakeResult {
    const stopTick = this.toTick(stopSeconds);
    const held = this.open.size;
    // Stopped after a loop wrap with no input since: the held notes ran to the loop end, not to a
    // stop position that now lies before them (they would shrink to 1 tick, ADR-083).
    const wrapped = this.opts.loop !== undefined && (stopPass !== undefined ? stopPass > this.pass : this.lastTick >= 0 && stopTick + this.opts.tempo.ppq / 8 < this.lastTick);
    for (const key of [...this.open.keys()]) this.closeNote(key, wrapped ? this.opts.loop!.endTick : Math.max(stopTick, this.open.get(key)!.tick + 1), 64);
    const range = { startTick: Number.isFinite(this.minTick) ? this.minTick : stopTick, endTick: Math.max(this.maxTick, stopTick) };
    return { takes: this.takes.filter((t) => t.events.length > 0), closedAtStop: held, range };
  }
}
