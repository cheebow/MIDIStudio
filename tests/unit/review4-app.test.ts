// Regression tests of the 4th review (ADR-094): app shell and list / tempo editing, the parts that are pure logic.
import { describe, expect, it } from 'vitest';
import { createStarterProject } from '../../src/core/model/defaults';
import { applyCommand } from '../../src/core/editing/history';
import { setTempo } from '../../src/core/editing/conductorOps';
import { listRows } from '../../src/core/list/listRows';
import { Transport } from '../../src/playback/Transport';
import type { PlaybackEngine } from '../../src/playback/PlaybackEngine';
import type { MidiProject } from '../../src/core/model/types';

function fakeEngine(): PlaybackEngine {
  let seconds = 0;
  let playing = false;
  return {
    ready: true,
    loadSong: () => Promise.resolve(),
    play: () => void (playing = true),
    pause: () => void (playing = false),
    seekSeconds: (s: number) => void (seconds = s),
    getSeconds: () => seconds,
    isPlaying: () => playing,
    isFinished: () => false,
    send: () => undefined,
    panic: () => undefined,
    songTimeToContextTime: () => null,
  };
}

describe('bug hunt: app / list / tempo', () => {
  // App.loadProject(): transport.stop() parks the playhead at the OLD song's loop start, and
  // Transport.setProject() keeps a non-zero parked tick for the next song (App.tsx:253).
  it('a newly loaded song starts with the playhead at its beginning', () => {
    const transport = new Transport(fakeEngine());
    const a = createStarterProject({ title: 'A', ppq: 480 });
    const songA: MidiProject = { ...a, loop: { enabled: true, startTick: 480 * 4 * 8, endTick: 480 * 4 * 12 } };
    void transport.setProject(songA);
    // what App.loadProject does: stop, then the store loads the next song and the effect calls setProject
    transport.stop();
    const songB = createStarterProject({ title: 'B', ppq: 96 }); // loop disabled, other PPQ
    void transport.setProject(songB);
    expect(transport.getPosition().tick).toBe(0);
  });

  // ListEditor commit() on a tempo row calls setTempo() with the 2-decimal BPM shown in the cell:
  // confirming the cell without changing it rewrites the exact µs value (upsertConductorEvent
  // guards this since ADR-087; setTempo does not) (ListEditor.tsx:289).
  it('confirming an unchanged tempo cell keeps the exact µs per quarter', () => {
    const p0 = createStarterProject({ title: 'A' });
    const first = p0.conductor.find((c) => c.kind === 'tempo');
    const tick = first?.tick ?? 0;
    const exact = 500_123; // 119.97 BPM when shown with 2 decimals
    const base = applyCommand(p0, setTempo(p0, tick, 120)).project;
    const p: MidiProject = { ...base, conductor: base.conductor.map((c) => (c.kind === 'tempo' && c.tick === tick ? { ...c, usPerQuarter: exact } : c)) };
    const row = listRows(p, p.tracks[0], undefined, undefined, { conductor: true }).find((r) => r.event.kind === 'tempo')!;
    const shown = String(row.value); // the cell text the editor opens with
    const after = applyCommand(p, setTempo(p, row.tick, Number(shown))).project;
    const tempo = after.conductor.find((c) => c.kind === 'tempo' && c.tick === tick)!;
    expect(tempo.kind === 'tempo' && tempo.usPerQuarter).toBe(exact);
  });
});
