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
  | { type: 'context-menu' };

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
  if (mod || otherMod) return null; // ⌘Z / ⌘C / ⌘V … stay global
  if (isInstrument(mode) && isMusical(k.code)) return null;
  switch (k.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      const delta = k.key === 'ArrowDown' ? 1 : -1;
      if (k.altKey) return mode === 'edit-shortcuts' || mode === 'drum-performance' || mode === 'step-drums' ? { type: 'nudge', delta: -delta, big: true } : null;
      if (isPiano(mode)) return null; // octave shift
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
