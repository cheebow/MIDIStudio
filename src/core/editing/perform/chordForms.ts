// Guitar chord forms (PT-01, ADR-079): standard tuning. Instead of a hand-written list, every
// playable fingering of a chord is generated once and cached: a run of adjacent strings (3 to 6),
// each fretted inside one 4-fret box (open strings only in the lowest positions), sounding only
// chord tones and all of the required ones, and holdable with four fingers (a barre counts as one).
// This covers the open shapes, the barre chords and the 3- / 4-string voicings on the high strings.
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

/** Limits of the generated fingerings. */
export const FORM_LIMITS = {
  /** highest fret used */
  maxFret: 15,
  /** fretted notes span at most this many frets (a 4-fret box: lowest + 3) */
  span: 3,
  /** open strings are allowed while every fretted note is at or below this fret */
  openUpTo: 4,
  minStrings: 3,
} as const;

export interface ChordForm {
  /** pitch class of the root (0 = C) */
  root: number;
  quality: ChordQuality;
  /** fret per string, low E first; null = string not played */
  frets: readonly (number | null)[];
  /** needs a barre (more than four fretted notes) */
  barre: boolean;
  /** "C x32010" */
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

/** true when the form uses at least one open string */
export function hasOpenString(form: ChordForm): boolean {
  return form.frets.some((f) => f === 0);
}

export function chordName(root: number, quality: ChordQuality): string {
  return `${PC_NAMES[root]}${QUALITY_NAMES[quality]}`;
}

const tab = (frets: readonly (number | null)[]) => frets.map((f) => (f === null ? 'x' : f > 9 ? `(${f})` : String(f))).join('');

/** Four fingers: up to four fretted notes, or a barre on the lowest fret plus up to three more. */
function holdable(fretted: number[]): { ok: boolean; barre: boolean } {
  if (fretted.length <= 4) return { ok: true, barre: false };
  const low = Math.min(...fretted);
  return { ok: fretted.filter((f) => f > low).length <= 3, barre: true };
}

/** Every fingering of root + quality within FORM_LIMITS. */
function generate(root: number, quality: ChordQuality): ChordForm[] {
  const tones = new Set(QUALITY_INTERVALS[quality].map((i) => (root + i) % 12));
  const fifth = (root + 7) % 12;
  // the fifth of a seventh chord may be left out (spec 3.3: keep the quality-defining notes)
  const required = [...tones].filter((pc) => !(QUALITY_INTERVALS[quality].length === 4 && pc === fifth));
  const seen = new Set<string>();
  const out: ChordForm[] = [];
  for (let box = 1; box + FORM_LIMITS.span <= FORM_LIMITS.maxFret; box++) {
    const openOk = box + FORM_LIMITS.span <= FORM_LIMITS.openUpTo + FORM_LIMITS.span && box <= FORM_LIMITS.openUpTo;
    // per string, the frets in this box (and 0) that sound a chord tone
    const options = TUNING.map((open) => {
      const o: number[] = [];
      if (openOk && tones.has(open % 12)) o.push(0);
      for (let f = box; f <= box + FORM_LIMITS.span; f++) if (tones.has((open + f) % 12)) o.push(f);
      return o;
    });
    for (let first = 0; first < 6; first++) {
      for (let last = first + FORM_LIMITS.minStrings - 1; last < 6; last++) {
        const frets: (number | null)[] = [null, null, null, null, null, null];
        const walk = (s: number) => {
          if (s > last) {
            const pcs = new Set<number>();
            for (let i = first; i <= last; i++) pcs.add((TUNING[i] + frets[i]!) % 12);
            if (!required.every((pc) => pcs.has(pc))) return;
            const pitches = frets.filter((f): f is number => f !== null).map((f, i) => TUNING[first + i] + f);
            if (new Set(pitches).size !== pitches.length) return; // no unison on two strings
            const fretted = frets.filter((f): f is number => f !== null && f > 0);
            if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > FORM_LIMITS.span) return;
            if (fretted.length && !openOk && Math.min(...fretted) !== box) return; // each shape once, in its own box
            const h = holdable(fretted);
            if (!h.ok) return;
            const key = frets.join();
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ root, quality, frets: [...frets], barre: h.barre, name: `${chordName(root, quality)} ${tab(frets)}` });
            return;
          }
          for (const f of options[s]) {
            frets[s] = f;
            walk(s + 1);
          }
          frets[s] = null;
        };
        walk(first);
      }
    }
  }
  return out;
}

const cache = new Map<string, ChordForm[]>();

export function formsFor(root: number, quality: ChordQuality): readonly ChordForm[] {
  const key = `${root}:${quality}`;
  let list = cache.get(key);
  if (!list) {
    list = generate(root, quality);
    cache.set(key, list);
  }
  return list;
}

/** All forms of all chords (for tests). */
export function allForms(): ChordForm[] {
  const out: ChordForm[] = [];
  for (let root = 0; root < 12; root++) for (const q of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) out.push(...formsFor(root, q));
  return out;
}
