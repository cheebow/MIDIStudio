// Regression tests of the 4th review (ADR-094): playback, recording and input. The sequencer tests
// run the real spessasynth_core sequencer through the same functions SpessaAdapter uses.
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BasicMIDI, SpessaSynthProcessor, SpessaSynthSequencer } from 'spessasynth_core';
import { EditorStore } from '../../src/app/store/EditorStore';
import { Recorder } from '../../src/app/recording/Recorder';
import { InputController } from '../../src/input/InputController';
import { listKeyIntent } from '../../src/input/listKeys';
import { Metronome, type MetronomeHost, type MetronomeMaps } from '../../src/playback/Metronome';
import { Transport } from '../../src/playback/Transport';
import { applySongBounds, playFrom } from '../../src/playback/sequencerDrive';
import { renderSongToWav } from '../../src/playback/render/renderWav';
import { createEmptyProject, createTrack } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { buildPlaybackSnapshot } from '../../src/core/project-io/playbackSnapshot';
import { TempoMap } from '../../src/core/timing/tempoMap';
import { TimeSignatureMap } from '../../src/core/timing/timeSignatureMap';
import type { MidiProject, NoteEvent } from '../../src/core/model/types';
import type { EngineSong } from '../../src/playback/PlaybackEngine';
import { FakeEngine } from '../fixtures/fakeEngine';
import { build, cc, GS_RHYTHM_PART_11, off, on, program, sysex, tempo } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('h')));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- real spessasynth_core sequencer

const RATE = 44100;
const BLOCK = 128;

/**
 * The song as the worklet's sequencer gets it: exactly what SpessaAdapter.loadSong does to the
 * parsed BasicMIDI (loop points, lastVoiceEventTick), then the copy the worklet makes
 * (spessasynth_lib "loadNewSongList": BasicMIDI.copyFrom for an object that has `duration`).
 */
function coreSequencer(song: EngineSong) {
  const synth = new SpessaSynthProcessor(RATE, { eventsEnabled: false, effectsEnabled: false, initialTime: 0 });
  const seq = new SpessaSynthSequencer(synth);
  seq.skipToFirstNoteOn = false;
  const midi = BasicMIDI.fromArrayBuffer(song.smf.slice().buffer as ArrayBuffer, song.fileName);
  applySongBounds(midi, song);
  seq.loadNewSongList([BasicMIDI.copyFrom(midi)]);
  seq.loopCount = song.loop ? Infinity : 0;
  seq.pause();
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  /** runs the audio clock for `seconds`, like the worklet (processTick, then one render quantum) */
  const run = (seconds: number, each?: () => void) => {
    for (let n = Math.ceil((seconds * RATE) / BLOCK); n > 0; n--) {
      seq.processTick();
      synth.process(left, right, 0, BLOCK);
      each?.();
    }
  };
  return { seq, run };
}

function project(...tracks: Parameters<typeof build>[2][]): MidiProject {
  const r = openMidiFile(build(1, 480, [tempo(0, 500000)], ...tracks)); // 120 BPM: 960 ticks per second
  if (!r.ok) throw new Error('fixture');
  return r.project;
}

describe('SpessaSynth sequencer driven the way SpessaAdapter / Transport drive it', () => {
  it('BUG 0: play from a position inside a rest starts there (seek while paused, then play — what Transport.play / reload do)', () => {
    // events at 0 s, 2.0 s and 6.0 s; nothing in between
    const p = project([program(0, 0, 0), cc(0, 0, 7, 100), cc(1920, 0, 7, 90), cc(3840, 0, 7, 80)]);
    const snap = buildPlaybackSnapshot(p);
    const { seq, run } = coreSequencer({ smf: snap.smf, fileName: 'x.mid', loop: null });
    playFrom(seq, 0.5); // engine.seekSeconds(0.5) while paused
    run(0.1);
    // received 2.1: the engine jumped to the next event (2.0 s) and the 1.5 s of rest were skipped
    expect(seq.currentTime).toBeGreaterThan(0.5);
    expect(seq.currentTime).toBeLessThan(0.7);
  });

  it('BUG 1: a loop whose start has no event exactly on it restarts at the loop start, not at the first event after it', () => {
    // controllers only (no sound bank needed): one at tick 0, the next one half a bar into the loop
    // (the last one lies after the loop, so the song is longer than the loop: BUG 2 does not interfere)
    const p = { ...project([cc(0, 0, 7, 100), cc(2400, 0, 7, 90), cc(960, 0, 7, 80), cc(2400, 0, 7, 70)]), loop: { enabled: true, startTick: 1920, endTick: 3840 } };
    const snap = buildPlaybackSnapshot(p);
    const { seq, run } = coreSequencer({ smf: snap.smf, fileName: 'x.mid', loop: snap.loop });
    playFrom(seq, 3.5); // Transport.play(3360): half a second before the loop end (4.0 s)
    expect(seq.currentTime).toBeCloseTo(3.5, 2); // control: the seek itself lands where asked
    let afterWrap: number | null = null;
    let prev = seq.currentTime;
    run(0.7, () => {
      const t = seq.currentTime;
      if (afterWrap === null && t < prev - 0.5) afterWrap = t;
      prev = t;
    });
    expect(afterWrap).not.toBeNull();
    // loop start = tick 1920 = 2.0 s; the first event in the loop is at tick 2400 = 2.5 s
    expect(afterWrap!).toBeGreaterThanOrEqual(1.99);
    expect(afterWrap!).toBeLessThan(2.05);
  });

  it('BUG 2a: recording past the last note — the engine starts at the record position, not at the top of the song', () => {
    const p = project([program(0, 0, 0), cc(0, 0, 7, 100), cc(1920, 0, 7, 90)]); // the song ends at tick 1920 (2.0 s)
    const tail = 3840 + 480 * 4 * 2000; // Recorder.start: transport.setTail(startTick + ...)
    const snap = buildPlaybackSnapshot(p, { tailTick: tail });
    const { seq, run } = coreSequencer({ smf: snap.smf, fileName: 'x.mid', loop: null, minEndTick: tail });
    playFrom(seq, 4); // Transport.play(3840) -> engine.seekSeconds(4.0)
    run(0.1);
    expect(seq.currentTime).toBeGreaterThan(4);
    expect(seq.currentTime).toBeLessThan(4.2);
  });

  it('BUG 2b: a loop that ends after the last note — play / seek in the silent part stays there', () => {
    const p = { ...project([cc(0, 0, 7, 100), cc(960, 0, 7, 90)]), loop: { enabled: true, startTick: 0, endTick: 3840 } }; // last event at 1.0 s, loop to 4.0 s
    const snap = buildPlaybackSnapshot(p);
    const { seq, run } = coreSequencer({ smf: snap.smf, fileName: 'x.mid', loop: snap.loop });
    playFrom(seq, 2.5); // pause at bar 2 beat 2, then play again
    run(0.1);
    expect(seq.currentTime).toBeGreaterThan(2.5);
    expect(seq.currentTime).toBeLessThan(2.7);
  });
});

// ---------------------------------------------------------------- WAV export

describe('WAV export', () => {
  const SF2 = 'public/soundfonts/GeneralUser-GS.sf2';
  it.skipIf(!existsSync(SF2))('BUG 11: a quiet part is written quietly (the level of live playback), not peak-normalised to full scale', () => {
    const file = readFileSync(SF2);
    const soundFont = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    // one note with the channel volume turned far down (CC7 = 20)
    const smf = build(1, 480, [program(0, 0, 0), cc(0, 0, 7, 20), on(0, 0, 60, 60), off(480, 0, 60)]);
    const wav = renderSongToWav({ smf, soundFont, sampleRate: 22050, tailSeconds: 0.3 })!;
    const view = new DataView(wav);
    let peak = 0;
    for (let i = 44; i < wav.byteLength; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(16000); // received: 32767 whatever the volume
  });
});

// ---------------------------------------------------------------- recorder

function setup(patch: Partial<MidiProject['settings']['recording']> = {}) {
  const p = createEmptyProject();
  const drums = createTrack({ name: 'Drums', channel: 9, displayMode: 'drum' }, 1);
  const base = { ...p, tracks: [p.tracks[0], drums], settings: { ...p.settings, recording: { ...p.settings.recording, countInBars: 0 as const, ...patch } } };
  const store = new EditorStore(base);
  const engine = new FakeEngine();
  const transport = new Transport(engine);
  const input = new InputController(transport, () => store.project, base.inputPresets);
  return { store, engine, transport, input };
}
const notesOf = (store: EditorStore, i: number) => store.project.tracks[i].events.filter((e): e is NoteEvent => e.kind === 'note').map((n) => [n.tick, n.pitch, n.durationTicks]);

/** loop 0..1920 (2 s at 120 BPM); the fake engine wraps like the real one */
async function loopSetup(patch: Partial<MidiProject['settings']['recording']> = {}) {
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const s = setup({ loopTakes: 'merge', ...patch });
  s.store.load({ ...s.store.project, loop: { enabled: true, startTick: 0, endTick: 1920 } });
  await s.transport.setProject(s.store.project);
  const rec = new Recorder(s.store, s.transport, s.input, () => {}, () => null);
  s.input.setMode('piano-performance');
  await rec.start();
  const at = (clock: number) => {
    now = 1000 + clock * 1000;
    s.engine.seconds = clock % 2;
  };
  const key = (type: 'note-on' | 'note-off', pitch: number) =>
    s.input.midiMessage(type === 'note-on' ? { type, channel: 0, pitch, velocity: 90 } : { type, channel: 0, pitch, releaseVelocity: 0 }, 'kb', now);
  return { ...s, rec, at, key };
}

describe('Recorder', () => {
  it('BUG 3a: loop recording stopped in the second half of the first pass ends a held note at the stop position', async () => {
    const { store, rec, at, key } = await loopSetup();
    at(1.0);
    key('note-on', 60); // tick 960
    at(1.4);
    rec.stop(); // still pass 0, at tick 1344: the key is down
    const [n] = notesOf(store, 0);
    expect(n[0]).toBe(960);
    expect(Math.abs(n[2] - 384)).toBeLessThanOrEqual(2); // 0.4 s, not to the loop end (960 ticks)
  });

  it('BUG 3b: with latency compensation, a note held across the wrap and stopped early in the next pass runs to the loop end', async () => {
    const { store, rec, at, key } = await loopSetup({ latencyMs: 20 });
    at(1.5);
    key('note-on', 60); // tick ~1421
    at(2.3); // pass 1, 0.3 s after the wrap, nothing played since
    rec.stop();
    const [n] = notesOf(store, 0);
    expect(n[0] + n[2]).toBe(1920); // ADR-083 / 086: closed at the loop end, not shrunk to 1 tick
  });

  it('BUG 4: loop recording with record quantize keeps a note played late in the loop inside the loop', async () => {
    const { store, rec, at, key } = await loopSetup({ quantize: true });
    store.updateSettings({ grid: { division: 4, kind: 'straight' } }); // quarter-note grid (480 ticks)
    at(1.8);
    key('note-on', 60); // tick 1728: nearest grid line is 1920 = the loop end (never played in the loop)
    at(1.9);
    key('note-off', 60);
    at(2.5);
    rec.stop();
    const [n] = notesOf(store, 0);
    expect(n[0]).toBeLessThan(1920);
  });

  it('BUG 10: punch with the loop on (the engine cycles over the punch range) — a note held across the wrap is cut at the punch out', async () => {
    const { store, rec, at, key } = await loopSetup({ punch: true });
    at(1.75);
    key('note-on', 60); // tick 1680
    at(2.1); // the engine wrapped to 0.1 s
    key('note-off', 60);
    at(2.5);
    rec.stop();
    const [n] = notesOf(store, 0);
    expect(n[0]).toBe(1680);
    expect(n[2]).toBe(240); // to the punch out (1920), not 1 tick
  });

  it('BUG 5: a device unplugged while "keep MIDI channel" is on ends its held notes in the take at that moment', async () => {
    const { store, engine, transport, input } = setup();
    input.setKeepMidiChannel(true);
    await transport.setProject(store.project);
    const rec = new Recorder(store, transport, input, () => {}, () => null);
    input.setMode('piano-performance');
    await rec.start();
    input.midiMessage({ type: 'note-on', channel: 3, pitch: 60, velocity: 90 }, 'kb', performance.now());
    engine.advance(0.5);
    input.releaseSource('midi:kb'); // unplugged at tick 480
    engine.advance(3.5);
    rec.stop(); // tick 3840
    const [n] = notesOf(store, 0);
    expect(n[2]).toBeLessThan(600); // ~480, not 3840
  });

  it('BUG 6: when the song cannot be loaded at record start, the recorder does not stay in "recording"', async () => {
    const { store, engine, transport, input } = setup();
    await transport.setProject(store.project);
    const rec = new Recorder(store, transport, input, () => {}, () => null);
    engine.failNextLoad = new Error('MIDI load timed out');
    await rec.start().catch(() => undefined);
    expect(transport.getState().status).toBe('stopped');
    expect(rec.getState().phase).toBe('idle');
  });
});

// ---------------------------------------------------------------- metronome

class Host implements MetronomeHost {
  ctxTime = 10;
  song = 0;
  playing = false;
  readonly audioContext: AudioContext;
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.audioContext = { get currentTime() { return self.ctxTime; } } as unknown as AudioContext;
  }
  getSeconds() {
    return this.song;
  }
  isPlaying() {
    return this.playing;
  }
  songTimeToContextTime(seconds: number) {
    return this.playing ? this.ctxTime + (seconds - this.song) : null;
  }
}
class TestMetronome extends Metronome {
  clicks: { song: number; accent: boolean }[] = [];
  constructor(private readonly h: Host, maps: () => MetronomeMaps | null) {
    super(h, maps);
  }
  step() {
    this.tick();
  }
  protected override click(_ctx: AudioContext, at: number, accent: boolean) {
    this.clicks.push({ song: Math.round((this.h.song + at - this.h.ctxTime) * 1000) / 1000, accent });
  }
}

describe('Metronome', () => {
  it('BUG 7: playback started on a beat clicks that beat (the look-ahead timer first runs a few ms after the start)', () => {
    const host = new Host();
    const maps: MetronomeMaps = { tempo: new TempoMap(480, [{ tick: 0, usPerQuarter: 500000 }]), signature: new TimeSignatureMap(480, []), loop: null };
    const m = new TestMetronome(host, () => maps);
    m.step(); // metronome on, transport stopped
    // Space: the engine starts at bar 1; the 25 ms timer fires 10 ms later
    host.playing = true;
    for (let i = 0; i < 60; i++) {
      host.ctxTime += i === 0 ? 0.01 : 0.025;
      host.song += i === 0 ? 0.01 : 0.025;
      m.step();
    }
    expect(m.clicks.map((c) => c.song)).toEqual([0, 0.5, 1, 1.5]); // the accented downbeat of bar 1 included
  });
});

// ---------------------------------------------------------------- preview / keys

describe('Transport preview', () => {
  it('BUG 8: a GS rhythm part on another channel (SysEx "Use for Rhythm Part") is also set up on the preview synth', async () => {
    const r = openMidiFile(build(1, 480, [tempo(0, 500000)], [sysex(0, GS_RHYTHM_PART_11), program(10, 10, 0), on(470, 10, 36), off(480, 10, 36)]));
    if (!r.ok) throw new Error('fixture');
    const engine = new FakeEngine();
    const t = new Transport(engine);
    await t.setProject(r.project);
    t.seek(960);
    t.auditionNote(r.project.tracks[0].id, 36, 100);
    // the song synth plays this channel as drums; the preview synth must be told too
    expect(engine.sent.some((m) => m.message[0] === 0xf0)).toBe(true);
  });
});

describe('list keys', () => {
  it('BUG 9: ⌘V pastes at the list cursor on a non-Latin layout too (the global shortcuts fall back to the key position, ADR-084)', () => {
    const k = { key: 'м', code: 'KeyV', shiftKey: false, altKey: false, ctrlKey: false, metaKey: true };
    expect(listKeyIntent('edit-shortcuts', k, () => false, true)).toEqual({ type: 'paste', insert: false });
  });
});
