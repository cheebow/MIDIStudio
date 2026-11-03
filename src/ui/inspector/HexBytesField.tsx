// Hex byte editor shared by the SysEx inspector and the list's SysEx / Meta dialog (ADR-066):
// "41 10 42 12 … F7" with live validation, a byte count and, for F0 SysEx, the GS meaning.
import { parseHexPayload } from '../../core/gs/gsProject';
import { decodeGs } from '../../core/gs/gsSysex';
import { t } from '../../i18n';

export const toHex = (bytes: ArrayLike<number>) => Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** Validation of the field's text: the bytes, or the reason it is not acceptable. */
export function hexFieldState(text: string, sysex: boolean): { bytes: number[]; error: null } | { bytes: null; error: string } {
  const bytes = parseHexPayload(text);
  if (!bytes) return { bytes: null, error: t('16進数（00〜FF）をスペース区切りで入力してください。') };
  if (sysex && bytes.slice(0, -1).some((b) => b >= 0x80)) return { bytes: null, error: t('SysEx の途中に 0x80 以上のバイトは置けません（最後の F7 を除く）。') };
  return { bytes, error: null };
}

export function HexBytesField({ value, onChange, sysex, label, testId }: { value: string; onChange: (text: string) => void; sysex: boolean; label?: string; testId?: string }) {
  const s = hexFieldState(value, sysex);
  const gs = sysex && s.bytes ? decodeGs(s.bytes) : null;
  return (
    <label className="hex-field">
      {label ?? (sysex ? t('16進で編集（F0 の後ろから。F7 で終わる）') : t('データ（16進）'))}
      <input className="hex-input" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-invalid={s.error !== null} data-testid={testId} />
      <span className="note">
        {s.error ?? t('{n} バイト', { n: s.bytes.length })}
        {gs && ` — ${gs.text}`}
        {sysex && s.bytes && !gs && s.bytes.length > 0 && !s.error && ` — ${t('解釈できない SysEx（そのまま保存します）')}`}
      </span>
    </label>
  );
}
