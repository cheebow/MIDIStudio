// Low-level sound engine contract (seconds + SMF bytes). SpessaAdapter implements it; tests use a
// fake. The project-level API of ARCHITECTURE F (ticks, project snapshots) is the Transport.

export interface EngineSong {
  smf: Uint8Array;
  fileName: string;
  /** loop points in ticks; null = no loop */
  loop: { startTick: number; endTick: number } | null;
  /** keep playing at least until this tick even without notes there (recording) */
  minEndTick?: number;
}

export interface PlaybackEngine {
  /** true once a sound bank is loaded */
  readonly ready: boolean;
  loadSong(song: EngineSong): Promise<void>;
  play(): void;
  pause(): void;
  /** Seek in song seconds; the engine re-applies controller state (chase) and silences notes. */
  seekSeconds(seconds: number): void;
  /** Song position in seconds, derived from the audio clock. */
  getSeconds(): number;
  isPlaying(): boolean;
  /** The song reached its end and the engine stopped by itself. */
  isFinished(): boolean;
  /**
   * Raw MIDI message (status includes the 0-based channel). 'preview' goes to the separate live
   * preview synth (keyboard / pads), which sequencer seeks, loops and reloads never silence;
   * 'both' also reaches the song synth (mixer moves while playing).
   */
  send(message: number[], port?: number, target?: 'preview' | 'both'): void;
  /** Immediately silences every voice (sequencer and preview). */
  panic(): void;
  /**
   * AudioContext time at which the given song time will sound, or null when not playing.
   * Used to schedule metronome clicks on the audio clock.
   */
  songTimeToContextTime(seconds: number): number | null;
}
