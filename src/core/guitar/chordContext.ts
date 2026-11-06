// Thin adapter between the chord analysis (ADR-090) and the guitar-voicing dialog (ADR-091). It is
// asked once, at the right-click: the dialog keeps the answer even if the song is edited or played
// afterwards. No result (analysis off, nothing detected) is not an error: the dialog opens empty.
import type { ChordSegment } from '../theory/chords';

export interface ChordCandidate {
  chordSymbol: string;
  startTick: number;
  endTick: number;
  /** where the result came from: the song-wide chord lane of ADR-090 */
  sourceScope: 'song';
}

/** Every detected chord whose span holds `tick` (startTick <= tick < endTick). */
export function chordCandidatesAt(segments: readonly ChordSegment[] | null | undefined, tick: number): ChordCandidate[] {
  if (!segments || !Number.isFinite(tick)) return [];
  const out: ChordCandidate[] = [];
  for (const s of segments) {
    if (s.tick <= tick && tick < s.endTick && s.name) out.push({ chordSymbol: s.name, startTick: s.tick, endTick: s.endTick, sourceScope: 'song' });
  }
  // the same name twice is one candidate
  return out.filter((c, i) => out.findIndex((d) => d.chordSymbol === c.chordSymbol && d.endTick === c.endTick) === i);
}
