// Chord symbols typed or picked in the guitar-voicing dialog (ADR-091). Parses the usual spellings
// (Cmaj7 / CM7 / CΔ7, Am / Amin / A-, F#m7b5...) and the names the chord analysis writes (ADR-090:
// Cm7(b5), Em7(11), C/E) into the analysis' own ChordQuality, so a detected name and a typed one find
// the same forms. The spelling of the root and bass as typed (F# or Gb) is kept for display.
import { chordSuffix, type ChordQuality } from '../theory/chords';

export interface ChordSymbol {
  /** pitch class of the root, 0 = C */
  root: number;
  /** the root as written (C#, Db...) */
  rootName: string;
  quality: ChordQuality;
  /** pitch class of the bass of a slash chord, else null */
  bass: number | null;
  bassName: string | null;
}

export type ChordParse = { ok: true; chord: ChordSymbol } | { ok: false; reason: 'empty' | 'invalid' };

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Suffix spellings → quality. Matching is case-sensitive: M7 is major seventh, m7 is minor seventh. */
const SUFFIXES: [string, ChordQuality][] = [
  ['', 'maj'],
  ['maj', 'maj'],
  ['M', 'maj'],
  ['major', 'maj'],
  ['m', 'm'],
  ['mi', 'm'],
  ['min', 'm'],
  ['-', 'm'],
  ['minor', 'm'],
  ['7', '7'],
  ['dom7', '7'],
  ['maj7', 'maj7'],
  ['M7', 'maj7'],
  ['Maj7', 'maj7'],
  ['ma7', 'maj7'],
  ['j7', 'maj7'],
  ['Δ', 'maj7'],
  ['Δ7', 'maj7'],
  ['△', 'maj7'],
  ['△7', 'maj7'],
  ['m7', 'm7'],
  ['mi7', 'm7'],
  ['min7', 'm7'],
  ['-7', 'm7'],
  ['5', '5'],
  ['dim', 'dim'],
  ['°', 'dim'],
  ['o', 'dim'],
  ['aug', 'aug'],
  ['+', 'aug'],
  ['sus4', 'sus4'],
  ['sus', 'sus4'],
  ['sus2', 'sus2'],
  ['m7(b5)', 'm7b5'],
  ['m7b5', 'm7b5'],
  ['m7-5', 'm7b5'],
  ['ø', 'm7b5'],
  ['ø7', 'm7b5'],
  ['dim7', 'dim7'],
  ['°7', 'dim7'],
  ['o7', 'dim7'],
  ['7sus4', '7sus4'],
  ['7sus', '7sus4'],
  ['6', '6'],
  ['m6', 'm6'],
  ['add9', 'add9'],
  ['add2', 'add9'],
  ['9', '9'],
  ['m9', 'm9'],
  ['maj9', 'maj9'],
  ['M9', 'maj9'],
  ['m7(11)', 'm11'],
  ['m11', 'm11'],
];
const BY_SUFFIX = new Map(SUFFIXES);

function parseNote(text: string): { pc: number; name: string; rest: string } | null {
  const m = /^([A-Ga-g])([#♯b♭]?)(.*)$/s.exec(text);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
  const pc = (LETTER[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
  return { pc, name: letter + acc, rest: m[3] };
}

export function parseChordSymbol(text: string): ChordParse {
  const s = text.trim().replace(/\s+/g, '');
  if (s === '') return { ok: false, reason: 'empty' };
  const root = parseNote(s);
  if (!root) return { ok: false, reason: 'invalid' };
  let rest = root.rest;
  let bass: number | null = null;
  let bassName: string | null = null;
  const slash = rest.lastIndexOf('/');
  if (slash >= 0) {
    const b = parseNote(rest.slice(slash + 1));
    if (!b || b.rest !== '') return { ok: false, reason: 'invalid' };
    rest = rest.slice(0, slash);
    // C/C is just C
    if (b.pc !== root.pc) {
      bass = b.pc;
      bassName = b.name;
    }
  }
  const quality = BY_SUFFIX.get(rest);
  if (!quality) return { ok: false, reason: 'invalid' };
  return { ok: true, chord: { root: root.pc, rootName: root.name, quality, bass, bassName } };
}

/** The symbol written the analysis' way (Cmaj7, Cm7(b5), C/E), keeping the root / bass spelling. */
export function formatChordSymbol(c: ChordSymbol): string {
  return `${c.rootName}${chordSuffix(c.quality)}${c.bass !== null && c.bassName ? `/${c.bassName}` : ''}`;
}

/** Same chord (spelling aside)? */
export function sameChord(a: ChordSymbol | null, b: ChordSymbol | null): boolean {
  if (!a || !b) return a === b;
  return a.root === b.root && a.quality === b.quality && a.bass === b.bass;
}
