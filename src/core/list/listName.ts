// What the user types into the NOTE column of the list (ADR-066). A note name or a bare number
// edits the row's own key / controller / program; a different event prefix ("CC7" on a note row)
// asks for a kind conversion. Pure parsing: nothing here touches the project.
import type { MidiEventKind } from '../model/types';
import { parseNoteName } from './noteNames';
import { t } from '../../i18n';

export type NameInput =
  | { kind: 'note'; pitch: number }
  | { kind: 'cc'; controller: number }
  /** 0-based program (the user types 1..128) */
  | { kind: 'program'; program: number }
  | { kind: 'pitch-bend' }
  | { kind: 'channel-pressure' }
  | { kind: 'poly-pressure'; pitch: number | null };

export type NameParse = NameInput | { error: string };

const in7 = (n: number) => Number.isInteger(n) && n >= 0 && n <= 127;

/**
 * Parses the NOTE cell. `current` decides what a bare integer means: the pitch on a note / poly
 * pressure row, the controller on a CC row, the 1-based program on a Program Change row.
 */
export function parseNameInput(text: string, current: MidiEventKind): NameParse {
  const s = text.trim();
  if (s === '') return { error: t('NOTE 列には音名（C4、F#3）か CC7 / PC5 / PB / CP / PP C4 を入力してください。') };
  const pitch = parseNoteName(s);
  if (pitch !== null) return current === 'poly-pressure' ? { kind: 'poly-pressure', pitch } : { kind: 'note', pitch };
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    switch (current) {
      case 'cc':
        return in7(n) ? { kind: 'cc', controller: n } : { error: t('コントローラー番号は 0〜127 です。') };
      case 'program':
        return Number.isInteger(n) && n >= 1 && n <= 128 ? { kind: 'program', program: n - 1 } : { error: t('音色番号は 1〜128 です。') };
      case 'poly-pressure':
        return in7(n) ? { kind: 'poly-pressure', pitch: n } : { error: t('ノート番号は 0〜127 です。') };
      default:
        return in7(n) ? { kind: 'note', pitch: n } : { error: t('ノート番号は 0〜127 です。') };
    }
  }
  const m = /^([a-zA-Z]{2})\s*(.*)$/.exec(s);
  if (m) {
    const prefix = m[1].toUpperCase();
    const rest = m[2].trim();
    if (prefix === 'CC') {
      if (!/^\d+$/.test(rest)) return { error: t('CC のあとにコントローラー番号を入力してください（例: CC7）。') };
      const n = Number(rest);
      return in7(n) ? { kind: 'cc', controller: n } : { error: t('コントローラー番号は 0〜127 です。') };
    }
    if (prefix === 'PC' || prefix === 'PG') {
      if (!/^\d+$/.test(rest)) return { error: t('PC のあとに音色番号を入力してください（例: PC5）。') };
      const n = Number(rest);
      return n >= 1 && n <= 128 ? { kind: 'program', program: n - 1 } : { error: t('音色番号は 1〜128 です。') };
    }
    if (prefix === 'PB' && rest === '') return { kind: 'pitch-bend' };
    if ((prefix === 'CP' || prefix === 'AT') && rest === '') return { kind: 'channel-pressure' };
    if (prefix === 'PP') {
      if (rest === '') return { kind: 'poly-pressure', pitch: null };
      const p = /^\d+$/.test(rest) ? Number(rest) : parseNoteName(rest);
      return p !== null && in7(p) ? { kind: 'poly-pressure', pitch: p } : { error: t('ノート番号は 0〜127 です。') };
    }
  }
  return { error: t('NOTE 列には音名（C4、F#3）か CC7 / PC5 / PB / CP / PP C4 を入力してください。') };
}
