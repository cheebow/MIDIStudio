// Fallback text decoder for SMF meta text: many Japanese MIDI files use Shift_JIS.
let sjis: TextDecoder | null | undefined;

export function decodeShiftJis(bytes: Uint8Array): string | null {
  if (sjis === undefined) {
    try {
      sjis = new TextDecoder('shift_jis', { fatal: true });
    } catch {
      sjis = null;
    }
  }
  if (!sjis) return null;
  try {
    return sjis.decode(bytes);
  } catch {
    return null;
  }
}
