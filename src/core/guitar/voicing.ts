// Guitar forms → MIDI notes (ADR-091). Sounding pitch, MIDI 60 = C4 (not the octave-up guitar
// notation). One note per played string; the same pitch on two strings is two notes.
import { noteName } from '../list/noteNames';
import type { ChordSymbol } from './chordSymbol';
import { GUITAR_FORMS, GUITAR_QUALITIES, OPEN_PITCHES, type GuitarForm } from './voicingCatalog';

export const MAX_FORMS = 5;

export function fretsToPitches(frets: readonly number[]): number[] {
  if (frets.length !== 6) throw new Error('a guitar form has six strings');
  const out: number[] = [];
  frets.forEach((f, i) => {
    if (f < 0) return;
    if (!Number.isInteger(f) || f > 24) throw new Error(`invalid fret ${f}`);
    out.push(OPEN_PITCHES[i] + f);
  });
  return out;
}

/** x32000, or 8-10-9-9-8-8 when a fret has two digits. */
export function formLabel(frets: readonly number[]): string {
  const parts = frets.map((f) => (f < 0 ? 'x' : String(f)));
  return frets.some((f) => f >= 10) ? parts.join('-') : parts.join('');
}

/** C3 E3 G3 B3 E4 */
export function pitchNames(pitches: readonly number[], sharpsFlats = 0): string {
  return pitches.map((p) => noteName(p, sharpsFlats)).join(' ');
}

export type FormSearch =
  | { kind: 'forms'; forms: GuitarForm[] }
  /** the chord is valid but its quality has no forms in the catalog */
  | { kind: 'no-forms' }
  /** slash chord: forms of the chord exist, but none has that bass as its lowest note */
  | { kind: 'no-bass-forms' };

/**
 * The listed forms of a chord, most usual first, at most MAX_FORMS. A slash chord only matches forms
 * whose lowest note is the bass: nothing is approximated (a C/E never gets a plain C form). With
 * `ignoreBass` (chosen by the user after "no-bass-forms") the forms of the chord without its bass are
 * listed, those that still contain the bass note somewhere first.
 */
export function formsFor(chord: ChordSymbol, opts: { ignoreBass?: boolean } = {}): FormSearch {
  if (!GUITAR_QUALITIES.includes(chord.quality)) return { kind: 'no-forms' };
  const all = [...GUITAR_FORMS.filter((f) => f.root === chord.root && f.quality === chord.quality)].sort((a, b) => a.priority - b.priority);
  if (all.length === 0) return { kind: 'no-forms' };
  const bass = chord.bass;
  if (bass === null) return { kind: 'forms', forms: all.slice(0, MAX_FORMS) };
  if (opts.ignoreBass) {
    const has = (f: GuitarForm) => fretsToPitches(f.frets).some((p) => p % 12 === bass);
    return { kind: 'forms', forms: [...all.filter(has), ...all.filter((f) => !has(f))].slice(0, MAX_FORMS) };
  }
  const matching = all.filter((f) => Math.min(...fretsToPitches(f.frets)) % 12 === bass);
  if (matching.length === 0) return { kind: 'no-bass-forms' };
  return { kind: 'forms', forms: matching.slice(0, MAX_FORMS) };
}

/** Lowest pressed fret when the diagram does not start at the nut (for the "5fr" mark), else 0. */
export function diagramBaseFret(frets: readonly number[]): number {
  const pressed = frets.filter((f) => f > 0);
  if (pressed.length === 0) return 0;
  const max = Math.max(...pressed);
  return max <= 4 ? 0 : Math.min(...pressed);
}
