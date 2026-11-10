// Issue #19 / ADR-099: positions as bar.beat.tick (MBT) in the list, the conductor tab and the locate field.
import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterIdGenerator, setIdGenerator } from '../../src/core/model/ids';
import { createEmptyProject } from '../../src/core/model/defaults';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { parseProjectFile, serializeProject } from '../../src/core/project-io/projectFile';
import { applyCommand } from '../../src/core/editing/history';
import { listRows } from '../../src/core/list/listRows';
import { nudgeCell, nudgedValue } from '../../src/core/list/listNudge';
import { formatListPosition, parsePositionInput, shiftByBeats } from '../../src/core/list/listPosition';
import { TimeSignatureMap } from '../../src/core/timing/timeSignatureMap';
import { build, off, on, program, timeSig } from '../fixtures/songs';

beforeEach(() => setIdGenerator(createCounterIdGenerator('mbt')));

/** PPQ 480: 4/4 for two bars (0..3839), then 3/4 from bar 3 (tick 3840), then 6/8 from bar 5 (tick 6720) */
const sig = new TimeSignatureMap(480, [
  { tick: 0, numerator: 4, denominator: 4 },
  { tick: 3840, numerator: 3, denominator: 4 },
  { tick: 6720, numerator: 6, denominator: 8 },
]);
const ok = (ticks: number) => ({ ok: true, ticks });

describe('position text (ADR-099)', () => {
  it('formats across time-signature changes; the Tick notation follows the list unit', () => {
    expect(formatListPosition(0, 'mbt', sig, 'native', 480)).toBe('001.01.000');
    expect(formatListPosition(3840 - 1, 'mbt', sig, 'native', 480)).toBe('002.04.479');
    expect(formatListPosition(3840 + 960 + 10, 'mbt', sig, 'native', 480)).toBe('003.03.010');
    expect(formatListPosition(5280, 'mbt', sig, 'native', 480)).toBe('004.01.000'); // a 3/4 bar is 1440 ticks
    expect(formatListPosition(6720 + 240 * 5 + 7, 'mbt', sig, 'native', 480)).toBe('005.06.007'); // 6/8: an eighth is a beat
    // the display unit of ST / GT does not change the MBT text, only the Tick notation
    expect(formatListPosition(960, 'mbt', sig, 'classic48', 480)).toBe('001.03.000');
    expect(formatListPosition(960, 'tick', sig, 'classic48', 480)).toBe('96');
    expect(formatListPosition(960, 'tick', sig, 'native', 480)).toBe('960');
  });

  it('reads full, shortened and differently separated input', () => {
    expect(parsePositionInput('3.2.240', 'mbt', sig, 0)).toEqual(ok(3840 + 480 + 240));
    expect(parsePositionInput('003.02.240', 'mbt', sig, 0)).toEqual(ok(3840 + 480 + 240));
    expect(parsePositionInput('4', 'mbt', sig, 0)).toEqual(ok(5280));
    expect(parsePositionInput('4.3', 'mbt', sig, 0)).toEqual(ok(5280 + 960));
    expect(parsePositionInput(' 5:6:7 ', 'mbt', sig, 0)).toEqual(ok(6720 + 1200 + 7));
    expect(parsePositionInput('5 2', 'mbt', sig, 0)).toEqual(ok(6720 + 240));
  });

  it('refuses a beat the bar does not have, bar 0 and text that is not a position', () => {
    expect(parsePositionInput('2.4', 'mbt', sig, 0)).toEqual(ok(1920 + 1440)); // 4/4 has a 4th beat
    expect(parsePositionInput('3.4', 'mbt', sig, 0).ok).toBe(false); // 3/4 does not
    expect(parsePositionInput('5.7', 'mbt', sig, 0).ok).toBe(false); // 6/8 has six
    expect(parsePositionInput('0.1.0', 'mbt', sig, 0).ok).toBe(false);
    expect(parsePositionInput('1.0.0', 'mbt', sig, 0).ok).toBe(false);
    expect(parsePositionInput('abc', 'mbt', sig, 0).ok).toBe(false);
    expect(parsePositionInput('', 'mbt', sig, 0).ok).toBe(false);
    expect(parsePositionInput('1.1.0.0', 'mbt', sig, 0).ok).toBe(false);
  });

  it('+n / -n moves from the current position in ticks, in both notations, never before the start', () => {
    expect(parsePositionInput('+120', 'mbt', sig, 480)).toEqual(ok(600));
    expect(parsePositionInput('-120', 'mbt', sig, 480)).toEqual(ok(360));
    expect(parsePositionInput('+120', 'tick', sig, 480)).toEqual(ok(600));
    expect(parsePositionInput('-481', 'mbt', sig, 480).ok).toBe(false);
    expect(parsePositionInput('-1.0.0', 'mbt', sig, 480).ok).toBe(false); // relative input is in ticks only, like the note info bar
  });

  it('the Tick notation takes whole ticks and nothing else', () => {
    expect(parsePositionInput('960', 'tick', sig, 0)).toEqual(ok(960));
    expect(parsePositionInput('2.1.0', 'tick', sig, 0).ok).toBe(false);
    expect(parsePositionInput('12.5', 'tick', sig, 0).ok).toBe(false);
    expect(parsePositionInput('999999999999', 'tick', sig, 0).ok).toBe(false);
  });

  it('the tick part is as wide as a beat needs (PPQ 1000 and more, long beats)', () => {
    const big = new TimeSignatureMap(1920, [{ tick: 0, numerator: 4, denominator: 4 }]);
    expect(big.format(0)).toBe('001.01.0000');
    expect(big.format(1920 + 1919)).toBe('001.02.1919');
    expect(big.parse(big.format(1920 * 5 + 77))).toBe(1920 * 5 + 77);
    const halves = new TimeSignatureMap(960, [{ tick: 0, numerator: 2, denominator: 2 }]);
    expect(halves.format(1000)).toBe('001.01.1000');
    expect(new TimeSignatureMap(960, []).format(959)).toBe('001.01.959'); // unchanged where three digits are enough
  });
});

describe('moving by beats (ADR-099)', () => {
  it('uses the beat length where the position is, also backwards over a signature change', () => {
    expect(shiftByBeats(0, 1, sig)).toBe(480);
    expect(shiftByBeats(100, 4, sig)).toBe(2020);
    expect(shiftByBeats(6720, 2, sig)).toBe(6720 + 480); // 6/8: two eighths
    expect(shiftByBeats(6720, -1, sig)).toBe(6240); // back into 3/4: a quarter
    expect(shiftByBeats(6720 + 240, -2, sig)).toBe(6240);
    expect(shiftByBeats(200, -1, sig)).toBe(0); // not below the start
    expect(shiftByBeats(0, -3, sig)).toBe(0);
  });

  it('TICK nudges in the MBT notation: one native tick per step, whole beats for the big step', () => {
    const r = openMidiFile(build(1, 480, [timeSig(0, 4, 2)], [program(0, 0, 0), on(100, 0, 60), off(240, 0, 60)]));
    if (!r.ok) throw new Error();
    const p = r.project;
    const map = new TimeSignatureMap(480, [{ tick: 0, numerator: 4, denominator: 4 }]);
    const row = () => listRows(p, p.tracks[0]).find((x) => x.name === 'C4')!;
    // Classic 48 would be 10 ticks per step at PPQ 480; the MBT position counts native ticks
    expect(nudgedValue(row(), 'tick', { steps: 1, unit: 'classic48', ppq: 480, mbt: { sig: map } }, 0)).toEqual({ ok: true, value: 101 });
    expect(nudgedValue(row(), 'tick', { steps: 1, unit: 'classic48', ppq: 480 }, 0)).toEqual({ ok: true, value: 110 });
    expect(nudgedValue(row(), 'tick', { steps: 10, unit: 'native', ppq: 480, mbt: { sig: map, beats: 1 } }, 0)).toEqual({ ok: true, value: 580 });
    expect(nudgedValue(row(), 'tick', { steps: -10, unit: 'native', ppq: 480, mbt: { sig: map, beats: -1 } }, 0)).toEqual({ ok: true, value: 0 });
    const cmd = nudgeCell(p, p.tracks[0].id, row(), 'tick', { steps: 20, unit: 'native', ppq: 480, mbt: { sig: map, beats: 2 } });
    const after = applyCommand(p, (cmd as { command: NonNullable<Parameters<typeof applyCommand>[1]> }).command).project;
    expect(listRows(after, after.tracks[0]).find((x) => x.name === 'C4')!.tick).toBe(1060);
  });
});

describe('the notation is a project setting (ADR-099)', () => {
  it('is saved and restored; a file from before has the defaults (list: Tick, conductor: bar.beat.tick)', () => {
    const p = createEmptyProject();
    expect(p.settings.listPositionUnit).toBe('tick');
    expect(p.settings.conductorPositionUnit).toBe('mbt');
    const saved = parseProjectFile(serializeProject({ ...p, settings: { ...p.settings, listPositionUnit: 'mbt', conductorPositionUnit: 'tick' } }));
    if (!saved.ok) throw new Error(saved.errors.join('\n'));
    expect(saved.project.settings.listPositionUnit).toBe('mbt');
    expect(saved.project.settings.conductorPositionUnit).toBe('tick');
    const json = JSON.parse(serializeProject(p));
    delete json.project.settings.listPositionUnit;
    json.project.settings.conductorPositionUnit = 'bars';
    const old = parseProjectFile(JSON.stringify(json));
    if (!old.ok) throw new Error(old.errors.join('\n'));
    expect(old.project.settings.listPositionUnit).toBe('tick');
    expect(old.project.settings.conductorPositionUnit).toBe('mbt');
  });
});
