import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorStore } from '../../src/app/store/EditorStore';
import { Recorder, recordTargets } from '../../src/app/recording/Recorder';
import { StepController } from '../../src/app/recording/StepController';
import { InputController } from '../../src/input/InputController';
import { removeTrack } from '../../src/core/editing/operations';
import { Transport } from '../../src/playback/Transport';
import { createEmptyProject, createTrack } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import type { NoteEvent } from '../../src/core/model/types';
import { FakeEngine } from '../fixtures/fakeEngine';

beforeEach(() => setIdGenerator(createCounterIdGenerator('f')));

function setup() {
  const p = createEmptyProject();
  const drums = createTrack({ name: 'Drums', channel: 9, displayMode: 'drum' }, 1);
  const project = { ...p, tracks: [p.tracks[0], drums], settings: { ...p.settings, recording: { ...p.settings.recording, countInBars: 0 as const } } };
  const store = new EditorStore(project);
  const engine = new FakeEngine();
  const transport = new Transport(engine);
  const input = new InputController(transport, () => store.project, project.inputPresets);
  return { store, engine, transport, input };
}
const notesOf = (store: EditorStore, i: number) => store.project.tracks[i].events.filter((e): e is NoteEvent => e.kind === 'note').map((n) => [n.tick, n.pitch, n.durationTicks]);

describe('recording through the real input path (fake engine)', () => {
  it('routes piano input to the armed melodic track and drum pads to the armed drum track; one undo step', async () => {
    const { store, engine, transport, input } = setup();
    await transport.setProject(store.project);
    const rec = new Recorder(store, transport, input, () => {}, () => null);
    input.setMode('drum-performance');
    await rec.start();
    expect(transport.getState().status).toBe('playing');
    engine.advance(0.5); // tick 480
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', performance.now());
    input.padDown(36, 110);
    engine.advance(0.5);
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', performance.now());
    input.padUp(36);
    rec.stop();
    // MIDI keyboard in drum mode goes to the drum target as well (drum mode)
    expect(notesOf(store, 1).map((n) => n[1]).sort()).toEqual([36, 60]);
    expect(transport.getState().status).toBe('stopped');
    expect(store.getState().history.past).toHaveLength(1);
    store.undo();
    expect(notesOf(store, 1)).toEqual([]);
  });

  it('piano mode: MIDI keyboard notes land on the melodic track with velocity and timing', async () => {
    const { store, engine, transport, input } = setup();
    await transport.setProject(store.project);
    const rec = new Recorder(store, transport, input, () => {}, () => null);
    input.setMode('piano-performance');
    await rec.start();
    engine.advance(1);
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 64, velocity: 77 }, 'kb', performance.now());
    engine.advance(0.25);
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 64, releaseVelocity: 10 }, 'kb', performance.now());
    rec.stop();
    const [n] = notesOf(store, 0);
    expect(n[1]).toBe(64);
    expect(Math.abs(n[0] - 960)).toBeLessThanOrEqual(2);
    expect(Math.abs(n[2] - 240)).toBeLessThanOrEqual(2);
  });

  it('ADR-083: a MIDI key held across an input-mode switch is released where it was played', async () => {
    const { store, engine, transport, input } = setup();
    await transport.setProject(store.project);
    const rec = new Recorder(store, transport, input, () => {}, () => null);
    input.setMode('piano-performance');
    await rec.start();
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', performance.now());
    engine.advance(0.5);
    input.setMode('drum-performance'); // ⌥R while the key is down
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', performance.now());
    expect(transport.activePreviewCount).toBe(0);
    rec.stop();
    const [n] = notesOf(store, 0);
    expect(n[1]).toBe(60);
    expect(Math.abs(n[2] - 480)).toBeLessThanOrEqual(2);
  });

  it('ADR-084: the same key on two MIDI channels is two voices; releasing one keeps the other; unplugging releases both', async () => {
    const { store, transport, input } = setup();
    await transport.setProject(store.project);
    input.setMode('piano-performance');
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', 0);
    input.midiMessage({ type: 'note-on', channel: 1, pitch: 60, velocity: 90 }, 'kb', 0);
    expect(transport.activePreviewCount).toBe(2);
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', 1);
    expect(transport.activePreviewCount).toBe(1);
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 64, velocity: 90 }, 'kb', 2);
    input.releaseSource('midi:kb');
    expect(transport.activePreviewCount).toBe(0);
  });

  it('ADR-083: the Tab sustain is lifted when leaving the PC-keyboard mode or losing focus', async () => {
    const { store, engine, transport, input } = setup();
    await transport.setProject(store.project);
    const cc64 = () => engine.sent.filter((s) => (s.message[0] & 0xf0) === 0xb0 && s.message[1] === 64).map((s) => s.message[2]);
    input.setMode('piano-performance');
    input.setSustain(true);
    input.setMode('edit-shortcuts'); // Esc while Tab is held
    expect(input.sustain).toBe(false);
    expect(cc64()).toEqual([127, 0]);
    input.setMode('piano-performance');
    input.setSustain(true);
    input.releaseAll(); // window blur
    expect(input.sustain).toBe(false);
    expect(cc64()).toEqual([127, 0, 127, 0]);
  });

  it('ADR-084: a target track deleted while recording does not leave the recorder stuck', async () => {
    const { store, engine, transport, input } = setup();
    await transport.setProject(store.project);
    const rec = new Recorder(store, transport, input, () => {}, () => null);
    input.setMode('piano-performance');
    await rec.start();
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', performance.now());
    engine.advance(0.5);
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', performance.now());
    store.run(removeTrack(store.project, store.project.tracks[0].id));
    expect(() => rec.stop()).not.toThrow();
    expect(rec.getState().phase).toBe('idle');
    expect(rec.getState().message).toContain('削除されたトラック');
    await rec.start(); // recording works again
    expect(rec.getState().phase).not.toBe('idle');
    rec.stop();
  });

  it('ADR-080: records to the selected track; drum pads go to a drum track unless one is selected', () => {
    const { store } = setup();
    const [piano, drums] = store.project.tracks;
    const bass = { ...piano, id: 'bass' };
    const three = { ...store.project, tracks: [piano, drums, bass] };
    const select = (id: string | undefined) => ({ ...three, settings: { ...three.settings, selectedTrackId: id } });
    expect(recordTargets(select(undefined))).toEqual({ piano: piano.id, drum: drums.id }); // nothing selected: the first track
    expect(recordTargets(select('bass'))).toEqual({ piano: 'bass', drum: drums.id });
    expect(recordTargets(select(drums.id))).toEqual({ piano: drums.id, drum: drums.id });
    const noDrums = { ...select('bass'), tracks: [piano, bass] };
    expect(recordTargets(noDrums)).toEqual({ piano: 'bass', drum: 'bass' });
    expect(recordTargets({ ...three, tracks: [] })).toHaveProperty('error');
  });

  it('I14: a device that disappears releases its held notes (closed in the take)', async () => {
    const { store, engine, transport, input } = setup();
    await transport.setProject(store.project);
    const rec = new Recorder(store, transport, input, () => {}, () => null);
    input.setMode('piano-performance');
    await rec.start();
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 50, velocity: 90 }, 'kb', performance.now());
    engine.advance(0.5);
    input.releaseSource('midi:kb');
    expect(input.getSnapshot().pianoHeld.size).toBe(0);
    rec.stop();
    expect(notesOf(store, 0)[0][1]).toBe(50);
  });

  it('step recording: chord on key release, rest, drum stacking with auto-advance off', async () => {
    const { store, transport, input } = setup();
    await transport.setProject(store.project);
    const step = new StepController(store, input);
    input.setMode('step-piano');
    // C + E pressed together, released -> one chord step
    input.keyDown({ code: 'KeyZ' });
    input.keyDown({ code: 'KeyC' });
    input.keyUp({ code: 'KeyZ' });
    input.keyUp({ code: 'KeyC' });
    step.rest();
    input.keyDown({ code: 'KeyB' });
    input.keyUp({ code: 'KeyB' });
    expect(notesOf(store, 0)).toEqual([
      [0, 60, 216],
      [0, 64, 216],
      [480, 67, 216],
    ]);
    input.setMode('step-drums');
    step.setCursor(0);
    input.keyDown({ code: 'KeyM' });
    input.keyUp({ code: 'KeyM' });
    input.keyDown({ code: 'Period' });
    input.keyUp({ code: 'Period' });
    step.forward();
    input.keyDown({ code: 'Comma' });
    input.keyUp({ code: 'Comma' });
    expect(notesOf(store, 1)).toEqual([
      [0, 36, 216],
      [0, 42, 216],
      [240, 38, 216],
    ]);
  });
});

describe('early hits during the count-in (ADR-047)', () => {
  afterEach(() => vi.useRealTimers());

  it('a note in the last beat of the count-in lands on the start position; one in the first beat is dropped and reported', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { store, engine, transport, input } = setup();
    store.updateSettings({ recording: { ...store.project.settings.recording, countInBars: 1 } }); // 4 beats at 120 BPM = 0.5 s each
    await transport.setProject(store.project);
    const rec = new Recorder(store, transport, input, () => {}, () => 0);
    input.setMode('piano-performance');
    const started = rec.start();
    await vi.advanceTimersByTimeAsync(100); // first beat: far too early
    expect(rec.getState()).toMatchObject({ phase: 'count-in', countIn: 4 });
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 62, velocity: 80 }, 'kb', performance.now());
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 62, releaseVelocity: 0 }, 'kb', performance.now());
    await vi.advanceTimersByTimeAsync(1500); // now in the last beat
    expect(rec.getState()).toMatchObject({ phase: 'count-in', countIn: 1 });
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', performance.now()); // pickup, a little early
    await vi.advanceTimersByTimeAsync(600);
    await started;
    expect(rec.getState().phase).toBe('recording');
    engine.advance(0.5); // tick 480
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', performance.now());
    rec.stop();
    const notes = notesOf(store, 0);
    expect(notes.map((n) => [n[0], n[1]])).toEqual([[0, 60]]); // on the start position, not lost; the too-early note is not there
    expect(notes[0][2]).toBeGreaterThanOrEqual(1);
    expect(rec.getState().message).toContain('開始位置に揃えました');
    expect(rec.getState().message).toContain('1 個は記録していません');
  });

  it('ADR-084: a pickup pressed and released within the count-in keeps its length', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { store, engine, transport, input } = setup();
    store.updateSettings({ recording: { ...store.project.settings.recording, countInBars: 1 } });
    await transport.setProject(store.project);
    const rec = new Recorder(store, transport, input, () => {}, () => 0);
    input.setMode('piano-performance');
    const started = rec.start();
    await vi.advanceTimersByTimeAsync(1600); // the last count-in beat
    const t0 = performance.now();
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', t0);
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', t0 + 250); // held 0.25 s = an eighth at 120 BPM
    await vi.advanceTimersByTimeAsync(600);
    await started;
    engine.advance(1);
    rec.stop();
    const [n] = notesOf(store, 0);
    expect(n[0]).toBe(0);
    expect(Math.abs(n[2] - 240)).toBeLessThanOrEqual(2);
  });
});
