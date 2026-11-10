// Offline rendering of a song to WAV with spessasynth_core (ADR-052): the same synthesizer as
// playback, driven faster than real time. No AudioContext is needed, so this runs in a Worker
// (and in Node for the tests). The song is the playback snapshot (mute / solo applied, no loop).
import { audioToWav, BasicMIDI, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer } from 'spessasynth_core';

export interface RenderOptions {
  /** SMF bytes (the playback snapshot) */
  smf: Uint8Array;
  /** SoundFont / DLS bytes */
  soundFont: ArrayBuffer;
  sampleRate: number;
  /** seconds rendered after the last event, for releases and reverb tails */
  tailSeconds: number;
  /** called with 0..1 */
  onProgress?: (p: number) => void;
  /** returns true to abort */
  cancelled?: () => boolean;
}

const BLOCK = 128;

/** Renders the whole song and returns the WAV file bytes (16-bit stereo). */
export function renderSongToWav(opts: RenderOptions): ArrayBuffer | null {
  const synth = new SpessaSynthProcessor(opts.sampleRate, { eventsEnabled: false, effectsEnabled: true, initialTime: 0 });
  synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(opts.soundFont), 'main');
  const seq = new SpessaSynthSequencer(synth);
  // Core defaults to jumping to the first Note On; live playback turns that off (SpessaAdapter) and
  // so must the render, or a leading rest / pickup is cut and parts rendered alone drift (ADR-083).
  seq.skipToFirstNoteOn = false;
  const midi = BasicMIDI.fromArrayBuffer(opts.smf.slice().buffer as ArrayBuffer, 'song.mid');
  seq.loadNewSongList([midi]);
  seq.loopCount = 0;
  seq.play();
  const total = Math.ceil((midi.duration + Math.max(0, opts.tailSeconds)) * opts.sampleRate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let filled = 0;
  let lastReport = -1;
  while (filled < total) {
    if (opts.cancelled?.()) return null;
    seq.processTick();
    const n = Math.min(BLOCK, total - filled);
    synth.process(left, right, filled, n);
    filled += n;
    const p = Math.floor((filled / total) * 100);
    if (p !== lastReport) {
      lastReport = p;
      opts.onProgress?.(p / 100);
    }
  }
  // The file has the level of live playback: a quiet part stays quiet, and parts exported one by one
  // (solo) add up to the mix. audioToWav's own normalisation would bring every file to full scale.
  // Only a render that goes over full scale is turned down, so that it is not clipped.
  let peak = 0;
  for (const ch of [left, right]) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak > 1) for (const ch of [left, right]) for (let i = 0; i < ch.length; i++) ch[i] /= peak;
  return audioToWav([left, right], opts.sampleRate, { normalizeAudio: false });
}
