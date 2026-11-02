// Worker: renders a song to WAV off the main thread (ADR-052). Messages:
//   in : { smf: Uint8Array, soundFont: ArrayBuffer, sampleRate, tailSeconds }
//   out: { type: 'progress', value } | { type: 'done', wav: ArrayBuffer } | { type: 'error', message }
import { renderSongToWav, type RenderOptions } from './renderWav';

type In = Pick<RenderOptions, 'smf' | 'soundFont' | 'sampleRate' | 'tailSeconds'>;

self.onmessage = (e: MessageEvent<In>) => {
  try {
    const wav = renderSongToWav({ ...e.data, onProgress: (value) => self.postMessage({ type: 'progress', value }) });
    if (wav) self.postMessage({ type: 'done', wav }, { transfer: [wav] });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
