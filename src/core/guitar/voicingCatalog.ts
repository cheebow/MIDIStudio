// Curated guitar chord forms (ADR-091). Standard tuning, six strings, written 6th → 1st string:
// -1 = not played, 0 = open, n = fret. Nothing here is searched or generated from the chord tones:
// every form is either a common open chord written out by hand, or one of the common movable barre
// shapes (E, A and D shapes) placed once per root. tests/unit/guitarVoicing.test.ts checks every form
// (chord tones, root in the bass, stretch, duplicates) — a form that fails there must not be listed.
// Written for this project from standard guitar practice; no external chord library is copied.
import type { ChordQuality } from '../theory/chords';

/** The qualities that have forms; the dialog says "no forms registered" for the others. */
export const GUITAR_QUALITIES: readonly ChordQuality[] = ['maj', 'm', '7', 'maj7', 'm7'];

export type PositionLabel = 'open' | 'low' | 'mid' | 'high';

export interface GuitarForm {
  id: string;
  /** pitch class of the root */
  root: number;
  quality: ChordQuality;
  /** 6th → 1st string; -1 muted, 0 open */
  frets: readonly number[];
  positionLabel: PositionLabel;
  /** lower = shown first */
  priority: number;
  verified: true;
}

const X = -1;

/** Open forms, written out (root pitch class, quality, frets). */
const OPEN: [number, ChordQuality, number[]][] = [
  // C
  [0, 'maj', [X, 3, 2, 0, 1, 0]],
  [0, '7', [X, 3, 2, 3, 1, 0]],
  [0, 'maj7', [X, 3, 2, 0, 0, 0]],
  // D (the D-shape at fret 0 covers D / Dm / D7 / Dmaj7 / Dm7)
  // E (the E-shape at fret 0 covers them; one more common Em7)
  [4, 'm7', [0, 2, 2, 0, 3, 0]],
  // F: the small open F and Fmaj7 on the top four strings
  [5, 'maj', [X, X, 3, 2, 1, 1]],
  [5, 'maj7', [X, X, 3, 2, 1, 0]],
  // G
  [7, 'maj', [3, 2, 0, 0, 0, 3]],
  [7, '7', [3, 2, 0, 0, 0, 1]],
  [7, 'maj7', [3, 2, 0, 0, 0, 2]],
  // A (the A-shape at fret 0 covers them)
  // B7
  [11, '7', [X, 2, 1, 2, 0, 2]],
];

/**
 * Movable shapes: frets relative to the barre / index-finger fret, and the string whose fret-0 note
 * is the root (index into OPEN_PITCHES).
 */
interface Shape {
  name: string;
  rootString: number;
  forms: Partial<Record<ChordQuality, number[]>>;
}
const SHAPES: Shape[] = [
  {
    name: 'E',
    rootString: 0,
    forms: {
      maj: [0, 2, 2, 1, 0, 0],
      m: [0, 2, 2, 0, 0, 0],
      '7': [0, 2, 0, 1, 0, 0],
      maj7: [0, 2, 1, 1, 0, 0],
      m7: [0, 2, 0, 0, 0, 0],
    },
  },
  {
    name: 'A',
    rootString: 1,
    forms: {
      maj: [X, 0, 2, 2, 2, 0],
      m: [X, 0, 2, 2, 1, 0],
      '7': [X, 0, 2, 0, 2, 0],
      maj7: [X, 0, 2, 1, 2, 0],
      m7: [X, 0, 2, 0, 1, 0],
    },
  },
  {
    // root on the 4th string, top four strings only
    name: 'D',
    rootString: 2,
    forms: {
      maj: [X, X, 0, 2, 3, 2],
      m: [X, X, 0, 2, 3, 1],
      '7': [X, X, 0, 2, 1, 2],
      maj7: [X, X, 0, 2, 2, 2],
      m7: [X, X, 0, 2, 1, 1],
    },
  },
  {
    // the jazz major-seventh on strings 6, 4, 3, 2 (root, 7th, 3rd, 5th)
    name: 'E7x',
    rootString: 0,
    forms: { maj7: [0, X, 1, 1, 0, X] },
  },
];

export const OPEN_PITCHES: readonly number[] = [40, 45, 50, 55, 59, 64];

function positionLabel(frets: readonly number[]): PositionLabel {
  const pressed = frets.filter((f) => f > 0);
  if (frets.some((f) => f === 0)) return 'open';
  const low = Math.min(...pressed);
  return low <= 2 ? 'low' : low <= 6 ? 'mid' : 'high';
}

function build(): GuitarForm[] {
  const out: GuitarForm[] = [];
  const seen = new Set<string>();
  const add = (root: number, quality: ChordQuality, frets: number[], id: string, priority: number) => {
    const key = `${quality}:${frets.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, root, quality, frets, positionLabel: positionLabel(frets), priority, verified: true });
  };
  OPEN.forEach(([root, quality, frets], i) => add(root, quality, frets, `open-${i}`, 0));
  for (const shape of SHAPES) {
    for (const [quality, rel] of Object.entries(shape.forms) as [ChordQuality, number[]][]) {
      // one placement per root: the barre fret 0..11 (fret 0 is the open chord of that shape)
      for (let fret = 0; fret < 12; fret++) {
        const root = (OPEN_PITCHES[shape.rootString] + fret) % 12;
        const frets = rel.map((f) => (f < 0 ? X : f + fret));
        // open forms first, then by position up the neck
        add(root, quality, frets, `${shape.name}-${quality}-${fret}`, fret === 0 ? 0 : 1 + fret);
      }
    }
  }
  return out;
}

export const GUITAR_FORMS: readonly GuitarForm[] = build();
