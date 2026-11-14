// The items left over from the 4th review, fixed in ADR-098: the recording count-in and the
// selection of a clip whose notes are borrowed for a command.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorStore } from '../../src/app/store/EditorStore';
import { Recorder } from '../../src/app/recording/Recorder';
import { InputController } from '../../src/input/InputController';
import { Transport } from '../../src/playback/Transport';
import { addEvents } from '../../src/core/editing/operations';
import { createEmptyProject } from '../../src/core/model/defaults';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { FakeEngine } from '../fixtures/fakeEngine';

beforeEach(() => setIdGenerator(createCounterIdGenerator('r5')));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup() {
  const p = createEmptyProject();
  const project = { ...p, settings: { ...p.settings, recording: { ...p.settings.recording, countInBars: 1 as const } } };
  const store = new EditorStore(project);
  const engine = new FakeEngine();
  const transport = new Transport(engine);
  const input = new InputController(transport, () => store.project, project.inputPresets);
  return { store, engine, transport, input };
}

describe('count-in (ADR-098)', () => {
  it('the song is loaded under the count-in, and not a second time at the downbeat', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { store, engine, transport, input } = setup();
    await transport.setProject(store.project);
    const before = engine.loads.length;
    const rec = new Recorder(store, transport, input, () => {}, () => 0);
    const started = rec.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(rec.getState().phase).toBe('count-in');
    expect(engine.loads.length).toBe(before + 1); // already there while the clicks run
    await vi.advanceTimersByTimeAsync(2100);
    await started;
    expect(rec.getState().phase).toBe('recording');
    expect(transport.getState().status).toBe('playing');
    expect(engine.loads.length).toBe(before + 1);
    rec.stop();
  });

  it('cancelling the count-in silences the clicks already scheduled, and start() returns', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { store, transport, input } = setup();
    await transport.setProject(store.project);
    const clicks: number[] = [];
    const cancel = vi.fn();
    const rec = new Recorder(store, transport, input, (at) => clicks.push(at), () => 0, cancel);
    const started = rec.start();
    await vi.advanceTimersByTimeAsync(600); // one beat in: three clicks are still to come
    expect(clicks.length).toBe(4);
    rec.stop();
    expect(cancel).toHaveBeenCalledTimes(1);
    await started; // used to wait forever: the timer that would have ended the wait was cleared
    expect(rec.getState().phase).toBe('idle');
    expect(transport.getState().status).not.toBe('playing');
    await vi.advanceTimersByTimeAsync(3000);
    expect(rec.getState().phase).toBe('idle');
  });

  it('the beats are counted against the audio clock, so late timers do not add up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { store, transport, input } = setup();
    await transport.setProject(store.project);
    let clock = 0; // seconds of the audio clock
    const waits: number[] = [];
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    const rec = new Recorder(store, transport, input, () => {}, () => clock);
    const started = rec.start();
    await vi.advanceTimersByTimeAsync(0);
    waits.push(timeouts.mock.calls.at(-1)![1] as number);
    clock = 0.6; // 120 BPM: the 2nd click is at 0.55 s, and this timer fired 50 ms late
    await vi.advanceTimersByTimeAsync(550);
    waits.push(timeouts.mock.calls.at(-1)![1] as number);
    expect(waits[0]).toBeCloseTo(550, 3);
    expect(waits[1]).toBeCloseTo(450, 3); // to the 3rd click at 1.05 s, not another 500 ms
    rec.stop();
    await started;
  });
});

describe('a clip whose notes are borrowed for a command (ADR-098)', () => {
  it('returnClipNotes() leaves the clip alone selected; without a borrow it changes nothing', () => {
    const store = new EditorStore(createEmptyProject());
    const trackId = store.project.tracks[0].id;
    const r = addEvents(store.project, trackId, [{ kind: 'note', tick: 10, pitch: 60, velocity: 100, durationTicks: 240, releaseVelocity: 64 }])!;
    store.run(r.command);
    const clip = store.project.clips[0];
    store.setSelection({ ...store.getState().selection, eventIds: new Set(), clipIds: new Set([clip.id]) });
    store.borrowClipNotes(r.ids);
    expect([...store.getState().selection.eventIds]).toEqual(r.ids);
    store.returnClipNotes();
    expect(store.getState().selection.eventIds.size).toBe(0);
    expect([...store.getState().selection.clipIds]).toEqual([clip.id]);
    // notes selected by the user next to a selected clip are not touched
    store.selectEvents(r.ids);
    store.returnClipNotes();
    expect([...store.getState().selection.eventIds]).toEqual(r.ids);
  });
});
