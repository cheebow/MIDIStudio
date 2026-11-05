// ADR-087: playback / input / recording / storage bugs found in the third review.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { EditorStore } from '../../src/app/store/EditorStore';
import { Recorder } from '../../src/app/recording/Recorder';
import { StepController } from '../../src/app/recording/StepController';
import { InputController } from '../../src/input/InputController';
import { MidiInputAdapter, type MidiInputLike } from '../../src/input/MidiInputAdapter';
import { Transport } from '../../src/playback/Transport';
import { createEmptyProject, createTrack } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import type { NoteEvent } from '../../src/core/model/types';
import { ProjectStore } from '../../src/storage/indexedDb';
import { FakeEngine } from '../fixtures/fakeEngine';

beforeEach(() => setIdGenerator(createCounterIdGenerator('f')));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function setup(countInBars: 0 | 1 = 0) {
  const p = createEmptyProject();
  const drums = createTrack({ name: 'Drums', channel: 9, displayMode: 'drum' }, 1);
  const project = { ...p, tracks: [p.tracks[0], drums], settings: { ...p.settings, recording: { ...p.settings.recording, countInBars } } };
  const store = new EditorStore(project);
  const engine = new FakeEngine();
  const transport = new Transport(engine);
  const input = new InputController(transport, () => store.project, project.inputPresets);
  return { store, engine, transport, input };
}
const notesOf = (store: EditorStore, i: number) => store.project.tracks[i].events.filter((e): e is NoteEvent => e.kind === 'note').map((n) => [n.tick, n.pitch, n.durationTicks]);
const cc64Sent = (engine: FakeEngine) => engine.sent.filter((s) => (s.message[0] & 0xf0) === 0xb0 && s.message[1] === 64).map((s) => s.message[2]);

describe('third review: input and recording (ADR-087)', () => {
  it('a sustain pedal held on a MIDI device that is unplugged goes up, live and in the take', async () => {
    const { store, engine, transport, input } = setup();
    await transport.setProject(store.project);
    const inputs: MidiInputLike[] = [{ id: 'kb', name: 'KB', state: 'connected', onmidimessage: null }];
    const access = { inputs: { forEach: (cb: (i: MidiInputLike) => void) => inputs.forEach(cb) }, onstatechange: null as null | ((e: unknown) => void) };
    const midi = new MidiInputAdapter({ onMessage: (m, d, ts) => input.midiMessage(m, d, ts), onDeviceLost: (d) => input.releaseSource('midi:' + d), onChange: () => {} }, async () => access as never);
    await midi.enable();
    const rec = new Recorder(store, transport, input, () => {}, () => null);
    await rec.start();
    inputs[0].onmidimessage!({ data: new Uint8Array([0x90, 60, 100]), timeStamp: performance.now() });
    inputs[0].onmidimessage!({ data: new Uint8Array([0xb0, 64, 127]), timeStamp: performance.now() });
    engine.advance(1);
    inputs[0].state = 'disconnected';
    access.onstatechange!({ port: { id: 'kb', type: 'input', state: 'disconnected' } });
    expect(cc64Sent(engine)).toEqual([127, 0]);
    engine.advance(1);
    rec.stop();
    const ccs = store.project.tracks[0].events.filter((e) => e.kind === 'cc').map((e) => (e as { value: number }).value);
    expect(ccs).toEqual([127, 0]);
  });

  it('Panic lifts the pedals and centres the bend on both synths', async () => {
    const { store, engine, transport } = setup();
    await transport.setProject(store.project);
    transport.panic();
    const both = engine.sent.filter((s) => s.target === 'both');
    expect(both.some((s) => s.message[0] === 0xb0 && s.message[1] === 64 && s.message[2] === 0)).toBe(true);
    expect(both.some((s) => s.message[0] === 0xe9 && s.message[1] === 0 && s.message[2] === 64)).toBe(true);
  });

  it('a preview note is released on the channel it was played on, after the track changed channel', async () => {
    const { store, engine, transport, input } = setup();
    await transport.setProject(store.project);
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', performance.now());
    const t0 = store.project.tracks[0];
    const p2 = { ...store.project, tracks: [{ ...t0, channel: 3 }, store.project.tracks[1]] };
    store.load(p2);
    await transport.setProject(p2);
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', performance.now());
    expect(engine.sent.filter((s) => (s.message[0] & 0xf0) === 0x80).map((s) => s.message)).toEqual([[0x80, 60, 0]]);
    expect(transport.activePreviewCount).toBe(0);
  });

  it('a MIDI key held while leaving step input does not block the next chords', async () => {
    const { store, transport, input } = setup();
    await transport.setProject(store.project);
    new StepController(store, input);
    input.setMode('step-piano');
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', performance.now());
    input.setMode('edit-shortcuts');
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', performance.now());
    input.setMode('step-piano');
    for (const pitch of [64, 67]) {
      input.midiMessage({ type: 'note-on', channel: 0, pitch, velocity: 90 }, 'kb', performance.now());
      input.midiMessage({ type: 'note-off', channel: 0, pitch, releaseVelocity: 0 }, 'kb', performance.now());
    }
    expect(notesOf(store, 0).map((n) => n[1])).toEqual([64, 67]);
  });

  it('Record pressed while playing stops the song for the count-in and records from there', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { store, engine, transport, input } = setup(1);
    await transport.setProject(store.project);
    await transport.play(0);
    engine.advance(4);
    const rec = new Recorder(store, transport, input, () => {}, () => 0);
    const started = rec.start();
    expect(transport.getState().status).not.toBe('playing');
    const at = transport.getPosition().tick;
    await vi.advanceTimersByTimeAsync(2100);
    await started;
    expect(rec.getState().phase).toBe('recording');
    expect(transport.getPosition().tick).toBe(at);
    rec.stop();
  });
});

describe('third review: browser storage (ADR-087)', () => {
  it('a connection closed by the browser is reopened instead of failing every later save', async () => {
    const store = new ProjectStore(new IDBFactory() as unknown as globalThis.IDBFactory);
    await store.saveAutosave({ id: 'a', title: 'a', savedAt: 'x', json: '{}' });
    const db = await (store as unknown as { dbPromise: Promise<IDBDatabase> }).dbPromise;
    db.close();
    await store.saveAutosave({ id: 'a', title: 'a', savedAt: 'y', json: '{}' });
    expect((await store.loadAutosave())?.savedAt).toBe('y');
  });

  it('a damaged record does not break the list of saved songs', async () => {
    const store = new ProjectStore(new IDBFactory() as unknown as globalThis.IDBFactory);
    await store.saveProject({ id: 'a', title: 'a', savedAt: 'x', json: '{}' });
    await store.saveProject({ id: 'b', title: 'b', savedAt: 'x' } as never);
    expect((await store.listProjects()).map((p) => p.id)).toEqual(['a']);
  });
});
