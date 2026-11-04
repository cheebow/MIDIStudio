// Guitar chord forms (PT-01, ADR-078): standard tuning, a fixed library of open forms and the
// movable E- and A-shapes (barre chords). Every form is a fret per string (null = not played), and
// tests check that each one really sounds its chord and stays within a hand's reach.
export const TUNING: readonly number[] = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

export type ChordQuality = 'maj' | 'min' | '7' | 'maj7' | 'm7' | 'sus2' | 'sus4' | 'dim' | 'aug';

/** Intervals above the root. */
export const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
};

export const QUALITY_NAMES: Record<ChordQuality, string> = { maj: '', min: 'm', '7': '7', maj7: 'maj7', m7: 'm7', sus2: 'sus2', sus4: 'sus4', dim: 'dim', aug: 'aug' };
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface ChordForm {
  /** pitch class of the root (0 = C) */
  root: number;
  quality: ChordQuality;
  /** fret per string, low E first; null = string not played */
  frets: readonly (number | null)[];
  /** a barre chord (movable shape above the nut) */
  barre: boolean;
  /** "C", "F#m7", "Bb (barre 6)" */
  name: string;
}

/** Sounding pitches of a form, low to high string. */
export function formPitches(form: ChordForm): number[] {
  const out: number[] = [];
  form.frets.forEach((f, i) => f !== null && out.push(TUNING[i] + f));
  return out;
}

/** Frets of the fretted (not open) strings. */
export function frettedFrets(form: ChordForm): number[] {
  return form.frets.filter((f): f is number => f !== null && f > 0);
}

export function chordName(root: number, quality: ChordQuality): string {
  return `${PC_NAMES[root]}${QUALITY_NAMES[quality]}`;
}

const X = null;
/** Open-position forms (common first-position shapes; `x32010` = C). */
const OPEN: readonly [string, ChordQuality, readonly (number | null)[]][] = [
  ['C', 'maj', [X, 3, 2, 0, 1, 0]],
  ['A', 'maj', [X, 0, 2, 2, 2, 0]],
  ['G', 'maj', [3, 2, 0, 0, 0, 3]],
  ['E', 'maj', [0, 2, 2, 1, 0, 0]],
  ['D', 'maj', [X, X, 0, 2, 3, 2]],
  ['F', 'maj', [X, X, 3, 2, 1, 1]],
  ['A', 'min', [X, 0, 2, 2, 1, 0]],
  ['E', 'min', [0, 2, 2, 0, 0, 0]],
  ['D', 'min', [X, X, 0, 2, 3, 1]],
  ['E', '7', [0, 2, 0, 1, 0, 0]],
  ['A', '7', [X, 0, 2, 0, 2, 0]],
  ['B', '7', [X, 2, 1, 2, 0, 2]],
  ['C', '7', [X, 3, 2, 3, 1, 0]],
  ['D', '7', [X, X, 0, 2, 1, 2]],
  ['G', '7', [3, 2, 0, 0, 0, 1]],
  ['C', 'maj7', [X, 3, 2, 0, 0, 0]],
  ['A', 'maj7', [X, 0, 2, 1, 2, 0]],
  ['D', 'maj7', [X, X, 0, 2, 2, 2]],
  ['E', 'maj7', [0, 2, 1, 1, 0, 0]],
  ['F', 'maj7', [X, X, 3, 2, 1, 0]],
  ['G', 'maj7', [3, 2, 0, 0, 0, 2]],
  ['A', 'm7', [X, 0, 2, 0, 1, 0]],
  ['E', 'm7', [0, 2, 0, 0, 0, 0]],
  ['D', 'm7', [X, X, 0, 2, 1, 1]],
  ['A', 'sus2', [X, 0, 2, 2, 0, 0]],
  ['D', 'sus2', [X, X, 0, 2, 3, 0]],
  ['A', 'sus4', [X, 0, 2, 2, 3, 0]],
  ['D', 'sus4', [X, X, 0, 2, 3, 3]],
  ['E', 'sus4', [0, 2, 2, 2, 0, 0]],
];

/** Movable shapes: frets relative to the barre; the root is on the given string. */
const MOVABLE: readonly { rootString: number; quality: ChordQuality; shape: readonly (number | null)[] }[] = [
  // E-shapes (root on the low E string)
  { rootString: 0, quality: 'maj', shape: [0, 2, 2, 1, 0, 0] },
  { rootString: 0, quality: 'min', shape: [0, 2, 2, 0, 0, 0] },
  { rootString: 0, quality: '7', shape: [0, 2, 0, 1, 0, 0] },
  { rootString: 0, quality: 'maj7', shape: [0, X, 1, 1, 0, X] },
  { rootString: 0, quality: 'm7', shape: [0, 2, 0, 0, 0, 0] },
  { rootString: 0, quality: 'sus4', shape: [0, 2, 2, 2, 0, 0] },
  { rootString: 0, quality: 'dim', shape: [0, 1, 2, 0, X, X] },
  { rootString: 0, quality: 'aug', shape: [0, X, 2, 1, 1, 0] },
  // A-shapes (root on the A string)
  { rootString: 1, quality: 'maj', shape: [X, 0, 2, 2, 2, 0] },
  { rootString: 1, quality: 'min', shape: [X, 0, 2, 2, 1, 0] },
  { rootString: 1, quality: '7', shape: [X, 0, 2, 0, 2, 0] },
  { rootString: 1, quality: 'maj7', shape: [X, 0, 2, 1, 2, 0] },
  { rootString: 1, quality: 'm7', shape: [X, 0, 2, 0, 1, 0] },
  { rootString: 1, quality: 'sus2', shape: [X, 0, 2, 2, 0, 0] },
  { rootString: 1, quality: 'sus4', shape: [X, 0, 2, 2, 3, 0] },
  { rootString: 1, quality: 'dim', shape: [X, 0, 1, 2, 1, X] },
  { rootString: 1, quality: 'aug', shape: [X, 0, 3, 2, 2, 1] },
];

const MAX_BARRE_FRET = 12;

function pc(name: string): number {
  return PC_NAMES.indexOf(name);
}

let cache: Map<string, ChordForm[]> | null = null;

/** Every form of the library, grouped by root + quality. */
function library(): Map<string, ChordForm[]> {
  if (cache) return cache;
  const map = new Map<string, ChordForm[]>();
  const put = (f: ChordForm) => {
    const key = `${f.root}:${f.quality}`;
    const list = map.get(key) ?? [];
    if (!list.some((g) => g.frets.join() === f.frets.join())) list.push(f);
    map.set(key, list);
  };
  for (const [name, quality, frets] of OPEN) put({ root: pc(name), quality, frets, barre: false, name: chordName(pc(name), quality) });
  for (const m of MOVABLE) {
    for (let shift = 1; shift <= MAX_BARRE_FRET; shift++) {
      const root = (TUNING[m.rootString] + shift) % 12;
      const frets = m.shape.map((f) => (f === null ? null : f + shift));
      put({ root, quality: m.quality, frets, barre: true, name: `${chordName(root, m.quality)} (${shift}f)` });
    }
  }
  cache = map;
  return map;
}

export function formsFor(root: number, quality: ChordQuality): readonly ChordForm[] {
  return library().get(`${root}:${quality}`) ?? [];
}

/** All forms (for tests). */
export function allForms(): ChordForm[] {
  return [...library().values()].flat();
}
