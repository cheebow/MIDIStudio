import { describe, expect, it } from 'vitest';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { exportSmfBytes } from '../../src/core/project-io/exportSmf';
import { parseProjectFile, serializeProject } from '../../src/core/project-io/projectFile';
import { cc, off, on, smf, tempo, trackBytes, type Ev } from '../fixtures/smf-build';

/** Self-made load song: 32 tracks, ~100,000 events, tempo changes and SysEx (TEST_PLAN 8). */
function loadSong(): Uint8Array {
  const ppq = 480;
  const conductor: Ev[] = [];
  for (let bar = 0; bar < 900; bar += 30) conductor.push(tempo(bar === 0 ? 0 : ppq * 4 * 30, 500000 - (bar % 60) * 1000));
  const tracks = [trackBytes(conductor)];
  for (let t = 0; t < 32; t++) {
    const ev: Ev[] = [[0, 0xf0, 4, 0x41, 0x10, 0x42, 0xf7]];
    const ch = t % 16 === 9 ? 10 : t % 16; // keep 32 separate tracks (two Ch10 drum tracks would be merged)
    for (let i = 0; i < 1050; i++) {
      ev.push(on(i === 0 ? 0 : 120, ch, 36 + ((i * 7 + t) % 48)), off(120, ch, 36 + ((i * 7 + t) % 48)));
      if (i % 2 === 0) ev.push(cc(0, ch, 11, i % 128));
    }
    tracks.push(trackBytes(ev));
  }
  return smf(1, ppq, tracks);
}

describe('large file (C11 / O06 / REQ-NFR-03 groundwork)', () => {
  it('imports, exports and serializes ~100,000 events in reasonable time', () => {
    const bytes = loadSong();
    const t0 = performance.now();
    const r = openMidiFile(bytes);
    const t1 = performance.now();
    if (!r.ok) throw new Error(r.errors[0].message);
    const events = r.project.tracks.reduce((n, t) => n + t.events.length, 0);
    const { bytes: out } = exportSmfBytes(r.project);
    const t2 = performance.now();
    const json = serializeProject(r.project);
    const back = parseProjectFile(json);
    const t3 = performance.now();
    expect(back.ok).toBe(true);
    expect(r.project.tracks).toHaveLength(32);
    // 32 x (1 SysEx + 1050 notes + 525 CC) = 50,464 model events (100,864 SMF channel/SysEx messages)
    expect(events).toBe(32 * (1 + 1050 + 525));
    expect(out.length).toBeGreaterThan(0);
    console.log(
      `[perf] SMF ${bytes.length} B: import ${(t1 - t0).toFixed(0)} ms, export ${(t2 - t1).toFixed(0)} ms, ` +
        `.midstudio ${json.length} chars save+load ${(t3 - t2).toFixed(0)} ms`,
    );
    expect(t3 - t0).toBeLessThan(15_000);
  });
});
