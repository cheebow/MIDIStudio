// Browser capability detection. Takes the global object as a parameter so it can be unit-tested
// without a DOM (pass a plain object in tests).

import { t } from '../i18n';

export interface BrowserFeatures {
  audioContext: boolean;
  audioWorklet: boolean;
  webMidi: boolean;
  indexedDb: boolean;
  fileApi: boolean;
}

interface GlobalLike {
  AudioContext?: unknown;
  AudioWorkletNode?: unknown;
  indexedDB?: unknown;
  File?: unknown;
  FileReader?: unknown;
  navigator?: { requestMIDIAccess?: unknown };
}

export function detectFeatures(g: GlobalLike): BrowserFeatures {
  return {
    audioContext: typeof g.AudioContext === 'function',
    audioWorklet: typeof g.AudioWorkletNode === 'function',
    webMidi: typeof g.navigator?.requestMIDIAccess === 'function',
    indexedDb: g.indexedDB !== undefined && g.indexedDB !== null,
    fileApi: typeof g.File === 'function' && typeof g.FileReader === 'function',
  };
}

/** Human readable (Japanese) list of problems that block audio playback; empty when fine. */
export function audioBlockers(f: BrowserFeatures): string[] {
  const out: string[] = [];
  if (!f.audioContext) out.push(t('このブラウザは Web Audio (AudioContext) に対応していません。'));
  else if (!f.audioWorklet) out.push(t('このブラウザは AudioWorklet に対応していないため、内蔵音源を使えません。'));
  return out;
}
