// Live recording orchestration (REQ-IN-04, INPUT_RECORDING 5). Input times (performance.now()
// domain, from KeyboardEvent / MIDIMessageEvent timeStamp) are mapped to song time through the
// Transport's engine position, then to ticks by LiveTake (TempoMap). The audio engine's clock is
// the reference; Date.now() is never used.
import { LiveTake, type RecordInput } from '../../core/recording/liveTake';
import { takeToCommand } from '../../core/recording/applyTake';
import { gridTicks } from '../../core/timing/grid';
import { applyCommand, type Command } from '../../core/editing/history';
import type { MidiProject } from '../../core/model/types';
import { inputTargets } from '../../core/model/selectedTrack';
import type { InputController, CapturedInput } from '../../input/InputController';
import type { Transport } from '../../playback/Transport';
import type { EditorStore } from '../store/EditorStore';
import { t } from '../../i18n';

export type RecordPhase = 'idle' | 'count-in' | 'recording';

export interface RecorderState {
  phase: RecordPhase;
  /** beats left in the count-in */
  countIn: number;
  message: string | null;
}

type Listener = () => void;

export interface RecordTargets {
  piano: string | null;
  drum: string | null;
}

/**
 * Record targets (ADR-080): the selected track, routed like preview and step input (drum-pad hits
 * go to a drum track when the selected one is not). Fixed at the start of a take.
 */
export function recordTargets(p: MidiProject): RecordTargets | { error: string } {
  const targets = inputTargets(p);
  if (!targets.piano) return { error: t('録音するトラックがありません。トラックを追加してください。') };
  return targets;
}

export class Recorder {
  private state: RecorderState = { phase: 'idle', countIn: 0, message: null };
  private listeners = new Set<Listener>();
  private takes = new Map<string, LiveTake>();
  private detach: (() => void) | null = null;
  private countTimer: ReturnType<typeof setTimeout> | null = null;
  private targets: RecordTargets | null = null;
  private loopAtStart: MidiProject['loop'] | null = null;
  /** song seconds of the start position (early hits during the count-in are placed here) */
  private startSeconds = 0;
  /** notes moved to the start position / dropped as too early (for the message at stop) */
  private early = 0;
  private dropped = 0;
  /** count-in pickups held now: their real press time */
  private pickupOn = new Map<string, number>();
  /** input clock (performance.now) when playback started, and the loop in song seconds */
  private playStartMs: number | null = null;
  private loopSeconds: { start: number; end: number } | null = null;
  /** loop recording: a note-on this close to the loop end goes to the next pass's downbeat (a 32nd note) */
  private earlyWindow = 0;
  private latencySeconds = 0;

  constructor(
    private readonly store: EditorStore,
    private readonly transport: Transport,
    private readonly input: InputController,
    private readonly clickAt: (contextTime: number, accent: boolean) => void,
    private readonly audioNow: () => number | null,
  ) {}

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  /** current phase (a method so TypeScript does not narrow it across awaits) */
  private phaseNow(): RecordPhase {
    return this.state.phase;
  }
  private set(p: Partial<RecorderState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  /** Notes recorded so far per target track (drawn live by the editors while recording). */
  livePreview(): Map<string, ReturnType<LiveTake['preview']>> {
    const out = new Map<string, ReturnType<LiveTake['preview']>>();
    if (this.state.phase !== 'recording') return out;
    const seconds = this.transport.getPosition().seconds;
    for (const [id, take] of this.takes) out.set(id, take.preview(seconds));
    return out;
  }

  /** Song seconds for an input timestamp (performance.now() domain), from the transport's audio clock. */
  private songSeconds(atMs: number): number {
    const pos = this.transport.getPosition();
    return pos.seconds - (performance.now() - atMs) / 1000;
  }

  async start(): Promise<void> {
    if (this.state.phase !== 'idle') return;
    const project = this.store.project;
    const targets = recordTargets(project);
    if ('error' in targets) {
      this.set({ message: targets.error });
      throw new Error(targets.error);
    }
    this.targets = targets;
    const rec = project.settings.recording;
    const tempo = this.transport.tempoMap;
    const sig = this.transport.timeSignatureMap;
    if (!tempo || !sig) throw new Error(t('曲が読み込まれていません。'));
    // Record pressed while the song plays: stop where it is, so the count-in is counted from there
    // and the song does not run on under the count-in clicks, then jump back (ADR-087).
    this.transport.pause();
    const startTick = Math.round(this.transport.getPosition().tick);
    this.startSeconds = this.transport.getPosition().seconds;
    this.early = 0;
    this.dropped = 0;
    this.pickupOn.clear();
    this.loopAtStart = project.loop;
    const loop = project.loop.enabled && !rec.punch ? { startTick: project.loop.startTick, endTick: project.loop.endTick } : undefined;
    const punch = rec.punch && project.loop.endTick > project.loop.startTick ? { inTick: project.loop.startTick, outTick: project.loop.endTick } : undefined;
    this.takes.clear();
    const opts = { tempo, latencyMs: rec.latencyMs, loop, punch };
    for (const id of new Set([targets.piano, targets.drum].filter((x): x is string => !!x))) this.takes.set(id, new LiveTake(opts));

    // Count-in: clicks on the audio clock, then playback starts. Input during the last beat of the
    // count-in is an early hit and lands on the start position (ADR-047); earlier input is dropped.
    const beats = rec.countInBars * sig.signatureAt(startTick).numerator;
    const beatSec = tempo.usPerQuarterAt(startTick) / 1e6 * (4 / sig.signatureAt(startTick).denominator);
    const now = this.audioNow();
    this.detach = this.input.addSink((e) => this.capture(e));
    if (beats > 0 && now !== null) {
      this.set({ phase: 'count-in', countIn: beats, message: null });
      for (let i = 0; i < beats; i++) this.clickAt(now + 0.05 + i * beatSec, i % sig.signatureAt(startTick).numerator === 0);
      await new Promise<void>((resolve) => {
        let left = beats;
        const tick = () => {
          left--;
          this.set({ countIn: left });
          if (left <= 0 || this.phaseNow() !== 'count-in') resolve();
          else this.countTimer = setTimeout(tick, beatSec * 1000);
        };
        this.countTimer = setTimeout(tick, 50 + beatSec * 1000);
      });
      if (this.phaseNow() !== 'count-in') return; // cancelled while counting in
    }
    this.set({ phase: 'recording', countIn: 0, message: null });
    // keep the transport running past the end of the song while recording
    this.transport.setTail(startTick + project.ppq * 4 * 2000);
    try {
      this.playStartMs = null;
      await this.transport.play(startTick);
      // loop recording: passes are counted on the input clock from here (ADR-084)
      this.playStartMs = performance.now();
      this.loopSeconds = loop ? { start: tempo.tickToSeconds(loop.startTick), end: tempo.tickToSeconds(loop.endTick) } : null;
      this.earlyWindow = loop ? tempo.tickToSeconds(loop.endTick) - tempo.tickToSeconds(Math.max(loop.startTick, loop.endTick - project.ppq / 8)) : 0;
      this.latencySeconds = rec.latencyMs / 1000;
    } catch (e) {
      // e.g. the audio engine could not start: do not stay in "recording" with the input attached
      this.stop();
      throw e;
    }
  }

  /**
   * Loop recording: where an input lands — song seconds (as LiveTake expects them, latency not yet
   * taken off) and the 0-based pass. null when not loop recording.
   *
   * The position comes from the engine (the loop wraps there); the input clock since playback
   * started only says roughly how many loops have gone by, and the pass is the one that puts the
   * engine position closest to it. Counting passes on the clock alone (ADR-084) drifted from the
   * engine at the wrap: a note-on still counted in the old pass at the loop start got its note-off
   * in the next pass and ran to the loop end (ADR-088).
   * A note-on just before the loop end (within a 32nd note) was meant for the downbeat of the next
   * pass, like a pickup in the count-in: it goes to the loop start of the next pass.
   */
  private loopPlace(atMs: number, noteOn: boolean): { songSeconds: number; pass: number } | null {
    const ls = this.loopSeconds;
    if (!ls || this.playStartMs === null || ls.end <= ls.start) return null;
    const len = ls.end - ls.start;
    const latency = this.latencySeconds;
    // started at or after the loop end, the engine jumps straight to the loop start
    const origin = this.startSeconds >= ls.end ? ls.start : this.startSeconds;
    const unwrapped = origin + (atMs - this.playStartMs) / 1000 - latency;
    let x = this.songSeconds(atMs) - latency;
    // input from just before the engine wrapped back to the loop start belongs to the end of the loop
    if (unwrapped >= ls.start && x < ls.start) x += len;
    let pass = x >= ls.start ? Math.max(0, Math.round((unwrapped - x) / len)) : 0;
    if (noteOn && x >= ls.end - this.earlyWindow) {
      x = ls.start;
      pass++;
    }
    return { songSeconds: x + latency, pass };
  }

  private capture(e: CapturedInput) {
    const phase = this.state.phase;
    if (phase === 'idle' || !this.targets) return;
    const target = e.target === 'drum' ? this.targets.drum : this.targets.piano;
    const take = target ? this.takes.get(target) : undefined;
    if (!take) return;
    let songSeconds = this.songSeconds(e.atMs);
    if (phase === 'count-in') {
      // A note played a little before bar 1 (the last beat of the count-in) is a pickup, not a
      // mistake: it is placed on the start position instead of being lost. Anything earlier than
      // that beat is too early to be meant for this take and is not recorded (counted for the message).
      if (this.state.countIn > 1) {
        if (e.type === 'note-on') this.dropped++;
        return;
      }
      if (e.type === 'note-on') this.early++;
      // A pickup pressed and released within the count-in keeps its length (ADR-084): its end is
      // placed after the start position by the time it was held, not on the start (1 tick).
      // (the transport is parked during the count-in, so the held time comes from the input clock)
      const key = `${e.sourceId}:${e.channel ?? -1}:${'pitch' in e ? e.pitch : -1}`;
      if (e.type === 'note-on') this.pickupOn.set(key, e.atMs);
      const on = e.type === 'note-off' ? this.pickupOn.get(key) : undefined;
      if (on !== undefined) this.pickupOn.delete(key);
      songSeconds = on !== undefined ? this.startSeconds + Math.max(0, e.atMs - on) / 1000 : this.startSeconds;
    }
    const ch: { channel?: number; pass?: number } = e.channel !== undefined ? { channel: e.channel } : {};
    // Loop recording: which pass this input is in, from the time since playback started. A pass
    // with no input (or played later in the bar) is then not merged into the next one (ADR-084).
    const placed = phase === 'recording' ? this.loopPlace(e.atMs, e.type === 'note-on') : null;
    if (placed) {
      ch.pass = placed.pass;
      songSeconds = placed.songSeconds;
    }
    let input: RecordInput;
    switch (e.type) {
      case 'note-on':
        input = { type: 'note-on', pitch: e.pitch, velocity: e.velocity, songSeconds, ...ch };
        break;
      case 'note-off':
        input = { type: 'note-off', pitch: e.pitch, releaseVelocity: e.releaseVelocity, songSeconds, ...ch };
        break;
      case 'cc':
        input = { type: 'cc', controller: e.controller, value: e.value, songSeconds, ...ch };
        break;
      case 'pitch-bend':
        input = { type: 'pitch-bend', value: e.value, songSeconds, ...ch };
        break;
      case 'channel-pressure':
        input = { type: 'channel-pressure', value: e.value, songSeconds, ...ch };
        break;
      case 'poly-pressure':
        input = { type: 'poly-pressure', pitch: e.pitch, value: e.value, songSeconds, ...ch };
        break;
    }
    take.add(input);
  }

  /** Stops recording and playback; the take becomes ONE undo step. */
  stop(): void {
    if (this.countTimer) clearTimeout(this.countTimer);
    const phase = this.state.phase;
    this.detach?.();
    this.detach = null;
    if (phase === 'idle') return;
    const stopSeconds = this.transport.getPosition().seconds;
    this.transport.stop();
    this.transport.setTail(0);
    if (phase === 'count-in') {
      this.set({ phase: 'idle', countIn: 0, message: t('録音を取り消しました（カウントイン中）。') });
      return;
    }
    const project = this.store.project;
    const rec = project.settings.recording;
    const grid = rec.quantize ? gridTicks(project.ppq, project.settings.grid) : null;
    let p = project;
    const patch: Record<string, unknown> = {};
    let closed = 0;
    let count = 0;
    let lost = 0;
    try {
      for (const [trackId, take] of this.takes) {
        const res = take.finish(stopSeconds, this.loopPlace(performance.now(), false)?.pass);
        const events = res.takes.reduce((n, t) => n + t.events.length, 0);
        // the target track was deleted (or its creation undone) while recording: nothing to add to (ADR-084)
        if (!p.tracks.some((tr) => tr.id === trackId)) {
          lost += events;
          continue;
        }
        closed += res.closedAtStop;
        count += events;
        const replaceRange = rec.punch && this.loopAtStart ? { startTick: this.loopAtStart.startTick, endTick: this.loopAtStart.endTick } : undefined;
        const r = takeToCommand(p, trackId, res, { mode: rec.mode, loopChoice: rec.loopTakes, quantize: grid && grid.den === 1 ? grid : null, replaceRange });
        if (!r) continue;
        p = applyCommand(p, r.command).project;
        Object.assign(patch, r.command.patch);
      }
      const cmd: Command = { label: rec.mode === 'replace' ? '録音（置き換え）' : '録音', patch };
      this.store.run(Object.keys(patch).length ? cmd : null);
    } catch (e) {
      // never leave the recorder in 'recording' with the input detached: Record would refuse forever
      this.takes.clear();
      this.set({ phase: 'idle', countIn: 0, message: t('録音を保存できませんでした: {error}', { error: e instanceof Error ? e.message : String(e) }) });
      return;
    }
    this.takes.clear();
    const notes = closed ? t('押されたままのノート {n} 個を停止位置で終わらせました。', { n: closed }) : '';
    const early = this.early ? t('{n} 個のノートを開始位置に揃えました。', { n: this.early }) : '';
    const dropped = this.dropped ? t('早すぎたノート {n} 個は記録していません。', { n: this.dropped }) : '';
    const gone = lost ? t('録音中に削除されたトラックの {n} 個のイベントは追加できませんでした。', { n: lost }) : '';
    const rest = [notes, early, dropped, gone].filter(Boolean).join(' ');
    this.set({ phase: 'idle', countIn: 0, message: count ? t('{count} 個のイベントを録音しました。{rest}', { count, rest }) : t('録音されたイベントはありません。{rest}', { rest }) });
  }
}
