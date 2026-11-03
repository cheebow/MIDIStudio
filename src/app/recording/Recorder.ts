// Live recording orchestration (REQ-IN-04, INPUT_RECORDING 5). Input times (performance.now()
// domain, from KeyboardEvent / MIDIMessageEvent timeStamp) are mapped to song time through the
// Transport's engine position, then to ticks by LiveTake (TempoMap). The audio engine's clock is
// the reference; Date.now() is never used.
import { LiveTake, type RecordInput } from '../../core/recording/liveTake';
import { takeToCommand } from '../../core/recording/applyTake';
import { gridTicks } from '../../core/timing/grid';
import { applyCommand, type Command } from '../../core/editing/history';
import type { MidiProject } from '../../core/model/types';
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

/** Armed-track routing; ambiguous setups are refused (INPUT_RECORDING 1). */
export function recordTargets(p: MidiProject): RecordTargets | { error: string } {
  const armed = p.tracks.filter((t) => t.recordArm);
  if (armed.length === 0) return { error: t('録音待機（R）のトラックがありません。録音したいトラックの R を押してください。') };
  const melodic = armed.filter((t) => t.displayMode !== 'drum');
  const drums = armed.filter((t) => t.displayMode === 'drum');
  if (melodic.length > 1 || drums.length > 1) return { error: t('録音待機のトラックが複数あり、録音先があいまいです。鍵盤用・ドラム用それぞれ 1 トラックだけ R を押してください。') };
  const piano = melodic[0]?.id ?? drums[0]?.id ?? null;
  const drum = drums[0]?.id ?? melodic[0]?.id ?? null;
  return { piano, drum };
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
    const startTick = Math.round(this.transport.getPosition().tick);
    this.startSeconds = this.transport.getPosition().seconds;
    this.early = 0;
    this.dropped = 0;
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
      await this.transport.play(startTick);
    } catch (e) {
      // e.g. the audio engine could not start: do not stay in "recording" with the input attached
      this.stop();
      throw e;
    }
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
      songSeconds = this.startSeconds;
    }
    const ch = e.channel !== undefined ? { channel: e.channel } : {};
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
    for (const [trackId, take] of this.takes) {
      const res = take.finish(stopSeconds);
      closed += res.closedAtStop;
      count += res.takes.reduce((n, t) => n + t.events.length, 0);
      const replaceRange = rec.punch && this.loopAtStart ? { startTick: this.loopAtStart.startTick, endTick: this.loopAtStart.endTick } : undefined;
      const r = takeToCommand(p, trackId, res, { mode: rec.mode, loopChoice: rec.loopTakes, quantize: grid && grid.den === 1 ? grid : null, replaceRange });
      if (!r) continue;
      p = applyCommand(p, r.command).project;
      Object.assign(patch, r.command.patch);
    }
    this.takes.clear();
    const cmd: Command = { label: rec.mode === 'replace' ? '録音（置き換え）' : '録音', patch };
    this.store.run(Object.keys(patch).length ? cmd : null);
    const notes = closed ? t('押されたままのノート {n} 個を停止位置で終わらせました。', { n: closed }) : '';
    const early = this.early ? t('{n} 個のノートを開始位置に揃えました。', { n: this.early }) : '';
    const dropped = this.dropped ? t('早すぎたノート {n} 個は記録していません。', { n: this.dropped }) : '';
    const rest = [notes, early, dropped].filter(Boolean).join(' ');
    this.set({ phase: 'idle', countIn: 0, message: count ? t('{count} 個のイベントを録音しました。{rest}', { count, rest }) : t('録音されたイベントはありません。{rest}', { rest }) });
  }
}
