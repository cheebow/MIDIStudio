import { describe, expect, it } from 'vitest';
import { KeyboardRouter, reassignKey, shiftOctave, type MusicalInputEvent } from '../../src/input/KeyboardRouter';
import { defaultInputPresets } from '../../src/core/model/defaults';
import { keyLabel } from '../../src/input/keyLabels';
import { GM_DRUM_MAP, GS_DRUM_MAP, drumLanes, drumName, findDrumMap } from '../../src/core/gm/drumMaps';

function setup() {
  const events: MusicalInputEvent[] = [];
  const r = new KeyboardRouter(defaultInputPresets(), (e) => events.push(e));
  return { r, events, summary: () => events.map((e) => `${e.type === 'note-on' ? '+' : '-'}${e.target}:${e.pitch}`) };
}

describe('KeyboardRouter', () => {
  it('starts in edit-shortcuts mode: keys never sound by accident (UI_DESIGN 10)', () => {
    const { r, events } = setup();
    expect(r.keyDown({ code: 'KeyZ' })).toBe('ignored');
    expect(events).toEqual([]);
  });

  it('I01: KeyDown = note-on, KeyUp = note-off, repeat does not retrigger', () => {
    const { r, summary } = setup();
    r.setMode('piano-performance');
    r.keyDown({ code: 'KeyZ' });
    expect(r.keyDown({ code: 'KeyZ', repeat: true })).toBe('consumed');
    r.keyDown({ code: 'KeyZ' }); // duplicate down without up (some browsers)
    r.keyDown({ code: 'KeyC' });
    r.keyUp({ code: 'KeyZ' });
    r.keyUp({ code: 'KeyC' });
    expect(summary()).toEqual(['+piano:60', '+piano:64', '-piano:60', '-piano:64']);
  });

  it('I02: the same physical key is piano in one mode and drum in the other, never both', () => {
    const { r, summary } = setup();
    r.setMode('piano-performance');
    r.keyDown({ code: 'KeyM' });
    r.setMode('drum-performance'); // mode change releases the held piano note
    r.keyDown({ code: 'KeyM' });
    r.keyUp({ code: 'KeyM' });
    expect(summary()).toEqual(['+piano:71', '-piano:71', '+drum:36', '-drum:36']);
  });

  it('I03: notebook drum layout (no numpad): 3x3 pads', () => {
    const { r, summary } = setup();
    r.setMode('drum-performance');
    for (const code of ['KeyU', 'KeyI', 'KeyO', 'KeyJ', 'KeyK', 'KeyL', 'KeyM', 'Comma', 'Period']) {
      r.keyDown({ code });
      r.keyUp({ code });
    }
    expect(summary().filter((s) => s.startsWith('+'))).toEqual(['+drum:49', '+drum:51', '+drum:46', '+drum:45', '+drum:47', '+drum:50', '+drum:36', '+drum:38', '+drum:42']);
  });

  it('I04 / I05: numpad pads by code (independent of NumLock / key text), also usable while in piano mode', () => {
    const { r, summary } = setup();
    r.setMode('drum-performance');
    for (const code of ['Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9', 'NumpadDecimal', 'NumpadEnter']) {
      r.keyDown({ code });
      r.keyUp({ code });
    }
    expect(summary().filter((s) => s.startsWith('+')).map((s) => Number(s.split(':')[1]))).toEqual([36, 36, 38, 42, 45, 47, 50, 49, 51, 46, 42, 38]);
    r.setMode('piano-performance');
    r.keyDown({ code: 'Numpad1' });
    expect(summary().pop()).toBe('+drum:36');
  });

  it('I06 / I07: text inputs and dialogs keep their keys; shortcuts with modifiers pass through', () => {
    const { r, events } = setup();
    r.setMode('drum-performance');
    expect(r.keyDown({ code: 'Numpad1', targetKind: 'text' })).toBe('ignored');
    expect(r.keyDown({ code: 'KeyM', targetKind: 'dialog' })).toBe('ignored');
    expect(r.keyDown({ code: 'KeyM', ctrlKey: true })).toBe('ignored');
    expect(events).toEqual([]);
  });

  it('I07: releaseAll (blur / hidden tab) closes every held note', () => {
    const { r, summary } = setup();
    r.setMode('piano-performance');
    r.keyDown({ code: 'KeyZ' });
    r.keyDown({ code: 'KeyX' });
    r.releaseAll();
    r.keyUp({ code: 'KeyZ' }); // late keyup after blur: nothing
    expect(summary()).toEqual(['+piano:60', '+piano:62', '-piano:60', '-piano:62']);
  });

  it('accent velocity with Shift, octave shift, key reassignment', () => {
    const { r, events } = setup();
    r.setMode('piano-performance');
    r.keyDown({ code: 'KeyZ', shiftKey: true });
    expect(events[0]).toMatchObject({ velocity: 120 });
    r.keyUp({ code: 'KeyZ' });
    r.setPresets(shiftOctave(defaultInputPresets(), 1));
    r.keyDown({ code: 'KeyZ' });
    expect(events[2]).toMatchObject({ pitch: 72, velocity: 100 });
    const m = reassignKey(defaultInputPresets().numpadKeys, 'Numpad1', 'NumpadAdd');
    expect(m.NumpadAdd).toBe(36);
    expect(m.Numpad0).toBe(36); // other kick slot kept
    expect(m.Numpad1).toBeUndefined();
  });

  it('JIS / US labels differ for symbols but codes stay the same', () => {
    expect(keyLabel('BracketLeft', 'us')).toBe('[');
    expect(keyLabel('BracketLeft', 'jis')).toBe('@');
    expect(keyLabel('KeyM', 'jis')).toBe('M');
    expect(keyLabel('NumpadDecimal', 'us')).toBe('Num .');
  });
});

describe('drum maps (E09)', () => {
  it('GM map covers 35..81; GS adds 27..34 and 82..87; names are labels only', () => {
    expect(GM_DRUM_MAP.entries).toHaveLength(47);
    expect(GS_DRUM_MAP.entries).toHaveLength(61);
    expect(drumName(GM_DRUM_MAP, 36)).toBe('Bass Drum 1');
    expect(drumName(GM_DRUM_MAP, 30)).toBe('Note 30');
    expect(drumName(GS_DRUM_MAP, 30)).toBe('Scratch Pull');
    expect(findDrumMap('nope').id).toBe('gm');
  });

  it('lanes include pitches the map does not know, so no note is hidden', () => {
    const lanes = drumLanes(GM_DRUM_MAP, [36, 20]);
    expect(lanes.some((l) => l.pitch === 20 && l.name === 'Note 20')).toBe(true);
    expect(drumLanes(GM_DRUM_MAP, [36, 38], { onlyUsed: true }).map((l) => l.pitch)).toEqual([36, 38]);
    const hidden = { ...GM_DRUM_MAP, hidden: [36, 49] };
    expect(drumLanes(hidden, [36]).some((l) => l.pitch === 36)).toBe(true); // used pitches stay visible
    expect(drumLanes(hidden, [36]).some((l) => l.pitch === 49)).toBe(false);
  });
});
