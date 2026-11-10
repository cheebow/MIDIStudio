// Which keys the list grid owns in each input mode (REQ-EDT-13, ADR-066). Pure so the table is
// unit-tested. `null` means the grid must let the key through untouched (no preventDefault /
// stopPropagation) so the musical keys, the octave keys, the step keys and the global shortcuts
// keep working while the list has focus. Keys are matched by `key` (the typed character), never by
// physical `code`, so JIS and US keyboards behave alike.
import type { InputMode } from './KeyboardRouter';

export type ListKeyIntent =
  | { type: 'row'; delta: number; extend: boolean }
  | { type: 'page'; delta: number }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'col'; delta: number }
  | { type: 'edit' }
  | { type: 'edit-typed'; text: string }
  /** +/- on the current cell; `big` = ×10 (K#: one octave) */
  | { type: 'nudge'; delta: number; big: boolean }
  | { type: 'repeat-last' }
  | { type: 'delete' }
  | { type: 'insert-menu' }
  /** ⌥/Alt + a letter of the insert menu, pressed on the grid itself: insert at once */
  | { type: 'insert'; kind: 'note' | 'cc' | 'program' | 'pitch-bend' | 'channel-pressure' | 'poly-pressure' | 'sysex' | 'meta' }
  /** ⌥↑↓ in the piano modes, where ↑↓ move rows: shift the PC-keyboard octave instead */
  | { type: 'octave'; delta: number }
  /** ⌘V at the cursor row; ⇧⌘V pushes the later events back first (Recomposer-style insertion) */
  | { type: 'paste'; insert: boolean }
  | { type: 'context-menu' };

/**
 * ⌥/Alt + letter inserts while the grid has focus, in every mode (the insert menu's access keys).
 * Matched by physical code: Option changes the typed character on macOS (⌥N = dead tilde, ⌥C = ç).
 */
export const INSERT_KEYS: Record<string, Extract<ListKeyIntent, { type: 'insert' }>['kind']> = { KeyN: 'note', KeyC: 'cc', KeyP: 'program', KeyB: 'pitch-bend', KeyA: 'channel-pressure', KeyY: 'poly-pressure', KeyS: 'sysex', KeyM: 'meta' };

export interface ListKey {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

const isPiano = (m: InputMode) => m === 'piano-performance' || m === 'step-piano';
const isStep = (m: InputMode) => m === 'step-piano' || m === 'step-drums';
const isInstrument = (m: InputMode) => m !== 'edit-shortcuts';

/**
 * @param isMusical whether the physical key sounds a note in the current mode (InputController.ownerOf)
 * @param isMac     ⌘ is the command modifier on macOS, Ctrl elsewhere
 */
export function listKeyIntent(mode: InputMode, k: ListKey, isMusical: (code: string) => boolean, isMac: boolean): ListKeyIntent | null {
  const mod = isMac ? k.metaKey : k.ctrlKey;
  const otherMod = isMac ? k.ctrlKey : k.metaKey;
  if (k.key === 'Enter' && mod && !k.altKey) return { type: 'repeat-last' };
  if (k.key === 'Enter' && k.altKey && !mod) return { type: 'insert-menu' };
  // a non-Latin layout types another letter on the V key: fall back to the key position, as the global shortcuts do (ADR-084)
  const typed = k.key.toLowerCase();
  const letter = /^\p{L}$/u.test(typed) && !/^[a-z]$/.test(typed) && /^Key[A-Z]$/.test(k.code) ? k.code.slice(3).toLowerCase() : typed;
  if (mod && !k.altKey && !otherMod && letter === 'v') return { type: 'paste', insert: k.shiftKey };
  if (mod || otherMod) return null; // ⌘Z / ⌘C … stay global
  if (k.altKey && !k.shiftKey && INSERT_KEYS[k.code]) return { type: 'insert', kind: INSERT_KEYS[k.code] };
  if (isInstrument(mode) && isMusical(k.code)) return null;
  switch (k.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      const delta = k.key === 'ArrowDown' ? 1 : -1;
      // the list in front of the user wins: ↑↓ move rows in every mode; the piano modes keep the octave on ⌥↑↓
      if (k.altKey) return isPiano(mode) ? { type: 'octave', delta: -delta } : { type: 'nudge', delta: -delta, big: true };
      return { type: 'row', delta, extend: k.shiftKey };
    }
    case 'ArrowRight':
    case 'ArrowLeft':
      if (k.altKey) return null;
      if (isStep(mode)) return null; // rest / back
      return { type: 'col', delta: k.key === 'ArrowRight' ? 1 : -1 };
    case 'Tab':
      if (k.altKey) return null;
      if (mode === 'piano-performance') return null; // sustain
      return { type: 'col', delta: k.shiftKey ? -1 : 1 };
    case 'PageDown':
      return { type: 'page', delta: 1 };
    case 'PageUp':
      return { type: 'page', delta: -1 };
    case 'Home':
      return { type: 'home' };
    case 'End':
      return { type: 'end' };
    case 'Enter':
    case 'F2':
      return { type: 'edit' };
    case 'Insert':
      return { type: 'insert-menu' };
    case 'ContextMenu':
      return { type: 'context-menu' };
    case 'F10':
      return k.shiftKey ? { type: 'context-menu' } : null;
    case 'Delete':
      return { type: 'delete' };
    case 'Backspace':
      return isStep(mode) ? null : { type: 'delete' }; // step undo
    default:
      break;
  }
  if (k.altKey) return null;
  if (mode === 'edit-shortcuts') {
    if (k.key === '+' || k.key === '=' || k.code === 'NumpadAdd') return { type: 'nudge', delta: 1, big: false };
    if (k.key === '-' || k.code === 'NumpadSubtract') return { type: 'nudge', delta: -1, big: false };
    if (/^[0-9./]$/.test(k.key)) return { type: 'edit-typed', text: k.key };
  }
  return null;
}
