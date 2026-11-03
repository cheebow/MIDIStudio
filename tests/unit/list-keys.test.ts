// LIST-06: which keys the list grid owns in each input mode (REQ-EDT-13, ADR-066).
import { describe, expect, it } from 'vitest';
import { listKeyIntent, type ListKey } from '../../src/input/listKeys';
import type { InputMode } from '../../src/input/KeyboardRouter';

const k = (key: string, extra: Partial<ListKey> = {}): ListKey => ({ key, code: extra.code ?? `Key${key.toUpperCase()}`, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra });
/** default piano map: Z = C4, Digit2 = C#5 … (musical in the piano modes); M is a drum pad */
const musical = (mode: InputMode) => (code: string) => (mode === 'piano-performance' || mode === 'step-piano' ? ['KeyZ', 'Digit2', 'KeyM'].includes(code) : mode === 'drum-performance' || mode === 'step-drums' ? ['KeyM', 'Numpad1'].includes(code) : false);
const intent = (mode: InputMode, key: ListKey, mac = true) => listKeyIntent(mode, key, musical(mode), mac);
const MODES: InputMode[] = ['edit-shortcuts', 'piano-performance', 'drum-performance', 'step-piano', 'step-drums'];

describe('list key ownership (LIST-06)', () => {
  it('musical keys and the digits of the piano map never start an edit in the instrument modes', () => {
    expect(intent('edit-shortcuts', k('2', { code: 'Digit2' }))).toEqual({ type: 'edit-typed', text: '2' });
    expect(intent('piano-performance', k('2', { code: 'Digit2' }))).toBeNull();
    expect(intent('piano-performance', k('z'))).toBeNull();
    expect(intent('drum-performance', k('m'))).toBeNull();
    expect(intent('drum-performance', k('2', { code: 'Digit2' }))).toBeNull(); // digits are never cell input outside the edit mode
    expect(intent('step-drums', k('1', { code: 'Numpad1' }))).toBeNull();
  });

  it('↑↓ move rows except in the piano modes (octave shift); Shift extends the selection', () => {
    expect(intent('edit-shortcuts', k('ArrowDown', { code: 'ArrowDown' }))).toEqual({ type: 'row', delta: 1, extend: false });
    expect(intent('edit-shortcuts', k('ArrowUp', { code: 'ArrowUp', shiftKey: true }))).toEqual({ type: 'row', delta: -1, extend: true });
    expect(intent('drum-performance', k('ArrowDown', { code: 'ArrowDown' }))).toEqual({ type: 'row', delta: 1, extend: false });
    expect(intent('piano-performance', k('ArrowDown', { code: 'ArrowDown' }))).toBeNull();
    expect(intent('step-piano', k('ArrowUp', { code: 'ArrowUp' }))).toBeNull();
  });

  it('←→ move columns except in the step modes (rest / back); Tab is sustain in the piano mode', () => {
    expect(intent('edit-shortcuts', k('ArrowRight', { code: 'ArrowRight' }))).toEqual({ type: 'col', delta: 1 });
    expect(intent('piano-performance', k('ArrowLeft', { code: 'ArrowLeft' }))).toEqual({ type: 'col', delta: -1 });
    expect(intent('step-piano', k('ArrowRight', { code: 'ArrowRight' }))).toBeNull();
    expect(intent('step-drums', k('ArrowLeft', { code: 'ArrowLeft' }))).toBeNull();
    expect(intent('edit-shortcuts', k('Tab', { code: 'Tab', shiftKey: true }))).toEqual({ type: 'col', delta: -1 });
    expect(intent('piano-performance', k('Tab', { code: 'Tab' }))).toBeNull();
    expect(intent('drum-performance', k('Tab', { code: 'Tab' }))).toEqual({ type: 'col', delta: 1 });
  });

  it('Backspace is the step undo in the step modes and delete elsewhere; Delete always deletes', () => {
    for (const m of MODES) expect(intent(m, k('Delete', { code: 'Delete' }))).toEqual({ type: 'delete' });
    expect(intent('edit-shortcuts', k('Backspace', { code: 'Backspace' }))).toEqual({ type: 'delete' });
    expect(intent('piano-performance', k('Backspace', { code: 'Backspace' }))).toEqual({ type: 'delete' });
    expect(intent('step-piano', k('Backspace', { code: 'Backspace' }))).toBeNull();
    expect(intent('step-drums', k('Backspace', { code: 'Backspace' }))).toBeNull();
  });

  it('+ / - step the cell in the edit mode only (JIS and US: matched by the typed character); ⌥↑↓ is the big step', () => {
    expect(intent('edit-shortcuts', k('+', { code: 'Semicolon', shiftKey: true }))).toEqual({ type: 'nudge', delta: 1, big: false }); // JIS: Shift+;
    expect(intent('edit-shortcuts', k('+', { code: 'Equal', shiftKey: true }))).toEqual({ type: 'nudge', delta: 1, big: false }); // US: Shift+=
    expect(intent('edit-shortcuts', k('=', { code: 'Equal' }))).toEqual({ type: 'nudge', delta: 1, big: false });
    expect(intent('edit-shortcuts', k('-', { code: 'Minus' }))).toEqual({ type: 'nudge', delta: -1, big: false });
    expect(intent('edit-shortcuts', k('+', { code: 'NumpadAdd' }))).toEqual({ type: 'nudge', delta: 1, big: false });
    expect(intent('step-piano', k('-', { code: 'Minus' }))).toBeNull(); // tie
    expect(intent('piano-performance', k('-', { code: 'Minus' }))).toBeNull();
    expect(intent('edit-shortcuts', k('ArrowUp', { code: 'ArrowUp', altKey: true }))).toEqual({ type: 'nudge', delta: 1, big: true });
    expect(intent('edit-shortcuts', k('ArrowDown', { code: 'ArrowDown', altKey: true }))).toEqual({ type: 'nudge', delta: -1, big: true });
    expect(intent('piano-performance', k('ArrowUp', { code: 'ArrowUp', altKey: true }))).toBeNull();
  });

  it('Enter / F2 edit, ⌘Enter repeats, ⌥Enter / Insert open the insert menu, ⌘-shortcuts stay global', () => {
    for (const m of MODES) {
      expect(intent(m, k('Enter', { code: 'Enter' }))).toEqual({ type: 'edit' });
      expect(intent(m, k('F2', { code: 'F2' }))).toEqual({ type: 'edit' });
      expect(intent(m, k('Enter', { code: 'Enter', metaKey: true }))).toEqual({ type: 'repeat-last' });
      expect(intent(m, k('Enter', { code: 'Enter', altKey: true }))).toEqual({ type: 'insert-menu' });
      expect(intent(m, k('Insert', { code: 'Insert' }))).toEqual({ type: 'insert-menu' });
      expect(intent(m, k('z', { metaKey: true }))).toBeNull();
      expect(intent(m, k('c', { metaKey: true }))).toBeNull();
      expect(intent(m, k(' ', { code: 'Space' }))).toBeNull();
      expect(intent(m, k('Escape', { code: 'Escape' }))).toBeNull();
      expect(intent(m, k('l'))).toBeNull();
    }
    expect(intent('edit-shortcuts', k('Enter', { code: 'Enter', ctrlKey: true }), false)).toEqual({ type: 'repeat-last' }); // Windows / Linux
    expect(intent('edit-shortcuts', k('z', { ctrlKey: true }), false)).toBeNull();
    expect(intent('edit-shortcuts', k('F10', { code: 'F10', shiftKey: true }))).toEqual({ type: 'context-menu' });
    expect(intent('edit-shortcuts', k('PageDown', { code: 'PageDown' }))).toEqual({ type: 'page', delta: 1 });
    expect(intent('edit-shortcuts', k('Home', { code: 'Home' }))).toEqual({ type: 'home' });
  });
});
