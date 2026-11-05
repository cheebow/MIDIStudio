// ADR-086: regressions of the ADR-084 recording fixes, found in the second review.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorStore } from '../../src/app/store/EditorStore';
import { Recorder } from '../../src/app/recording/Recorder';
import { InputController } from '../../src/input/InputController';
import { Transport } from '../../src/playback/Transport';
import { createEmptyProject, createTrack } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import type { NoteEvent } from '../../src/core/model/types';
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

describe('recording regressions found in the second review (ADR-086)', () => {
  it('a note-off from another channel (let through the channel filter) does not end a held, recorded note', async () => {
    const { store, engine, transport, input } = setup();
    await transport.setProject(store.project);
    const rec = new Recorder(store, transport, input, () => {}, () => null);
    input.setMode('piano-performance');
    await rec.start();
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', performance.now());
    engine.advance(1);
    input.midiMessage({ type: 'note-off', channel: 1, pitch: 60, releaseVelocity: 0 }, 'kb', performance.now()); // other channel
    engine.advance(1);
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', performance.now());
    rec.stop();
    expect(notesOf(store, 0)[0][2]).toBeGreaterThan(1900);
  });

  it('a count-in pickup does not overlap the same key played again on the downbeat', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { store, engine, transport, input } = setup(1);
    await transport.setProject(store.project);
    const rec = new Recorder(store, transport, input, () => {}, () => 0);
    input.setMode('piano-performance');
    const started = rec.start();
    await vi.advanceTimersByTimeAsync(1650);
    const t0 = performance.now();
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', t0);
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', t0 + 350);
    await vi.advanceTimersByTimeAsync(600);
    await started;
    engine.advance(0.05);
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', performance.now());
    engine.advance(0.5);
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', performance.now());
    rec.stop();
    const n = notesOf(store, 0);
    expect(n[0][0] + n[0][2]).toBeLessThanOrEqual(n[1][0]);
  });

  it('loop recording started after the loop end counts passes from the loop start (the engine jumps there)', async () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { store, engine, transport, input } = setup();
    store.updateSettings({ recording: { ...store.project.settings.recording, loopTakes: 'last' } });
    store.load({ ...store.project, loop: { enabled: true, startTick: 0, endTick: 1920 } } as never);
    if (!store.project.loop.enabled) throw new Error('loop not set');
    await transport.setProject(store.project);
    transport.seek(4800); // 5 s, past the loop end (2 s)
    const rec = new Recorder(store, transport, input, () => {}, () => null);
    input.setMode('piano-performance');
    await rec.start();
    const at = (e: number) => {
      now = 1000 + e * 1000;
      engine.seconds = e % 2; // the real engine jumps to the loop start at once, then wraps every 2 s
    };
    at(0.5);
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 60, velocity: 90 }, 'kb', now);
    at(0.6);
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 60, releaseVelocity: 0 }, 'kb', now);
    at(1.5);
    input.midiMessage({ type: 'note-on', channel: 0, pitch: 62, velocity: 90 }, 'kb', now);
    at(1.6);
    input.midiMessage({ type: 'note-off', channel: 0, pitch: 62, releaseVelocity: 0 }, 'kb', now);
    at(1.9);
    rec.stop();
    const n = notesOf(store, 0);
    expect(n.map((x) => x[1])).toEqual([60, 62]);
  });
});
