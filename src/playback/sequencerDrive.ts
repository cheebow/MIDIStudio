// How the SpessaSynth sequencer has to be driven so that it plays where the Transport says.
// Kept apart from SpessaAdapter (which needs an AudioContext) so the unit tests can run the same
// code against the real spessasynth_core sequencer: a fake engine hides all of this (ADR-094).
import type { BasicMIDI } from 'spessasynth_core';
import type { EngineSong } from './PlaybackEngine';

/**
 * Loop points and the playable length of a parsed song.
 * - The sequencer ends at the last voice event (metas do not count), so the loop end and the
 *   recording tail extend `lastVoiceEventTick`.
 * - `duration` was computed at parse time and is not derived again: left stale, a seek or a play
 *   beyond the last note is taken as "past the end" and restarts from the top of the song.
 */
export function applySongBounds(midi: BasicMIDI, song: Pick<EngineSong, 'loop' | 'minEndTick'>): void {
  if (song.loop) {
    midi.loop = { start: song.loop.startTick, end: song.loop.endTick, type: 'hard' };
    midi.lastVoiceEventTick = Math.max(midi.lastVoiceEventTick, song.loop.endTick);
  }
  if (song.minEndTick) midi.lastVoiceEventTick = Math.max(midi.lastVoiceEventTick, song.minEndTick);
  midi.duration = Math.max(midi.duration, midi.midiTicksToSeconds(midi.lastVoiceEventTick));
}

/** The part of a sequencer (core or the worklet's proxy) that starting playback needs. */
export interface SeekableSequencer {
  play(): void;
  currentTime: number;
}

/**
 * Starts playback at `seekSeconds` (null: where the sequencer is). A seek made while paused leaves
 * the sequencer on the time of the next EVENT, and play() then starts from there, skipping the
 * rest in between; a seek while playing is exact. So: play first, then seek.
 */
export function playFrom(sequencer: SeekableSequencer, seekSeconds: number | null): void {
  sequencer.play();
  if (seekSeconds !== null) sequencer.currentTime = Math.max(0, seekSeconds);
}
