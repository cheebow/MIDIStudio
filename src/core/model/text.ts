// UTF-8 helpers without TextEncoder/TextDecoder (not in the ECMAScript core library).
// Strict decoder adapted from MML Studio src/engine/smf-reader.ts.

export function decodeUtf8Strict(bytes: ArrayLike<number>): string | null {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp: number;
    let extra: number;
    if (b < 0x80) {
      cp = b;
      extra = 0;
    } else if (b >= 0xc2 && b <= 0xdf) {
      cp = b & 0x1f;
      extra = 1;
    } else if (b >= 0xe0 && b <= 0xef) {
      cp = b & 0x0f;
      extra = 2;
    } else if (b >= 0xf0 && b <= 0xf4) {
      cp = b & 0x07;
      extra = 3;
    } else return null;
    for (let k = 1; k <= extra; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if ((extra === 2 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) || (extra === 3 && (cp < 0x10000 || cp > 0x10ffff))) return null;
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

export function encodeUtf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

/** Text decoder injected by the app (e.g. TextDecoder('shift_jis')). Returns null when it cannot decode. */
export type TextDecodeFn = (bytes: Uint8Array) => string | null;

/** UTF-8 when valid, else the injected decoder, else printable ASCII with '?'. */
export function decodeMetaText(bytes: Uint8Array, fallback?: TextDecodeFn): { text: string; exact: boolean } {
  const utf8 = decodeUtf8Strict(bytes);
  if (utf8 !== null) return { text: utf8, exact: true };
  const alt = fallback?.(bytes);
  if (alt != null) return { text: alt, exact: false };
  let s = '';
  for (const b of bytes) s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '?';
  return { text: s, exact: false };
}
