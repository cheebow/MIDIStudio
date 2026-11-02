import { describe, expect, it } from 'vitest';
import { audioBlockers, detectFeatures } from '../../src/playback/featureDetect';

class Fake {}

describe('detectFeatures', () => {
  it('detects a full-featured browser', () => {
    const f = detectFeatures({
      AudioContext: Fake,
      AudioWorkletNode: Fake,
      indexedDB: {},
      File: Fake,
      FileReader: Fake,
      navigator: { requestMIDIAccess: () => undefined },
    });
    expect(f).toEqual({ audioContext: true, audioWorklet: true, webMidi: true, indexedDb: true, fileApi: true });
    expect(audioBlockers(f)).toEqual([]);
  });

  it('treats missing Web MIDI as non-blocking for audio (Safari-like)', () => {
    const f = detectFeatures({ AudioContext: Fake, AudioWorkletNode: Fake, navigator: {} });
    expect(f.webMidi).toBe(false);
    expect(audioBlockers(f)).toEqual([]);
  });

  it('reports AudioWorklet / AudioContext absence as audio blockers', () => {
    expect(audioBlockers(detectFeatures({ AudioContext: Fake }))).toHaveLength(1);
    expect(audioBlockers(detectFeatures({}))[0]).toMatch(/AudioContext/);
  });
});
