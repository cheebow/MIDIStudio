// Transport: the single source of truth for play state and position (REQ-PLAY-01/04, ARCHITECTURE E/F).
// Position = engine song seconds (audio clock) mapped through the project's TempoMap. The UI,
// metronome and visual mode read getPosition(); none of them count time on their own.
import { buildPlaybackSnapshot } from '../core/project-io/playbackSnapshot';
import { classifyPlaybackChange, type LiveController, type PlaybackChange } from '../core/project-io/playbackDiff';
import { chaseAt, chaseKey, chaseMessages } from '../core/events/chase';
import { portIndex } from '../core/model/ports';
import type { MidiProject } from '../core/model/types';
import { TempoMap } from '../core/timing/tempoMap';
import { TimeSignatureMap } from '../core/timing/timeSignatureMap';
import type { PlaybackEngine } from './PlaybackEngine';
import { t } from '../i18n';

export type TransportStatus = 'stopped' | 'playing' | 'paused';

export interface TransportState {
  status: TransportStatus;
  /** set while a song (re)load is in progress */
  loading: boolean;
  error: string | null;
  /** edits made while playing that the engine will pick up at the next stop / seek / loop wrap (ADR-048) */
  pendingEdits: boolean;
}

/**
 * Reload reasons that are applied at once even while playing (with the short gap of a reload):
 * transport-like controls the user expects to hear immediately. Everything else — notes, programs,
 * tempo, controllers after the playhead — waits for the next stop / seek / loop wrap, so playback
 * never stutters while editing (ADR-048).
 */
/** stands for the pitch bend in the set of performed controllers */
const PITCH_BEND = -1;
const IMMEDIATE_RELOAD = new Set(['first project', 'ppq', 'loop', 'track settings', 'tracks']);

export interface TransportPosition {
  tick: number;
  seconds: number;
  playing: boolean;
}

type Listener = (s: TransportState) => void;

export class TransportError extends Error {}

/** Bank Select (CC0 / CC32 at or before it) + the first Program Change of a track's own channel. */
export function firstSoundMessages(track: MidiProject['tracks'][number]): number[][] {
  const own = (e: { channelOverride?: number }) => e.channelOverride === undefined || e.channelOverride === track.channel;
  const events = [...track.events].sort((a, b) => a.tick - b.tick || a.originOrder - b.originOrder);
  const pc = events.find((e) => e.kind === 'program' && own(e));
  if (!pc || pc.kind !== 'program') return [];
  const ch = track.channel;
  const out: number[][] = [];
  let msb: number | undefined;
  let lsb: number | undefined;
  for (const e of events) {
    if (e === pc) break;
    if (e.kind === 'cc' && own(e) && e.controller === 0) msb = e.value;
    if (e.kind === 'cc' && own(e) && e.controller === 32) lsb = e.value;
  }
  if (msb !== undefined) out.push([0xb0 | ch, 0, msb]);
  if (lsb !== undefined) out.push([0xb0 | ch, 32, lsb]);
  out.push([0xc0 | ch, pc.program]);
  return out;
}

export class Transport {
  private project: MidiProject | null = null;
  private tempo: TempoMap | null = null;
  private signature: TimeSignatureMap | null = null;
  /** project object last loaded into the engine (identity check) */
  private loaded: MidiProject | null = null;
  /** tempo map of the song the engine has loaded (differs from `tempo` until an edit is reloaded) */
  private engineTempo: TempoMap | null = null;
  private engineSignature: TimeSignatureMap | null = null;
  private generation = 0;
  private state: TransportState = { status: 'stopped', loading: false, error: null, pendingEdits: false };
  private listeners = new Set<Listener>();
  /** position while not playing, in ticks */
  private parkedTick = 0;
  private previewNotes = new Map<string, number[]>();
  /** controllers (PITCH_BEND for the bend) the player has sent live, per "port:channel" */
  private performed = new Map<string, Set<number>>();
  private reloadChain: Promise<void> = Promise.resolve();
  /** keep the engine running until at least this tick (recording); 0 = song end */
  private tailTick = 0;
  /** pending live reload (edits while playing are gathered for a moment, then reloaded once) */
  private liveReload: { timer: ReturnType<typeof setTimeout>; waiters: (() => void)[] } | null = null;
  /**
   * The engine plays an older song whose difference (controller values) was sent live; the song is
   * reloaded at the next seek / play, and at a loop wrap when the old song would replay stale events.
   */
  private deferredStale = false;
  /** controllers whose live value differs from the loaded song (re-sent after a loop wrap) */
  private liveTouched = new Map<string, LiveController>();
  /** a stale event lies inside the loop: the next wrap must reload instead of re-sending */
  private staleInLoop = false;
  private lastPolledTick = 0;
  /** the reload in progress should start playing when done (cleared by pause / stop meanwhile) */
  private resumeAfterLoad = false;

  /**
   * @param reloadDelayMs edits committed while playing are gathered for this long before the
   * engine reloads once (a knob turned with the wheel commits many small edits).
   */
  constructor(
    private readonly engine: PlaybackEngine,
    private readonly reloadDelayMs = 150,
  ) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): TransportState {
    return this.state;
  }

  private setState(patch: Partial<TransportState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /**
   * Sets the project to play. Call this on committed edits only, not on every drag frame. While
   * playing (P11, ADR-039): an edit that does not change the playback snapshot (clip names, track
   * colours...) does nothing; an edit of controller values at or before the playhead is sent to the
   * synth live and the engine keeps running; anything else reloads the engine at a safe point and
   * resumes at the same musical position.
   */
  setProject(project: MidiProject): Promise<void> {
    const prev = this.project;
    // another song (new / open / sample): its playhead starts at the beginning, not where the previous
    // song was parked (its loop start, in ticks of possibly another PPQ)
    if (prev && prev.id !== project.id && this.state.status !== 'playing') this.parkedTick = 0;
    const prevTick = prev ? this.getPosition().tick : 0;
    this.project = project;
    this.tempo = new TempoMap(project.ppq, project.conductor.filter((c) => c.kind === 'tempo'));
    this.signature = new TimeSignatureMap(project.ppq, project.conductor.filter((c) => c.kind === 'time-signature'));
    if (this.state.status === 'stopped' && this.parkedTick === 0) return Promise.resolve();
    const change: PlaybackChange = prev ? classifyPlaybackChange(prev, project, Math.floor(prevTick)) : { kind: 'reload', reason: 'first project' };
    if (this.state.status !== 'playing') {
      this.parkedTick = prevTick;
      if (change.kind === 'none' && this.loaded === prev) this.loaded = project; // the next play needs no reload
      return Promise.resolve();
    }
    if (change.kind === 'reload' && !IMMEDIATE_RELOAD.has(change.reason)) {
      this.deferContent(project);
      return Promise.resolve();
    }
    if (this.liveReload || this.state.loading) return this.scheduleLiveReload(); // joins the pending reload
    if (change.kind === 'none') {
      if (this.loaded === prev) this.loaded = project;
      return Promise.resolve();
    }
    if (change.kind === 'live' && this.sendLive(project, change, prevTick)) return Promise.resolve();
    return this.scheduleLiveReload();
  }

  /**
   * A content edit while playing (ADR-048): the engine keeps the song it plays, so nothing
   * stutters; the edited song is loaded at the next stop / pause → play, seek, or loop wrap
   * (from the loop start, like a stale event in the loop). The UI shows that edits are waiting.
   */
  private deferContent(project: MidiProject): void {
    this.deferredStale = true;
    if (project.loop.enabled) this.staleInLoop = true;
    if (!this.state.pendingEdits) this.setState({ pendingEdits: true });
  }

  /**
   * Applies a controller-only edit to the running engine: sends the value now in effect for each
   * touched controller (handles changed, added and removed events alike). Returns false when a
   * controller has no value in effect any more (the engine must reload to forget it).
   */
  private sendLive(project: MidiProject, change: Extract<PlaybackChange, { kind: 'live' }>, tick: number): boolean {
    this.lastPolledTick = Math.min(this.lastPolledTick, tick);
    const chase = chaseAt(project, Math.floor(tick) + 1);
    const out: { port: number; bytes: number[] }[] = [];
    for (const c of change.controllers) {
      const v = chase.channels.get(chaseKey(c.port, c.channel))?.controllers.get(c.controller);
      if (v === undefined) return false;
      out.push({ port: c.port, bytes: [0xb0 | c.channel, c.controller, v] });
    }
    for (const m of out) this.engine.send(m.bytes, m.port, 'both');
    for (const c of change.controllers) this.liveTouched.set(`${c.port}:${c.channel}:${c.controller}`, c);
    this.deferredStale = true;
    if (project.loop.enabled && change.maxTick > project.loop.startTick) this.staleInLoop = true;
    return true;
  }

  /** After a loop wrap the old song chased its old values: send the live values again. */
  private resendLive(): void {
    const project = this.project;
    if (!project) return;
    const chase = chaseAt(project, Math.floor(this.getPosition().tick) + 1);
    for (const c of this.liveTouched.values()) {
      const v = chase.channels.get(chaseKey(c.port, c.channel))?.controllers.get(c.controller);
      if (v !== undefined) this.engine.send([0xb0 | c.channel, c.controller, v], c.port, 'both');
    }
  }

  /** Gathers edits made while playing and reloads once, at the position playing at that moment. */
  private scheduleLiveReload(): Promise<void> {
    const waiters = this.liveReload?.waiters ?? [];
    if (this.liveReload) clearTimeout(this.liveReload.timer);
    const done = new Promise<void>((resolve) => waiters.push(resolve));
    const timer = setTimeout(() => this.flushLiveReload(), this.reloadDelayMs);
    this.liveReload = { timer, waiters };
    return done;
  }

  /** Runs a pending live reload now (atTick: where to resume; default the current position). */
  private flushLiveReload(atTick?: number): void {
    const pending = this.liveReload;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.liveReload = null;
    const run = this.state.status === 'playing' ? this.enqueueReload(atTick ?? null, true) : Promise.resolve();
    void run.then(() => pending.waiters.forEach((w) => w()));
  }

  /** Drops a pending live reload (pause / stop); the next play reloads because `loaded` is stale. */
  private cancelLiveReload(): void {
    const pending = this.liveReload;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.liveReload = null;
    pending.waiters.forEach((w) => w());
  }

  /** atTick null = the position playing when the reload actually starts (queued reloads included). */
  private enqueueReload(atTick: number | null, resume: boolean): Promise<void> {
    this.reloadChain = this.reloadChain.then(() => this.reload(atTick ?? this.getPosition().tick, resume)).catch(() => undefined);
    return this.reloadChain;
  }

  private async reload(atTick: number, resume: boolean): Promise<void> {
    const project = this.project;
    const tempo = this.tempo;
    const signature = this.signature;
    if (!project || !tempo) return;
    this.deferredStale = false;
    this.staleInLoop = false;
    this.liveTouched.clear();
    const gen = ++this.generation;
    const wasPlaying = this.engine.isPlaying();
    if (wasPlaying) this.engine.pause();
    // While loading, the engine's clock is not the song position (it may be reset by the load);
    // the position reported meanwhile, and used by edits queued meanwhile, is this one.
    this.parkedTick = atTick;
    this.resumeAfterLoad = resume;
    this.setState({ loading: true, pendingEdits: false });
    try {
      const snap = buildPlaybackSnapshot(project, { tailTick: this.tailTick });
      await this.engine.loadSong({ smf: snap.smf, fileName: `${project.title || 'song'}.mid`, loop: snap.loop, ...(this.tailTick ? { minEndTick: this.tailTick } : {}) });
      if (gen !== this.generation) return;
      this.loaded = project;
      this.engineTempo = tempo;
      this.engineSignature = signature;
      // A seek during the load moved parkedTick; a pause / stop during the load cleared the resume.
      const play = this.resumeAfterLoad;
      this.engine.seekSeconds(tempo.tickToSeconds(this.parkedTick));
      if (play) this.engine.play();
      this.lastPolledTick = this.parkedTick;
      this.setState({ loading: false, error: null, status: play ? 'playing' : this.state.status });
      // An edit committed while this load was in flight and the transport was not playing (the
      // first play, or a play after a pause) only parked its position in setProject: the engine
      // now plays the song this load started with. Catch up, unless nothing audible changed.
      const latest = this.project;
      if (latest && latest !== project && !this.liveReload) {
        const change = classifyPlaybackChange(project, latest, Math.floor(this.parkedTick));
        if (change.kind === 'none') this.loaded = latest;
        else if (play && change.kind === 'reload' && !IMMEDIATE_RELOAD.has(change.reason)) this.deferContent(latest);
        else if (play) void this.enqueueReload(null, true);
        // not playing: the next play() reloads because loaded !== project
      }
    } catch (e) {
      if (gen !== this.generation) return;
      this.setState({ loading: false, error: (e as Error).message, status: 'stopped' });
      throw e;
    }
  }

  /**
   * Loads the song into the engine, parked at `tick`, without playing. The recorder does this under
   * the count-in, so the downbeat is not late by the time the load takes. Does nothing when the
   * engine already has the song; throws when the load fails.
   */
  async prepare(tick: number): Promise<void> {
    if (!this.project || !this.tempo || !this.engine.ready) return;
    if (this.loaded === this.project) return;
    await this.enqueueReload(tick, false);
    // a failed load leaves its message in the state (the reload queue itself never rejects)
    if (this.loaded !== this.project && this.state.error) throw new TransportError(this.state.error);
  }

  async play(fromTick?: number): Promise<void> {
    if (!this.project || !this.tempo) throw new TransportError(t('曲が読み込まれていません。'));
    if (!this.engine.ready) {
      const msg = t('音源（SoundFont）の準備ができていません。読み込みが終わるまでお待ちください（File → 「SoundFont を選ぶ」でローカルの .sf2 も使えます）。');
      this.setState({ error: msg });
      throw new TransportError(msg);
    }
    const start = fromTick ?? this.parkedTick;
    if (this.loaded !== this.project) {
      await this.enqueueReload(start, true);
      return;
    }
    this.engine.seekSeconds(this.tempo.tickToSeconds(start));
    this.engine.play();
    this.setState({ status: 'playing', error: null });
  }

  /**
   * Recording: keep playing past the end of the song (or in an empty song) until `tick`.
   * Pass 0 to return to normal playback. Takes effect at the next (re)load.
   */
  setTail(tick: number): void {
    if (tick === this.tailTick) return;
    this.tailTick = tick;
    this.loaded = null; // force a reload with the new snapshot
  }

  pause(): void {
    this.resumeAfterLoad = false;
    if (this.state.status !== 'playing') return;
    this.cancelLiveReload();
    this.parkedTick = this.getPosition().tick;
    this.engine.pause();
    this.engine.panic();
    this.setState({ status: 'paused', pendingEdits: false }); // the next play loads the edited song
  }

  /** Stops and returns to the start (or to the loop start when looping). Silences all notes. */
  stop(): void {
    this.resumeAfterLoad = false;
    this.cancelLiveReload();
    this.engine.pause();
    this.engine.panic();
    this.releaseAllPreviews();
    this.parkedTick = this.project?.loop.enabled ? this.project.loop.startTick : 0;
    if (this.tempo && this.loaded) this.engine.seekSeconds(this.tempo.tickToSeconds(this.parkedTick));
    this.setState({ status: 'stopped', pendingEdits: false });
  }

  togglePlay(): Promise<void> {
    if (this.state.status === 'playing') {
      this.pause();
      return Promise.resolve();
    }
    // A second press while play() is still loading the song cancels that start (ADR-083); it used
    // to queue a second load that restarted from the start position.
    if (this.state.loading && this.resumeAfterLoad) {
      this.resumeAfterLoad = false;
      return Promise.resolve();
    }
    return this.play();
  }

  /** Seek to a tick. While playing, playback continues from there; the engine chases state. */
  seek(tick: number): void {
    const t = Math.max(0, Math.round(tick));
    this.parkedTick = t;
    this.lastPolledTick = t; // a backward seek is not a loop wrap (poll)
    if (this.liveReload) this.flushLiveReload(t); // the pending reload resumes there
    else if (this.deferredStale && this.state.status === 'playing') void this.enqueueReload(t, true);
    else if (this.tempo && this.loaded === this.project) this.engine.seekSeconds(this.tempo.tickToSeconds(t));
    this.setState({}); // notify position subscribers
  }

  getPosition(): TransportPosition {
    if (!this.tempo) return { tick: 0, seconds: 0, playing: false };
    if (this.state.status === 'playing' && !this.state.loading) {
      if (this.engine.isFinished()) return { tick: 0, seconds: 0, playing: false };
      const seconds = this.engine.getSeconds();
      // until a pending edit is reloaded, the engine plays the previous song (and tempo map)
      const map = this.engineTempo ?? this.tempo;
      return { tick: map.secondsToTick(seconds), seconds: this.tempo.tickToSeconds(map.secondsToTick(seconds)), playing: true };
    }
    return { tick: this.parkedTick, seconds: this.tempo.tickToSeconds(this.parkedTick), playing: false };
  }

  /**
   * Detects the end of the song (the engine stops by itself). Call periodically while playing,
   * outside of rendering (the position hook does this every animation frame).
   */
  poll(): void {
    if (this.state.status !== 'playing' || this.state.loading) return;
    if (this.engine.isFinished()) {
      this.parkedTick = 0;
      this.setState({ status: 'stopped', pendingEdits: false });
      return;
    }
    const tick = this.getPosition().tick;
    // A wrap is a real jump backwards. The engine's clock may read a fraction of a tick less than
    // on the previous poll (its time estimate is not strictly monotonic), which must not count:
    // with a deferred edit it would reload from the loop start in the middle of the loop.
    if (this.deferredStale && tick < this.lastPolledTick - (this.project?.ppq ?? 480) / 4) {
      // Loop wrap with live-applied changes. The old song chased its old values at the wrap: send
      // the live values again. When a stale event lies inside the loop it would replay, so reload
      // instead — from the loop start, so the notes at the start are not lost to the load time.
      if (this.staleInLoop) void this.enqueueReload(this.project?.loop.enabled ? this.project.loop.startTick : null, true);
      else this.resendLive();
    }
    this.lastPolledTick = tick;
  }

  get tempoMap(): TempoMap | null {
    return this.tempo;
  }

  get timeSignatureMap(): TimeSignatureMap | null {
    return this.signature;
  }

  /**
   * The maps of the song the engine is actually playing. A tempo / time-signature edit while
   * playing is loaded later (ADR-048), so anything clocked by the engine's seconds (the metronome)
   * must use these, not the edited maps, or it drifts off the music (ADR-083).
   */
  get playingMaps(): { tempo: TempoMap; signature: TimeSignatureMap; loop: { startSeconds: number; endSeconds: number } | null } | null {
    const tempo = this.engineTempo ?? this.tempo;
    const signature = this.engineSignature ?? this.signature;
    if (!tempo || !signature) return null;
    const l = (this.loaded ?? this.project)?.loop;
    const loop = l?.enabled && l.endTick > l.startTick ? { startSeconds: tempo.tickToSeconds(l.startTick), endSeconds: tempo.tickToSeconds(l.endTick) } : null;
    return { tempo, signature, loop };
  }

  // ------------------------------------------------------------ live preview

  /** the song's SysEx (up to the playhead) the preview synth was last given */
  private previewSysEx = '';

  /**
   * The preview synth gets the song's SysEx too, when the set in effect changes (not per note): a
   * part made a rhythm part by GS "Use for Rhythm Part" plays drums in the song, and the keys and
   * pads have to audition the same kit.
   */
  private sendPreviewSysEx(list: ReturnType<typeof chaseAt>['sysex']): void {
    const key = list.map((s) => `${s.port}:${s.status}:${Array.from(s.data).join(',')}`).join('|');
    if (key === this.previewSysEx) return;
    this.previewSysEx = key;
    for (const s of list) if (s.status === 'F0') this.engine.send([0xf0, ...s.data], s.port);
  }

  /**
   * Plays a preview note on a track's port/channel on the separate preview synth (ARCHITECTURE F),
   * so sequencer loops, seeks and reloads never cut a note that is being played live.
   */
  auditionNote(trackId: string, pitch: number, velocity: number, sourceId = 'default'): void {
    const project = this.project;
    const track = project?.tracks.find((t) => t.id === trackId);
    if (!project || !track || !this.engine.ready) return;
    const port = portIndex(track.port);
    const ch = track.channel;
    // Previews play on their own synth: give its channel the song's state at the playhead
    // (bank / program / controllers), or the track's first sound when none is set yet.
    // Controllers the player is driving right now (pedal, wheels) keep their live value: re-sending
    // the song's CC64 = 0 on every note would lift a held pedal (ADR-082).
    const state = chaseAt(project, Math.floor(this.getPosition().tick) + 1);
    this.sendPreviewSysEx(state.sysex);
    const chase = state.channels.get(`${port}:${ch}`);
    const live = this.performed.get(`${port}:${ch}`);
    if (chase) {
      for (const m of chaseMessages(chase)) {
        const type = m[0] & 0xf0;
        if (live && ((type === 0xb0 && live.has(m[1])) || (type === 0xe0 && live.has(PITCH_BEND)))) continue;
        this.engine.send(m, port);
      }
    }
    if (!chase || chase.program === undefined) for (const m of firstSoundMessages(track)) this.engine.send(m, port);
    // keyed by track, released on the port / channel it was played on: the track may change
    // channel or be deleted while the key is held (ADR-087)
    const key = `${sourceId}:${trackId}:${pitch}`;
    const prev = this.previewNotes.get(key);
    if (prev) this.engine.send([0x80 | prev[1], prev[2], 0], prev[0]);
    this.previewNotes.set(key, [port, ch, pitch]);
    this.engine.send([0x90 | ch, pitch, Math.max(1, Math.min(127, velocity))], port);
  }

  /**
   * Preview with a given program on a port / channel no track owns yet (the guitar-voicing dialog's
   * "new guitar track", ADR-091). Only the preview synth hears the Program Change; a later audition on
   * that channel sends the song's state again first. Released by releaseAllPreviews(sourceId).
   */
  auditionProgram(port: string, channel: number, program: number, pitch: number, velocity: number, sourceId: string): void {
    if (!this.engine.ready) return;
    const p = portIndex(port);
    const ch = channel & 0x0f;
    this.engine.send([0xb0 | ch, 0, 0], p);
    this.engine.send([0xb0 | ch, 32, 0], p);
    this.engine.send([0xc0 | ch, program & 0x7f], p);
    const key = `${sourceId}:program:${pitch}`;
    const prev = this.previewNotes.get(key);
    if (prev) this.engine.send([0x80 | prev[1], prev[2], 0], prev[0]);
    this.previewNotes.set(key, [p, ch, pitch]);
    this.engine.send([0x90 | ch, pitch, Math.max(1, Math.min(127, velocity))], p);
  }

  releaseAuditionNote(trackId: string, pitch: number, sourceId = 'default'): void {
    const key = `${sourceId}:${trackId}:${pitch}`;
    const held = this.previewNotes.get(key);
    if (!held) return;
    this.previewNotes.delete(key);
    this.engine.send([0x80 | held[1], held[2], 0], held[0]);
  }

  /**
   * Live controller message (CC / bend / pressure) on a track's port and channel. `performed`: it
   * comes from the player (MIDI keyboard, Tab sustain), so previews keep that value instead of the
   * song's (the mixer's live preview is not a performance and leaves the chase alone).
   */
  sendToTrack(trackId: string, bytes: number[], opts: { performed?: boolean } = {}): void {
    const track = this.project?.tracks.find((t) => t.id === trackId);
    if (!track || !this.engine.ready) return;
    const port = portIndex(track.port);
    const type = bytes[0] & 0xf0;
    if (opts.performed && (type === 0xb0 || type === 0xe0)) {
      const key = `${port}:${track.channel}`;
      const live = this.performed.get(key) ?? new Set<number>();
      live.add(type === 0xe0 ? PITCH_BEND : bytes[1]);
      this.performed.set(key, live);
    }
    this.engine.send([type | track.channel, ...bytes.slice(1)], port, 'both');
  }

  /** Releases every preview note (focus loss, mode change, device unplugged...). */
  releaseAllPreviews(sourceId?: string): void {
    for (const [key, [port, ch, pitch]] of this.previewNotes) {
      if (sourceId !== undefined && !key.startsWith(`${sourceId}:`) && !key.startsWith(`${sourceId}#`)) continue; // (MIDI sources are per channel)
      this.engine.send([0x80 | ch, pitch, 0], port);
      this.previewNotes.delete(key);
    }
  }

  get activePreviewCount(): number {
    return this.previewNotes.size;
  }

  /**
   * Safety panic: all voices off, previews cleared; transport state is kept. The pedals go up and
   * the bend goes to centre on every channel of the song's ports, on both synths: stopping the voices
   * alone leaves a held CC64 sustaining every later note (ADR-087).
   */
  panic(): void {
    this.previewNotes.clear();
    this.performed.clear();
    this.engine.panic();
    if (!this.engine.ready) return;
    const ports = new Set([0, ...(this.project?.tracks ?? []).map((t) => portIndex(t.port))]);
    for (const port of ports) {
      for (let ch = 0; ch < 16; ch++) {
        for (const c of [64, 66, 67]) this.engine.send([0xb0 | ch, c, 0], port, 'both');
        this.engine.send([0xe0 | ch, 0, 64], port, 'both');
      }
    }
  }
}
