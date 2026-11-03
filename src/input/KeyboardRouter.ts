// PC keyboard -> musical input (INPUT_RECORDING 2/3/7, ARCHITECTURE H).
// Pure logic: takes key events as plain objects so it can be unit-tested without a DOM.
// - KeyDown = note-on, KeyUp = note-off, `repeat` ignored, pressed keys tracked by `code`.
// - The active InputMode decides who owns a key; one key never sounds as piano and drum at once.
// - Text inputs / dialogs keep their keys (no sound while typing).
// - releaseAll() on blur, visibility change, mode or key map change.
import type { SavedInputPresets } from '../core/model/types';

export type InputMode = 'edit-shortcuts' | 'piano-performance' | 'drum-performance' | 'step-piano' | 'step-drums';

export type MusicalInputEvent =
  | { type: 'note-on'; pitch: number; velocity: number; sourceId: string; atMs: number; target: 'piano' | 'drum' }
  | { type: 'note-off'; pitch: number; releaseVelocity: number; sourceId: string; atMs: number; target: 'piano' | 'drum' };

export interface KeyInput {
  code: string;
  repeat?: boolean;
  /** element type that has focus: text inputs never produce notes */
  targetKind?: 'text' | 'dialog' | 'other';
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** event time (performance.now() domain) */
  timeStamp?: number;
}

export type RouteResult = 'note' | 'consumed' | 'ignored';

export const ACCENT_CODE = 'ShiftLeft';

export class KeyboardRouter {
  private pressed = new Map<string, { pitch: number; target: 'piano' | 'drum' }>();
  private _mode: InputMode = 'edit-shortcuts';
  /** Shift held = accent velocity */
  private accent = false;

  constructor(
    private presets: SavedInputPresets,
    private readonly emit: (e: MusicalInputEvent) => void,
    private readonly now: () => number = () => 0,
  ) {}

  get mode(): InputMode {
    return this._mode;
  }

  setMode(mode: InputMode): void {
    if (mode === this._mode) return;
    this.releaseAll();
    this._mode = mode;
  }

  setPresets(presets: SavedInputPresets): void {
    this.releaseAll();
    this.presets = presets;
  }

  /** Which instrument (if any) owns a physical key in the current mode. */
  ownerOf(code: string): { pitch: number; target: 'piano' | 'drum' } | null {
    const p = this.presets;
    const isNumpad = code.startsWith('Numpad');
    const piano = this._mode === 'piano-performance' || this._mode === 'step-piano';
    const drum = this._mode === 'drum-performance' || this._mode === 'step-drums';
    if (piano) {
      if (!isNumpad && p.pianoKeys[code] !== undefined) {
        const pitch = p.pianoKeys[code] + 12 * p.pianoOctaveShift;
        return pitch >= 0 && pitch <= 127 ? { pitch, target: 'piano' } : null;
      }
      // the numpad has no piano role, so it can stay a drum pad at the same time (INPUT_RECORDING 3)
      if (isNumpad && p.numpadKeys[code] !== undefined) return { pitch: p.numpadKeys[code], target: 'drum' };
      return null;
    }
    if (drum) {
      if (isNumpad && p.numpadKeys[code] !== undefined) return { pitch: p.numpadKeys[code], target: 'drum' };
      if (!isNumpad && p.drumPadKeys[code] !== undefined) return { pitch: p.drumPadKeys[code], target: 'drum' };
    }
    return null;
  }

  keyDown(k: KeyInput): RouteResult {
    if (k.code === 'ShiftLeft' || k.code === 'ShiftRight') {
      this.accent = true;
      return 'ignored';
    }
    if (k.targetKind === 'text' || k.targetKind === 'dialog') return 'ignored';
    if (this._mode === 'edit-shortcuts') return 'ignored';
    if (k.ctrlKey || k.metaKey || k.altKey) return 'ignored'; // leave shortcuts alone
    const owner = this.ownerOf(k.code);
    if (!owner) return 'ignored';
    if (k.repeat || this.pressed.has(k.code)) return 'consumed';
    this.pressed.set(k.code, owner);
    const velocity = this.accent || k.shiftKey ? this.presets.accentVelocity : this.presets.defaultVelocity;
    this.emit({ type: 'note-on', pitch: owner.pitch, velocity, sourceId: 'pc-keyboard', atMs: k.timeStamp ?? this.now(), target: owner.target });
    return 'note';
  }

  keyUp(k: KeyInput): RouteResult {
    if (k.code === 'ShiftLeft' || k.code === 'ShiftRight') {
      this.accent = false;
      return 'ignored';
    }
    const held = this.pressed.get(k.code);
    if (!held) return 'ignored';
    this.pressed.delete(k.code);
    this.emit({ type: 'note-off', pitch: held.pitch, releaseVelocity: 64, sourceId: 'pc-keyboard', atMs: k.timeStamp ?? this.now(), target: held.target });
    return 'note';
  }

  /** Note-off for every held key (blur, hidden tab, mode / map change, sound bank switch). */
  releaseAll(): void {
    const at = this.now();
    for (const [code, held] of this.pressed) {
      this.pressed.delete(code);
      this.emit({ type: 'note-off', pitch: held.pitch, releaseVelocity: 64, sourceId: 'pc-keyboard', atMs: at, target: held.target });
    }
    this.accent = false;
  }
}

/** Presets helpers */
export function shiftOctave(p: SavedInputPresets, delta: number): SavedInputPresets {
  return { ...p, pianoOctaveShift: Math.max(-4, Math.min(4, p.pianoOctaveShift + delta)) };
}

/**
 * Moves one slot of a key map from `oldCode` to `newCode` (same pitch). If `newCode` was used by
 * another slot of this map, that slot is replaced. Other slots with the same pitch are kept.
 */
export function reassignKey(map: Record<string, number>, oldCode: string, newCode: string): Record<string, number> {
  const pitch = map[oldCode];
  if (pitch === undefined || oldCode === newCode) return map;
  const next: Record<string, number> = {};
  for (const [c, p] of Object.entries(map)) if (c !== oldCode && c !== newCode) next[c] = p;
  next[newCode] = pitch;
  return next;
}
