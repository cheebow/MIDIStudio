// The only module that talks to spessasynth_lib (CLAUDE.md rule 2). Core/model types never leak in:
// the adapter receives SMF bytes and SoundFont bytes only.
// Based on MML Studio src/audio/SoundFontPlaybackAdapter.ts (same author); implements the
// seconds-based PlaybackEngine used by the Transport (ADR-018). spessasynth_lib is loaded on demand (first audio start).
//
// Verified against node_modules/spessasynth_lib@4.4.2 dist/index.d.ts (see docs/DECISIONS.md ADR-012).
import type { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
import type { EngineSong, PlaybackEngine } from './PlaybackEngine';
import { t } from '../i18n';

/** Minimal structural type of spessasynth's MIDIPatchFull (kept local to the adapter). */
interface MIDIPatchFull {
  program: number;
  bankMSB: number;
  bankLSB: number;
  isGMGSDrum: boolean;
  isDrum: boolean;
  name: string;
}

export interface SoundBankReport {
  presetCount: number;
  /** GM programs (0..127) without a bank-0 melodic preset */
  missingPrograms: number[];
  hasDrumKit: boolean;
}

export function gmCoverage(list: readonly MIDIPatchFull[]): SoundBankReport {
  const melodic = new Set(list.filter((p) => !p.isDrum && p.bankMSB === 0).map((p) => p.program));
  const missingPrograms: number[] = [];
  for (let p = 0; p < 128; p++) if (!melodic.has(p)) missingPrograms.push(p);
  return { presetCount: list.length, missingPrograms, hasDrumKit: list.some((p) => p.isDrum) };
}

export type PlaybackErrorKind =
  | 'audioworklet-unsupported'
  | 'audiocontext-resume'
  | 'worklet-load'
  | 'synth-init'
  | 'soundfont-load'
  | 'soundfont-missing'
  | 'midi-load';

export class PlaybackError extends Error {
  constructor(
    readonly kind: PlaybackErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Rejects with `error` when `promise` does not settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(error()), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export const TIMEOUTS = { resumeMs: 5000, workletMs: 15000, synthMs: 15000, songMs: 20000 };

interface Engine {
  context: AudioContext;
  synth: WorkletSynthesizer;
  /** second synth for live preview: sequencer loops / seeks / reloads stop every voice of `synth` */
  preview: WorkletSynthesizer;
  previewChannels: number;
  sequencer: Sequencer;
  lib: typeof import('spessasynth_lib');
  core: typeof import('spessasynth_core');
}

export class SpessaAdapter implements PlaybackEngine {
  private enginePromise: Promise<Engine> | null = null;
  private engine: Engine | null = null;
  private loadGeneration = 0;
  private pendingContext: AudioContext | null = null;
  private soundBankLoaded = false;

  constructor(private readonly workletUrl: string) {}

  /**
   * Call synchronously from a click handler: creates / resumes the AudioContext while the user
   * activation is still valid (Safari requires this).
   */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    const ctx = this.engine?.context ?? this.pendingContext ?? (this.pendingContext = new AudioContext());
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  }

  /**
   * Tries to start audio without a user gesture (browsers allow it on sites the user engages with).
   * Resolves true when the AudioContext is running; nothing else is started.
   */
  async tryAutoStart(): Promise<boolean> {
    if (typeof AudioContext === 'undefined') return false;
    const ctx = this.engine?.context ?? this.pendingContext ?? (this.pendingContext = new AudioContext());
    if (ctx.state === 'running') return true;
    try {
      await withTimeout(ctx.resume(), 400, () => new Error('timeout'));
    } catch {
      /* needs a gesture */
    }
    return (ctx.state as AudioContextState) === 'running'; // re-read after resume (TS narrows it above)
  }

  /** Must be called from a user gesture. Concurrent calls share one promise. */
  initialize(): Promise<Engine> {
    if (!this.enginePromise) {
      this.enginePromise = this.createEngine().catch((e: unknown) => {
        this.enginePromise = null;
        throw e;
      });
    }
    return this.enginePromise;
  }

  private async createEngine(): Promise<Engine> {
    if (typeof AudioWorkletNode === 'undefined') {
      throw new PlaybackError('audioworklet-unsupported', t('このブラウザは AudioWorklet に対応していません。'));
    }
    const context = this.pendingContext ?? new AudioContext();
    this.pendingContext = null;
    const fail = async (error: PlaybackError): Promise<never> => {
      await context.close().catch(() => undefined);
      throw error;
    };
    try {
      await withTimeout(context.resume(), TIMEOUTS.resumeMs, () => new Error('timeout'));
    } catch (cause) {
      return fail(
        new PlaybackError(
          'audiocontext-resume',
          t('ブラウザが音声の再生を開始できませんでした（自動再生の制限）。画面をもう一度クリックしてください。'),
          { cause },
        ),
      );
    }
    let lib: typeof import('spessasynth_lib');
    let core: typeof import('spessasynth_core');
    try {
      [lib, core] = await Promise.all([
        import('spessasynth_lib'),
        import('spessasynth_core'),
        withTimeout(context.audioWorklet.addModule(this.workletUrl), TIMEOUTS.workletMs, () => new Error('timeout')),
      ]);
    } catch (cause) {
      return fail(new PlaybackError('worklet-load', t('AudioWorklet ({url}) を読み込めませんでした。ページを再読み込みしてください。', { url: this.workletUrl }), { cause }));
    }
    const synth = new lib.WorkletSynthesizer(context);
    synth.connect(context.destination);
    try {
      await withTimeout(synth.isReady, TIMEOUTS.synthMs, () => new Error('timeout'));
    } catch (cause) {
      synth.destroy();
      return fail(new PlaybackError('synth-init', t('シンセサイザーを初期化できませんでした。ページを再読み込みしてください。'), { cause }));
    }
    const preview = new lib.WorkletSynthesizer(context);
    preview.connect(context.destination);
    try {
      await withTimeout(preview.isReady, TIMEOUTS.synthMs, () => new Error('timeout'));
    } catch (cause) {
      synth.destroy();
      preview.destroy();
      return fail(new PlaybackError('synth-init', t('試聴用シンセサイザーを初期化できませんでした。ページを再読み込みしてください。'), { cause }));
    }
    const sequencer = new lib.Sequencer(synth, { skipToFirstNoteOn: false });
    this.engine = { context, synth, preview, previewChannels: 16, sequencer, lib, core };
    return this.engine;
  }

  get isSoundBankLoaded(): boolean {
    return this.soundBankLoaded;
  }

  /** Replaces the main sound bank. The ArrayBuffer is transferred (detached) to the worklet. */
  async loadSoundBank(buffer: ArrayBuffer): Promise<SoundBankReport> {
    const { synth, sequencer, preview } = await this.initialize();
    sequencer.pause();
    synth.stopAll(true);
    preview.stopAll(true);
    const presets = new Promise<MIDIPatchFull[]>((resolve) => {
      const timer = setTimeout(() => resolve(synth.presetList), 3000);
      synth.eventHandler.addEvent('presetListChange', 'midi-studio-bank', (list) => {
        clearTimeout(timer);
        resolve(list);
      });
    });
    // the buffer is transferred (detached) to the worklet, so the preview synth gets its own copy
    const copy = buffer.slice(0);
    try {
      await synth.soundBankManager.addSoundBank(buffer, 'main');
      await this.engine!.preview.soundBankManager.addSoundBank(copy, 'main');
    } catch (cause) {
      throw new PlaybackError('soundfont-load', t('SoundFont を読み込めませんでした（SF2 として不正な可能性があります）。'), { cause });
    }
    this.soundBankLoaded = true;
    return gmCoverage(await presets);
  }

  /**
   * Loads a song snapshot; resolves when the sequencer reports songChange.
   * Loop points are set on the parsed BasicMIDI (ticks) and enabled with loopCount = Infinity
   * (ADR-012: there is no `loop` property on the Sequencer).
   */
  async loadSong(song: EngineSong): Promise<void> {
    const generation = ++this.loadGeneration;
    const { synth, sequencer, core } = await this.initialize();
    sequencer.pause();
    synth.stopAll(true);
    let midi: InstanceType<typeof core.BasicMIDI>;
    try {
      midi = core.BasicMIDI.fromArrayBuffer(song.smf.slice().buffer, song.fileName);
    } catch (cause) {
      throw new PlaybackError('midi-load', t('再生用の MIDI を準備できませんでした: {message}', { message: (cause as Error).message }), { cause });
    }
    if (song.loop) {
      midi.loop = { start: song.loop.startTick, end: song.loop.endTick, type: 'hard' };
      midi.lastVoiceEventTick = Math.max(midi.lastVoiceEventTick, song.loop.endTick);
    }
    // The sequencer ends at the last voice event (meta events do not count); extend it for recording.
    if (song.minEndTick) midi.lastVoiceEventTick = Math.max(midi.lastVoiceEventTick, song.minEndTick);
    const done = new Promise<void>((resolve, reject) => {
      sequencer.eventHandler.addEvent('songChange', 'midi-studio-load', () => resolve());
      sequencer.eventHandler.addEvent('midiError', 'midi-studio-load', (e) =>
        reject(new PlaybackError('midi-load', t('MIDI を読み込めませんでした: {message}', { message: e.message }), { cause: e })),
      );
    });
    sequencer.loadNewSongList([midi]);
    await withTimeout(done, TIMEOUTS.songMs, () => new PlaybackError('midi-load', t('MIDI の読み込みが時間内に終わりませんでした。')));
    if (generation !== this.loadGeneration) return;
    sequencer.loopCount = song.loop ? Infinity : 0;
    sequencer.pause();
  }

  private meters: { analysers: AnalyserNode[]; buf: Float32Array<ArrayBuffer>; levels: number[] } | null = null;

  /**
   * Peak level (0..1, linear) of each of the 16 MIDI channels right now, sequencer and live preview
   * together, from SpessaSynth's per-channel visualization outputs (`connectChannel`). Channels of
   * port B and later roll over onto the same 16 outputs. null until the engine runs.
   */
  channelLevels(): readonly number[] | null {
    const e = this.engine;
    if (!e || !this.soundBankLoaded) return null;
    if (!this.meters) {
      const analysers = Array.from({ length: 16 }, (_, ch) => {
        const a = e.context.createAnalyser();
        a.fftSize = 512;
        e.synth.connectChannel(a, ch);
        e.preview.connectChannel(a, ch);
        return a;
      });
      this.meters = { analysers, buf: new Float32Array(512), levels: new Array<number>(16).fill(0) };
    }
    const m = this.meters;
    for (let ch = 0; ch < 16; ch++) {
      m.analysers[ch].getFloatTimeDomainData(m.buf);
      let peak = 0;
      for (let i = 0; i < m.buf.length; i++) peak = Math.max(peak, Math.abs(m.buf[i]));
      m.levels[ch] = peak;
    }
    return m.levels;
  }

  get ready(): boolean {
    return this.soundBankLoaded && this.engine !== null;
  }

  private requireSoundBank(): void {
    if (!this.soundBankLoaded) {
      throw new PlaybackError('soundfont-missing', t('音源（SoundFont）が読み込まれていません。標準 SoundFont を読み込むか、ローカルの .sf2 を選んでください。'));
    }
  }

  play(): void {
    this.requireSoundBank();
    this.engine?.sequencer.play();
  }

  pause(): void {
    this.engine?.sequencer.pause();
  }

  seekSeconds(seconds: number): void {
    if (!this.engine) return;
    this.engine.sequencer.currentTime = Math.max(0, seconds);
  }

  getSeconds(): number {
    return this.engine?.sequencer.currentHighResolutionTime ?? 0;
  }

  isPlaying(): boolean {
    return !!this.engine && !this.engine.sequencer.paused;
  }

  isFinished(): boolean {
    return this.engine?.sequencer.isFinished ?? false;
  }

  /** Raw message to the synth. Port n addresses channels n*16.. (SpessaSynth multi-port offset). */
  send(message: number[], port = 0, target: 'preview' | 'both' = 'preview'): void {
    if (!this.engine || !this.soundBankLoaded) return;
    const e = this.engine;
    while (e.previewChannels < (port + 1) * 16) {
      e.preview.addNewChannel();
      e.previewChannels++;
    }
    e.preview.sendMessage(message, port * 16);
    if (target === 'both') e.synth.sendMessage(message, port * 16);
  }

  songTimeToContextTime(seconds: number): number | null {
    if (!this.engine || this.engine.sequencer.paused) return null;
    const { sequencer, context } = this.engine;
    return context.currentTime + (seconds - sequencer.currentTime) / sequencer.playbackRate;
  }

  get audioContext(): AudioContext | null {
    return this.engine?.context ?? null;
  }

  /** Stops every sounding voice immediately (sequencer keeps its position). */
  panic(): void {
    if (!this.engine) return;
    this.engine.synth.stopAll(true);
    this.engine.preview.stopAll(true);
  }

  /** Drum kit programs (0..127) offered by the loaded sound bank (from the synth preset list). */
  drumKitPrograms(): number[] {
    const list = (this.engine?.synth.presetList ?? []) as unknown as MIDIPatchFull[];
    return [...new Set(list.filter((p) => p.isDrum).map((p) => p.program))].sort((a, b) => a - b);
  }

  /** Number of synth channels (16 per port; >16 after multi-port / double-module songs). */
  get channelCount(): number {
    return this.engine?.synth.midiChannels.length ?? 0;
  }

  get duration(): number {
    return this.engine?.sequencer.duration ?? 0;
  }

  get audioContextState(): AudioContextState | 'none' {
    return this.engine?.context.state ?? 'none';
  }

  async dispose(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    this.enginePromise = null;
    this.soundBankLoaded = false;
    this.meters = null;
    this.pendingContext = null;
    if (!engine) return;
    engine.sequencer.pause();
    engine.synth.stopAll(true);
    engine.synth.destroy();
    engine.preview.destroy();
    await engine.context.close();
  }
}
