// LIST-01: note names and the NOTE-column grammar (ADR-066).
import { describe, expect, it } from 'vitest';
import { noteName, parseNoteName } from '../../src/core/list/noteNames';
import { parseNameInput } from '../../src/core/list/listName';

describe('note names (LIST-01)', () => {
  it('round-trips every MIDI note with sharps and with flats', () => {
    for (let p = 0; p <= 127; p++) {
      expect(parseNoteName(noteName(p))).toBe(p);
      expect(parseNoteName(noteName(p, -1))).toBe(p);
    }
  });

  it('accepts lower case, spaces, ♯ / ♭ and negative octaves; refuses what is not a note', () => {
    expect(parseNoteName('c4')).toBe(60);
    expect(parseNoteName(' C#4 ')).toBe(61);
    expect(parseNoteName('Db4')).toBe(61);
    expect(parseNoteName('A♭4')).toBe(68);
    expect(parseNoteName('C♯-1')).toBe(1);
    expect(parseNoteName('C-1')).toBe(0);
    expect(parseNoteName('G9')).toBe(127);
    expect(parseNoteName('G#9')).toBeNull(); // 128
    expect(parseNoteName('C10')).toBeNull();
    expect(parseNoteName('C#-2')).toBeNull();
    expect(parseNoteName('H4')).toBeNull();
    expect(parseNoteName('60')).toBeNull();
    expect(parseNoteName('')).toBeNull();
  });
});

describe('NOTE column grammar (LIST-01)', () => {
  it('a bare number means the row\'s own field', () => {
    expect(parseNameInput('62', 'note')).toEqual({ kind: 'note', pitch: 62 });
    expect(parseNameInput('11', 'cc')).toEqual({ kind: 'cc', controller: 11 });
    expect(parseNameInput('5', 'program')).toEqual({ kind: 'program', program: 4 });
    expect(parseNameInput('62', 'poly-pressure')).toEqual({ kind: 'poly-pressure', pitch: 62 });
    expect(parseNameInput('128', 'note')).toHaveProperty('error');
    expect(parseNameInput('0', 'program')).toHaveProperty('error');
    expect(parseNameInput('129', 'program')).toHaveProperty('error');
  });

  it('a note name edits the pitch of a note / poly pressure row and converts the others', () => {
    expect(parseNameInput('F#3', 'note')).toEqual({ kind: 'note', pitch: 54 });
    expect(parseNameInput('F#3', 'cc')).toEqual({ kind: 'note', pitch: 54 });
    expect(parseNameInput('F#3', 'poly-pressure')).toEqual({ kind: 'poly-pressure', pitch: 54 });
  });

  it('event prefixes', () => {
    expect(parseNameInput('CC7', 'note')).toEqual({ kind: 'cc', controller: 7 });
    expect(parseNameInput('cc 64', 'note')).toEqual({ kind: 'cc', controller: 64 });
    expect(parseNameInput('CC128', 'note')).toHaveProperty('error');
    expect(parseNameInput('CC', 'note')).toHaveProperty('error');
    expect(parseNameInput('PC5', 'note')).toEqual({ kind: 'program', program: 4 });
    expect(parseNameInput('pg128', 'note')).toEqual({ kind: 'program', program: 127 });
    expect(parseNameInput('PC0', 'note')).toHaveProperty('error');
    expect(parseNameInput('PB', 'note')).toEqual({ kind: 'pitch-bend' });
    expect(parseNameInput('CP', 'note')).toEqual({ kind: 'channel-pressure' });
    expect(parseNameInput('AT', 'note')).toEqual({ kind: 'channel-pressure' });
    expect(parseNameInput('PP C4', 'note')).toEqual({ kind: 'poly-pressure', pitch: 60 });
    expect(parseNameInput('PP60', 'note')).toEqual({ kind: 'poly-pressure', pitch: 60 });
    expect(parseNameInput('PP', 'note')).toEqual({ kind: 'poly-pressure', pitch: null });
    expect(parseNameInput('XY', 'note')).toHaveProperty('error');
    expect(parseNameInput('', 'note')).toHaveProperty('error');
  });
});
