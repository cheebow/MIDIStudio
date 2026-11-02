import type { EngineSong, PlaybackEngine } from '../../src/playback/PlaybackEngine';

/** Deterministic engine for Transport tests. Time advances only through advance(). */
export class FakeEngine implements PlaybackEngine {
  ready = true;
  playing = false;
  finished = false;
  seconds = 0;
  loads: EngineSong[] = [];
  seeks: number[] = [];
  sent: { message: number[]; port: number; target?: 'preview' | 'both' }[] = [];
  panics = 0;
  failNextLoad: Error | null = null;

  async loadSong(song: EngineSong): Promise<void> {
    await Promise.resolve();
    if (this.failNextLoad) {
      const e = this.failNextLoad;
      this.failNextLoad = null;
      throw e;
    }
    this.loads.push(song);
    this.playing = false;
    this.seconds = 0;
    this.finished = false;
  }
  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seekSeconds(s: number) {
    this.seeks.push(s);
    this.seconds = s;
  }
  getSeconds() {
    return this.seconds;
  }
  isPlaying() {
    return this.playing;
  }
  isFinished() {
    return this.finished;
  }
  send(message: number[], port = 0, target: 'preview' | 'both' = 'preview') {
    this.sent.push({ message, port, ...(target === 'both' ? { target } : {}) });
  }
  panic() {
    this.panics++;
  }
  songTimeToContextTime(s: number) {
    return this.playing ? s : null;
  }
  advance(s: number) {
    if (this.playing) this.seconds += s;
  }
}

/** FakeEngine whose loads finish only when the test calls `release()` (a real song load takes a while). */
export class SlowEngine extends FakeEngine {
  release: (() => void) | null = null;
  override async loadSong(song: EngineSong): Promise<void> {
    await new Promise<void>((r) => (this.release = r));
    this.release = null;
    await super.loadSong(song);
  }
}
