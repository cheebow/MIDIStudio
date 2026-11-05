// Connects keyboard / on-screen pad input to preview playback (Phase 4) and, later, recording
// (Phase 6). Holds the KeyboardRouter and exposes mode + held notes for the UI.
import type { MidiProject, SavedInputPresets } from '../core/model/types';
import type { Transport } from '../playback/Transport';
import { KeyboardRouter, type InputMode, type KeyInput, type MusicalInputEvent, type RouteResult } from './KeyboardRouter';
import type { ParsedMidiInput } from './midiMessages';
import { inputTargets } from '../core/model/selectedTrack';

/** Every input after normalisation (INPUT_RECORDING 1): what recorders receive. */
export type CapturedInput =
  | { type: 'note-on'; pitch: number; velocity: number; atMs: number; target: 'piano' | 'drum'; sourceId: string; channel?: number }
  | { type: 'note-off'; pitch: number; releaseVelocity: number; atMs: number; target: 'piano' | 'drum'; sourceId: string; channel?: number }
  | { type: 'cc'; controller: number; value: number; atMs: number; target: 'piano' | 'drum'; sourceId: string; channel?: number }
  | { type: 'pitch-bend'; value: number; atMs: number; target: 'piano' | 'drum'; sourceId: string; channel?: number }
  | { type: 'channel-pressure'; value: number; atMs: number; target: 'piano' | 'drum'; sourceId: string; channel?: number }
  | { type: 'poly-pressure'; pitch: number; value: number; atMs: number; target: 'piano' | 'drum'; sourceId: string; channel?: number };

export interface InputSnapshot {
  mode: InputMode;
  /** pitches currently held, by target */
  pianoHeld: ReadonlySet<number>;
  drumHeld: ReadonlySet<number>;
}

type Listener = () => void;

export class InputController {
  private readonly router: KeyboardRouter;
  private snapshot: InputSnapshot = { mode: 'edit-shortcuts', pianoHeld: new Set(), drumHeld: new Set() };
  private listeners = new Set<Listener>();
  /** track that received each held note (so note-off goes to the same place) */
  private routed = new Map<string, string>();
  /**
   * Pedals (CC64 / 66 / 67) down and pitch bend away from centre, per MIDI source: released with
   * the source's notes when the device goes away (ADR-087). key = `${source}:${target}:${controller | -1}`
   */
  private heldControls = new Map<string, { sourceId: string; target: 'piano' | 'drum'; controller: number; channel?: number }>();
  /** extra consumers (step / live recorders) */
  private sinks = new Set<(e: CapturedInput, trackId: string | null) => void>();
  /** keep the incoming MIDI channel on recorded events instead of the track channel */
  private _keepMidiChannel = false;

  get keepMidiChannel(): boolean {
    return this._keepMidiChannel;
  }

  setKeepMidiChannel(on: boolean): void {
    this._keepMidiChannel = on;
    this.update({});
  }
  private sustainOn = false;

  constructor(
    private readonly transport: Transport,
    private readonly getProject: () => MidiProject,
    presets: SavedInputPresets,
  ) {
    this.router = new KeyboardRouter(presets, (e) => this.dispatch(e), () => performance.now());
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  addSink(fn: (e: CapturedInput, trackId: string | null) => void): () => void {
    this.sinks.add(fn);
    return () => this.sinks.delete(fn);
  }

  private update(patch: Partial<InputSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  get mode(): InputMode {
    return this.router.mode;
  }

  setMode(mode: InputMode): void {
    this.router.setMode(mode);
    // The Tab pedal belongs to the PC-keyboard mode: leaving it lifts the pedal (ADR-083)
    if (this.sustainOn && mode !== 'piano-performance') this.setSustain(false);
    this.update({ mode, pianoHeld: new Set(), drumHeld: new Set() });
  }

  setPresets(p: SavedInputPresets): void {
    this.router.setPresets(p);
  }

  ownerOf(code: string) {
    return this.router.ownerOf(code);
  }

  keyDown(k: KeyInput): RouteResult {
    return this.router.keyDown(k);
  }

  keyUp(k: KeyInput): RouteResult {
    return this.router.keyUp(k);
  }

  releaseAll(): void {
    this.router.releaseAll();
    if (this.sustainOn) this.setSustain(false); // focus loss: the Tab keyup never arrives
    for (const key of [...this.routed.keys()]) if (key.startsWith('screen-pad:')) this.padUp(Number(key.split(':')[2]));
  }

  /** Target track for an input (see inputTargets). */
  targetTrack(target: 'piano' | 'drum'): string | null {
    return inputTargets(this.getProject())[target];
  }

  private dispatch(e: MusicalInputEvent | CapturedInput) {
    if (e.type !== 'note-on' && e.type !== 'note-off') {
      const trackId = this.targetTrack(e.target);
      if (trackId) {
        const bytes =
          e.type === 'cc' ? [0xb0, e.controller, e.value] : e.type === 'pitch-bend' ? [0xe0, (e.value + 8192) & 0x7f, ((e.value + 8192) >> 7) & 0x7f] : e.type === 'channel-pressure' ? [0xd0, e.value] : [0xa0, e.pitch, e.value];
        this.transport.sendToTrack(trackId, bytes, { performed: true });
      }
      for (const s of this.sinks) s(e, trackId);
      return;
    }
    const key = `${e.sourceId}:${e.target}:${e.pitch}`;
    const held = new Set(e.target === 'piano' ? this.snapshot.pianoHeld : this.snapshot.drumHeld);
    let trackId: string | null;
    if (e.type === 'note-on') {
      trackId = this.targetTrack(e.target);
      this.routed.set(key, trackId ?? ''); // also without a track: its note-off still clears the held key
      if (trackId) this.transport.auditionNote(trackId, e.pitch, e.velocity, e.sourceId);
      held.add(e.pitch);
    } else {
      trackId = this.routed.get(key) || null;
      this.routed.delete(key);
      if (trackId) this.transport.releaseAuditionNote(trackId, e.pitch, e.sourceId);
      held.delete(e.pitch);
    }
    this.update(e.target === 'piano' ? { pianoHeld: held } : { drumHeld: held });
    for (const s of this.sinks) s(e as CapturedInput, trackId);
  }

  /** External MIDI keyboard input (Web MIDI). Plays into the piano target (drum target in drum modes). */
  midiMessage(m: ParsedMidiInput, deviceId: string, timeStamp: number): void {
    // one source per device and channel: the same key played on two channels (layered / split
    // keyboards) is two voices, and releasing one must not stop the other (ADR-084)
    const sourceId = `midi:${deviceId}#${m.channel}`;
    const target: 'piano' | 'drum' = this.mode === 'drum-performance' || this.mode === 'step-drums' ? 'drum' : 'piano';
    const ch = this._keepMidiChannel ? { channel: m.channel } : {};
    const base = { atMs: timeStamp, target, sourceId, ...ch };
    switch (m.type) {
      case 'note-on':
        this.dispatch({ type: 'note-on', pitch: m.pitch, velocity: m.velocity, ...base });
        break;
      case 'note-off': {
        // A key pressed before an input-mode switch (⌥R / ⌥K) is released to where it was played,
        // or its preview would never stop and the recorder would lose its end (ADR-083).
        const other = target === 'piano' ? 'drum' : 'piano';
        const here = this.routed.has(`${sourceId}:${target}:${m.pitch}`);
        if (!here && !this.routed.has(`${sourceId}:${other}:${m.pitch}`)) return; // no matching note-on (e.g. a channel the filter drops): not ours to end (ADR-086)
        const playedTo = here ? target : other;
        this.dispatch({ type: 'note-off', pitch: m.pitch, releaseVelocity: m.releaseVelocity, ...base, target: playedTo });
        break;
      }
      case 'cc':
        if (m.controller === 64 || m.controller === 66 || m.controller === 67) this.noteControl(sourceId, target, m.controller, m.value >= 64, ch.channel);
        this.dispatch({ type: 'cc', controller: m.controller, value: m.value, ...base });
        break;
      case 'pitch-bend':
        this.noteControl(sourceId, target, -1, m.value !== 0, ch.channel);
        this.dispatch({ type: 'pitch-bend', value: m.value, ...base });
        break;
      case 'channel-pressure':
        this.dispatch({ type: 'channel-pressure', value: m.value, ...base });
        break;
      case 'poly-pressure':
        this.dispatch({ type: 'poly-pressure', pitch: m.pitch, value: m.value, ...base });
        break;
      case 'program':
        break; // Program Change from the keyboard is not recorded (INPUT_RECORDING 4: optional)
    }
  }

  /** Releases every note held by one source (device unplugged / disabled). */
  private noteControl(sourceId: string, target: 'piano' | 'drum', controller: number, engaged: boolean, channel?: number) {
    const key = `${sourceId}:${target}:${controller}`;
    if (engaged) this.heldControls.set(key, { sourceId, target, controller, ...(channel !== undefined ? { channel } : {}) });
    else this.heldControls.delete(key);
  }

  releaseSource(sourceId: string): void {
    // pedals up and the bend back to centre first, so the released notes do not ring on (ADR-087)
    for (const [key, c] of [...this.heldControls]) {
      if (c.sourceId !== sourceId && !c.sourceId.startsWith(`${sourceId}#`)) continue;
      this.heldControls.delete(key);
      const base = { sourceId: c.sourceId, atMs: performance.now(), target: c.target, ...(c.channel !== undefined ? { channel: c.channel } : {}) };
      if (c.controller < 0) this.dispatch({ type: 'pitch-bend', value: 0, ...base });
      else this.dispatch({ type: 'cc', controller: c.controller, value: 0, ...base });
    }
    for (const key of [...this.routed.keys()]) {
      // key = `${source}:${target}:${pitch}`, where a MIDI source is `${sourceId}#${channel}`;
      // device ids may themselves contain ':'
      let source: string;
      if (key.startsWith(`${sourceId}:`)) source = sourceId;
      else if (key.startsWith(`${sourceId}#`)) source = key.slice(0, key.indexOf(':', sourceId.length));
      else continue;
      const [target, pitch] = key.slice(source.length + 1).split(':');
      this.dispatch({ type: 'note-off', pitch: Number(pitch), releaseVelocity: 0, sourceId: source, atMs: performance.now(), target: target as 'piano' | 'drum' });
    }
  }

  get sustain(): boolean {
    return this.sustainOn;
  }

  /** Sustain pedal for PC keyboard play (CC64), recorded as a CC event (INPUT_RECORDING 2/5). */
  setSustain(on: boolean): void {
    this.sustainOn = on;
    this.dispatch({ type: 'cc', controller: 64, value: on ? 127 : 0, atMs: performance.now(), target: 'piano', sourceId: 'pc-keyboard' });
    this.update({});
  }

  /** On-screen pad / mouse input: same event path as the keyboard (INPUT_RECORDING 3). */
  padDown(pitch: number, velocity = 100): void {
    this.dispatch({ type: 'note-on', pitch, velocity, sourceId: 'screen-pad', atMs: performance.now(), target: 'drum' });
  }

  padUp(pitch: number): void {
    if (!this.routed.has(`screen-pad:drum:${pitch}`)) return;
    this.dispatch({ type: 'note-off', pitch, releaseVelocity: 64, sourceId: 'screen-pad', atMs: performance.now(), target: 'drum' });
  }
}
