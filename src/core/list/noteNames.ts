// Note names <-> MIDI note numbers (UI_DESIGN 4 / 6: C4 = 60). Pure functions shared by the list,
// the piano roll and the key-binding editor. Parsing never rounds or clamps: an out-of-range name
// is refused (null) so the caller can say why.
export const NOTE_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const NOTE_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * Absolute note name ("C4", "F#4"). Black keys are named with sharps, or with flats ("Bb4") under a
 * flat key signature (sharpsFlats < 0). The name is never shortened by the key signature: a list
 * row must name the sounding pitch by itself.
 */
export const noteName = (p: number, sharpsFlats = 0) => `${(sharpsFlats < 0 ? NOTE_FLAT : NOTE_SHARP)[p % 12]}${Math.floor(p / 12) - 1}`;

const LETTER: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NAME = /^\s*([a-gA-G])\s*([#♯]|[b♭]|)\s*(-?\d{1,2})\s*$/;

/**
 * "C4", "c#4", "Db3", "A♭4", "C-1", "G9" -> 0..127. Returns null when the text is not a note name
 * or the pitch is outside the MIDI range (never clamps).
 */
export function parseNoteName(text: string): number | null {
  const m = NAME.exec(text);
  if (!m) return null;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const pitch = (Number(m[3]) + 1) * 12 + LETTER[m[1].toLowerCase()] + acc;
  return pitch >= 0 && pitch <= 127 ? pitch : null;
}
