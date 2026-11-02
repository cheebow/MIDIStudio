import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderSongToWav } from '../../src/playback/render/renderWav';
import { build, off, on, program } from '../fixtures/songs';

const SF2 = 'public/soundfonts/GeneralUser-GS.sf2';

describe('WAV rendering (ADR-052)', () => {
  it.skipIf(!existsSync(SF2))('renders a short song to a 16-bit stereo WAV of the expected length', () => {
    const soundFont = readFileSync(SF2);
    const smf = build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)]); // one quarter note at 120 BPM = 0.5 s
    const progress: number[] = [];
    const wav = renderSongToWav({ smf, soundFont: soundFont.buffer.slice(soundFont.byteOffset, soundFont.byteOffset + soundFont.byteLength), sampleRate: 22050, tailSeconds: 0.5, onProgress: (p) => progress.push(p) });
    expect(wav).not.toBeNull();
    const bytes = new Uint8Array(wav!);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WAVE');
    const view = new DataView(wav!);
    expect(view.getUint16(22, true)).toBe(2); // stereo
    expect(view.getUint32(24, true)).toBe(22050);
    // data length ≈ (0.5 s note + 0.5 s tail) × 22050 × 2 ch × 2 bytes
    expect(bytes.length).toBeGreaterThan(1.0 * 22050 * 4 * 0.9);
    expect(progress.at(-1)).toBe(1);
    // some sound was rendered (not silence)
    let peak = 0;
    for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
    expect(peak).toBeGreaterThan(1000);
  });
});
