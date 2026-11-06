// Chord-name estimate (ADR-090, TEST_PLAN U-CHD-*).
import { describe, expect, it } from 'vitest';
import { analyzeChords, beatBoundaries, chordAt, chordName, estimateKey, trackRole, type ChordSegment } from '../../src/core/theory/chords';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { TimeSignatureMap } from '../../src/core/timing/timeSignatureMap';
import type { MidiProject } from '../../src/core/model/types';
import { program } from '../fixtures/smf-build';
import { build, meta, off, on, sysex, GS_RESET, GS_RHYTHM_PART_11, timeSig, type Ev } from '../fixtures/songs';

const Q = 480;
const BAR = Q * 4;

/** [tick, duration, pitch, velocity?] notes on one channel -> delta-time events. */
type N = [tick: number, dur: number, pitch: number, vel?: number];
function trackEvents(ch: number, notes: N[], head: Ev[] = []): Ev[] {
  const ev: { tick: number; on: boolean; p: number; v: number }[] = [];
  for (const [t, d, p, v = 100] of notes) {
    ev.push({ tick: t, on: true, p, v });
    ev.push({ tick: t + d, on: false, p, v });
  }
  ev.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on));
  const out: Ev[] = [...head];
  let last = 0;
  for (const e of ev) {
    out.push(e.on ? on(e.tick - last, ch, e.p, e.v) : off(e.tick - last, ch, e.p));
    last = e.tick;
  }
  return out;
}
function open(...tracks: Ev[][]): MidiProject {
  const r = openMidiFile(build(1, Q, ...tracks));
  if (!r.ok) throw new Error('open failed');
  return r.project;
}
const block = (tick: number, dur: number, pitches: number[]): N[] => pitches.map((p) => [tick, dur, p]);
const names = (s: ChordSegment[]) => s.map((c) => c.name);
const conductor = (head: Ev[] = []): Ev[] => [timeSig(0, 4, 2), ...head];

// C | Am | F | G7 (one bar each), whole-note block chords
const PADS: N[] = [...block(0, BAR, [60, 64, 67]), ...block(BAR, BAR, [57, 60, 64]), ...block(BAR * 2, BAR, [53, 57, 60]), ...block(BAR * 3, BAR, [55, 59, 62, 65])];
const BASS: N[] = [
  [0, BAR, 36],
  [BAR, BAR, 33],
  [BAR * 2, BAR, 41],
  [BAR * 3, BAR, 43],
];

describe('chord estimate', () => {
  it('U-CHD-01 block chords: names and spans (merged per run)', () => {
    const s = analyzeChords(open(conductor(), trackEvents(0, PADS), trackEvents(1, BASS)));
    expect(names(s)).toEqual(['C', 'Am', 'F', 'G7']);
    expect(s.map((c) => [c.tick, c.endTick])).toEqual([
      [0, BAR],
      [BAR, BAR * 2],
      [BAR * 2, BAR * 3],
      [BAR * 3, BAR * 4],
    ]);
  });

  it('U-CHD-02 a melody with passing / neighbour tones does not change the chords', () => {
    // eighth-note melody over every bar, half of it outside the chord
    const mel: N[] = [];
    const line = [72, 74, 76, 77, 79, 77, 76, 74]; // C D E F G F E D
    for (let bar = 0; bar < 4; bar++) line.forEach((p, i) => mel.push([bar * BAR + i * (Q / 2), Q / 2, p]));
    const s = analyzeChords(open(conductor(), trackEvents(0, PADS), trackEvents(1, BASS), trackEvents(2, mel)));
    expect(names(s)).toEqual(['C', 'Am', 'F', 'G7']);
  });

  it('U-CHD-03 inversion: a chord tone in the bass gives a slash chord; a passing bass note does not', () => {
    const s = analyzeChords(open(conductor(), trackEvents(0, block(0, BAR, [60, 64, 67])), trackEvents(1, [[0, BAR, 40]])));
    expect(names(s)).toEqual(['C/E']);
    // walking bass C D E G under C: one C for the bar (no Cadd9/D, C/E, C/G)
    const walk: N[] = [36, 38, 40, 43].map((p, i) => [i * Q, Q, p]);
    const w = analyzeChords(open(conductor(), trackEvents(0, block(0, BAR, [60, 64, 67])), trackEvents(1, walk)));
    expect(w.map((c) => [c.name, c.tick, c.endTick])).toEqual([['C', 0, BAR]]);
  });

  it('U-CHD-04 arpeggio (sixteenths) is recognised', () => {
    const arp: N[] = [];
    for (let i = 0; i < 16; i++) arp.push([i * (Q / 4), Q / 4, [57, 60, 64, 69][i % 4]]);
    expect(names(analyzeChords(open(conductor(), trackEvents(0, arp))))).toEqual(['Am']);
  });

  it('U-CHD-05 drum tracks, channel 10 and GS rhythm parts are ignored', () => {
    const drums = trackEvents(9, block(0, BAR, [36, 38, 42, 46, 49]));
    const rhythm = trackEvents(10, block(0, BAR, [37, 39, 41]), [sysex(0, GS_RESET), sysex(0, GS_RHYTHM_PART_11)]);
    const s = analyzeChords(open(conductor(), trackEvents(0, block(0, BAR, [62, 65, 69])), drums, rhythm));
    expect(names(s)).toEqual(['Dm']);
  });

  it('U-CHD-06 muted tracks and tracks outside the solo are left out', () => {
    const p = open(conductor(), trackEvents(0, block(0, BAR, [60, 64, 67])), trackEvents(1, block(0, BAR, [61, 65, 68])));
    const mute = { ...p, tracks: p.tracks.map((t) => (t.channel === 1 ? { ...t, mute: true } : t)) };
    expect(names(analyzeChords(mute))).toEqual(['C']);
    const solo = { ...p, tracks: p.tracks.map((t) => (t.channel === 1 ? { ...t, solo: true } : t)) };
    expect(names(analyzeChords(solo))).toEqual(['Db']);
  });

  it('U-CHD-07 silence ends a chord; a single line alone is not named', () => {
    const p = open(conductor(), trackEvents(0, [...block(0, Q * 2, [60, 64, 67]), ...block(BAR * 2, Q * 2, [55, 59, 62])]));
    const s = analyzeChords(p);
    expect(s.map((c) => [c.name, c.tick, c.endTick])).toEqual([
      ['C', 0, Q * 2],
      ['G', BAR * 2, BAR * 2 + Q * 2],
    ]);
    expect(analyzeChords(open(conductor(), trackEvents(0, [[0, BAR, 72]])))).toEqual([]);
    // a single note after a chord keeps the chord (melody pickup over a held harmony)
    const held = analyzeChords(open(conductor(), trackEvents(0, [...block(0, BAR, [48, 52, 55]), [BAR, Q, 72]])));
    expect(held.map((c) => [c.name, c.endTick])).toEqual([['C', BAR + Q]]);
  });

  it('U-CHD-08 an ambiguous beat keeps the previous chord (no flicker)', () => {
    // C E G | G E (part of C; Em without its fifth would fit too) | E G B  ->  C for two beats, then Em
    const notes: N[] = [...block(0, Q, [60, 64, 67]), ...block(Q, Q, [55, 64]), ...block(Q * 2, Q * 2, [64, 67, 71])];
    expect(analyzeChords(open(conductor(), trackEvents(0, notes))).map((c) => [c.name, c.tick])).toEqual([
      ['C', 0],
      ['Em', Q * 2],
    ]);
    // a neighbour tone of the melody over a held chord (G A G over C) is not a chord change
    const pad = block(0, BAR, [48, 52, 55]);
    const mel: N[] = [
      [0, Q * 2, 79],
      [Q * 2, Q, 81],
      [Q * 3, Q, 79],
    ];
    expect(names(analyzeChords(open(conductor(), trackEvents(0, pad), trackEvents(1, mel))))).toEqual(['C']);
    // a sixth played by the chord part for one beat is named, and C comes back after it
    const six: N[] = [...block(0, BAR, [48, 55]), [0, Q * 2, 64], [Q * 2, Q, 64], [Q * 2, Q, 69], [Q * 3, Q, 64]];
    expect(names(analyzeChords(open(conductor(), trackEvents(0, six))))).toEqual(['C', 'C6', 'C']);
  });

  it('U-CHD-09 beats follow 3/4 and time-signature changes', () => {
    const sig = new TimeSignatureMap(Q, [
      { tick: 0, numerator: 3, denominator: 4 },
      { tick: Q * 6, numerator: 6, denominator: 8 },
    ]);
    expect(beatBoundaries(sig, Q * 8)).toEqual([0, Q, Q * 2, Q * 3, Q * 4, Q * 5, Q * 6, Q * 6.5, Q * 7, Q * 7.5, Q * 8, Q * 8.5, Q * 9]);
    // waltz: chord changes on the bar line of 3/4
    const p = open([timeSig(0, 3, 2)], trackEvents(0, [...block(0, Q * 3, [60, 64, 67]), ...block(Q * 3, Q * 3, [53, 57, 60])]));
    expect(analyzeChords(p).map((c) => [c.name, c.tick])).toEqual([
      ['C', 0],
      ['F', Q * 3],
    ]);
  });

  it('U-CHD-10 spelling follows the key signature', () => {
    const bb = block(0, BAR, [58, 62, 65]);
    expect(names(analyzeChords(open(conductor([meta(0, 0x59, [0xfe, 0])]), trackEvents(0, bb))))).toEqual(['Bb']);
    const fs = block(0, BAR, [54, 58, 61]);
    expect(names(analyzeChords(open(conductor([meta(0, 0x59, [2, 0])]), trackEvents(0, fs))))).toEqual(['F#']);
    expect(chordName(10, 'maj', null, 0)).toBe('Bb');
    expect(chordName(10, 'maj', null, 3)).toBe('A#');
    expect(chordName(0, 'maj7', 4)).toBe('Cmaj7/E');
    // a sharp key spells borrowed chords with flats (bVII Bb, bIII Eb, bVI Eb in G major) and keeps
    // its own tones sharp (D# in E major); #1 / #4 stay sharp (C#m7(b5) in G, F#dim7 in F)
    expect(chordName(10, 'maj', null, 1)).toBe('Bb');
    expect(chordName(3, 'maj', null, 1)).toBe('Eb');
    expect(chordName(3, 'sus4', null, 4)).toBe('D#sus4');
    expect(chordName(1, 'm7b5', null, 1)).toBe('C#m7(b5)');
    expect(chordName(6, 'dim7', null, -1)).toBe('F#dim7');
    expect(chordName(0, 'maj', 10, 1)).toBe('C/Bb');
    // no key signature: the bass is spelled on the root's side
    expect(chordName(4, 'maj', 8)).toBe('E/G#');
    expect(chordName(3, 'maj', 10)).toBe('Eb/Bb');
    expect(chordName(0, '7', 10)).toBe('C7/Bb');
  });

  it('U-CHD-11 qualities: 7th, maj7, m7, sus4, dim, power chord', () => {
    const one = (p: number[]) => names(analyzeChords(open(conductor(), trackEvents(0, block(0, BAR, p)))))[0];
    expect(one([60, 64, 67, 70])).toBe('C7');
    expect(one([60, 64, 67, 71])).toBe('Cmaj7');
    expect(one([57, 60, 64, 67])).toBe('Am7');
    expect(one([62, 67, 69])).toBe('Dsus4');
    expect(one([59, 62, 65])).toBe('Bdim');
    expect(one([40, 47, 52])).toBe('E5');
  });

  it('U-CHD-13 an anticipated chord (struck an eighth / a sixteenth early and tied over) starts where it is struck', () => {
    const E8 = Q / 2;
    // C on beat 1, F struck on the "and" of 4 and held through bar 2; the bass changes on the bar line
    const pad: N[] = [...block(0, BAR - E8, [60, 64, 67]), ...block(BAR - E8, BAR + E8, [60, 65, 69])];
    const bass: N[] = [
      [0, BAR, 36],
      [BAR, BAR, 41],
    ];
    const s = analyzeChords(open(conductor(), trackEvents(0, pad), trackEvents(1, bass)));
    expect(s.map((c) => [c.name, c.tick, c.endTick])).toEqual([
      ['C', 0, BAR - E8],
      ['F', BAR - E8, BAR * 2],
    ]);
    // a sixteenth early, with the bass anticipating too: F/A (inversion) from there
    const S16 = Q / 4;
    const pad16: N[] = [...block(0, BAR - S16, [60, 64, 67]), ...block(BAR - S16, BAR + S16, [60, 65, 72])];
    const bass16: N[] = [
      [0, BAR - S16, 36],
      [BAR - S16, BAR + S16, 45],
    ];
    expect(analyzeChords(open(conductor(), trackEvents(0, pad16), trackEvents(1, bass16))).map((c) => [c.name, c.tick])).toEqual([
      ['C', 0],
      ['F/A', BAR - S16],
    ]);
  });

  it('U-CHD-14 a melody note tied over the bar line, or a short pickup, does not move the change', () => {
    const pad: N[] = [...block(0, BAR, [60, 64, 67]), ...block(BAR, BAR, [53, 57, 60])];
    const tie: N[] = [[BAR - Q / 2, Q, 81]]; // A5 struck on 4& and held into bar 2
    expect(analyzeChords(open(conductor(), trackEvents(0, pad), trackEvents(1, tie))).map((c) => [c.name, c.tick])).toEqual([
      ['C', 0],
      ['F', BAR],
    ]);
    // a melody pickup into the new chord (chord tones of F, but one line) does not move it either
    const pickup: N[] = [
      [BAR - Q / 2, Q / 4, 69],
      [BAR - Q / 4, Q / 4, 72],
    ];
    expect(analyzeChords(open(conductor(), trackEvents(0, pad), trackEvents(1, pickup))).map((c) => [c.name, c.tick])).toEqual([
      ['C', 0],
      ['F', BAR],
    ]);
  });

  it('U-CHD-15 short stabs anticipating the bar line (released before it) move the change to the stab', () => {
    // piano: eighth-note stabs, C on every beat of bar 1, then F on 4& and on beats 2-4 of bar 2
    // (nothing on beat 1: the classic push); the bass comes on the bar line
    const E8 = Q / 2;
    const stabs: N[] = [];
    for (let b = 0; b < 4; b++) stabs.push(...block(b * Q, E8 - 20, [60, 64, 67]));
    stabs.push(...block(BAR - E8, E8 - 20, [60, 65, 69]));
    for (let b = 1; b < 4; b++) stabs.push(...block(BAR + b * Q, E8 - 20, [60, 65, 69]));
    const bass: N[] = [
      [0, BAR, 36],
      [BAR, BAR, 41],
    ];
    const s = analyzeChords(open(conductor(), trackEvents(0, stabs), trackEvents(1, bass)));
    expect(s.map((c) => [c.name, c.tick])).toEqual([
      ['C', 0],
      ['F', BAR - E8],
    ]);
    // stabs a sixteenth early (16th on 4e&a) do the same
    const s16: N[] = [];
    for (let b = 0; b < 4; b++) s16.push(...block(b * Q, Q / 4, [60, 64, 67]));
    s16.push(...block(BAR - Q / 4, Q / 4, [60, 65, 69]), ...block(BAR + Q, Q / 4, [60, 65, 69]));
    expect(analyzeChords(open(conductor(), trackEvents(0, s16), trackEvents(1, bass))).map((c) => [c.name, c.tick])).toEqual([
      ['C', 0],
      ['F', BAR - Q / 4],
    ]);
  });

  it('U-CHD-16 beat 4 with the old chord on the beat and the new one on 4&: no half-beat chord in between', () => {
    // like VISION bar 35: piano stabs C on 1-4 and F on 4&; an arpeggio keeps playing C through
    // beat 4; the bass repeats C on 4& and moves on the bar line; a pad holds C for the whole bar
    const E8 = Q / 2;
    const S16 = Q / 4;
    const piano: N[] = [];
    for (let b = 0; b < 4; b++) piano.push(...block(b * Q, S16, [60, 64, 67]));
    piano.push(...block(BAR - E8, E8 + 60, [60, 65, 69]));
    for (let b = 1; b < 4; b++) piano.push(...block(BAR + b * Q, S16, [60, 65, 69]));
    const arp: N[] = [];
    for (let i = 0; i < 32; i++) arp.push([i * S16, S16, (i < 16 ? [72, 76, 79, 84] : [77, 81, 84, 89])[i % 4]]);
    const pad = block(0, BAR, [55, 64, 72]);
    const bass: N[] = [
      [0, E8, 36],
      [BAR - E8, S16, 48],
      [BAR - S16, S16, 48],
      [BAR, E8, 41],
    ];
    const s = analyzeChords(open(conductor(), trackEvents(0, piano), trackEvents(1, arp), trackEvents(2, pad), trackEvents(3, bass)));
    expect(s.map((c) => [c.name, c.tick])).toEqual([
      ['C', 0],
      ['F', BAR - E8],
    ]);
  });

  it('U-CHD-17 a tension over the bass root: G A B D over an E bass is Em7, not Gadd9', () => {
    // like VISION bar 24: the piano voicing has no E; the pad holds G B D; only the bass plays E
    const piano: N[] = [];
    for (let b = 0; b < 4; b++) piano.push(...block(b * Q, Q / 2, [62, 67, 69, 71]));
    const pad = block(0, BAR, [67, 71, 74]);
    const bass: N[] = [];
    for (let b = 0; b < 4; b++) bass.push([b * Q, Q / 2, 40], [b * Q + Q / 2, Q / 4, 52]);
    const s = analyzeChords(open(conductor(), trackEvents(0, [...block(0, Q, [64, 67, 71, 74])]), trackEvents(1, piano), trackEvents(2, pad), trackEvents(3, bass)));
    expect(names(s)).toEqual(['Em7']);
    // the 9th / 11th added to a held chord is the same chord (no Em7 -> Em7(11) flicker)
    expect(chordName(4, 'm11', null)).toBe('Em7(11)');
  });

  it('U-CHD-18 the chord part decides: a melody holding the third over a sus4 in the piano is sus4', () => {
    // like VISION bar 42-43: piano Ebsus4 pushed on 4& and held; melodies hold G (the third of Eb)
    const E8 = Q / 2;
    const piano: N[] = [...block(Q * 2, Q, [63, 67, 70]), ...block(BAR - E8, E8 + Q, [63, 68, 70]), ...block(BAR + Q, Q, [63, 68, 70]), ...block(BAR + Q * 2, Q, [63, 67, 70])];
    // four melody / counter-melody lines holding G across the push (as in VISION)
    const mels = [79, 67, 91, 79].map((p): N[] => [[Q * 3, Q * 2, p]]);
    const bass: N[] = [
      [Q * 2, Q * 2 - E8, 39],
      [BAR - E8, E8, 39],
      [BAR, BAR, 39],
    ];
    const s = analyzeChords(open(conductor(), trackEvents(0, piano), ...mels.map((m, i) => trackEvents(4 + i, m)), trackEvents(3, bass)));
    expect(s.map((c) => [c.name, c.tick])).toEqual([
      ['Eb', Q * 2],
      ['Ebsus4', BAR - E8],
      ['Eb', BAR + Q * 2],
    ]);
  });

  it('U-CHD-12 chordAt finds the segment at a tick (ends exclusive)', () => {
    const s = analyzeChords(open(conductor(), trackEvents(0, [...block(0, Q * 2, [60, 64, 67]), ...block(BAR, Q, [55, 59, 62])])));
    expect(chordAt(s, 0)?.name).toBe('C');
    expect(chordAt(s, Q * 2 - 1)?.name).toBe('C');
    expect(chordAt(s, Q * 2)).toBeNull();
    expect(chordAt(s, BAR)?.name).toBe('G');
    expect(chordAt(s, BAR * 10)).toBeNull();
    expect(chordAt([], 0)).toBeNull();
  });

  it('U-CHD-19 without a key signature the spelling follows the estimated key', () => {
    // E | G#m | A | B | E in E major: G#m, not Abm
    const eMajor: N[] = [...block(0, BAR, [64, 68, 71]), ...block(BAR, BAR, [56, 59, 63]), ...block(BAR * 2, BAR, [57, 61, 64]), ...block(BAR * 3, BAR, [59, 63, 66]), ...block(BAR * 4, BAR, [64, 68, 71])];
    expect(names(analyzeChords(open(conductor(), trackEvents(0, eMajor))))).toEqual(['E', 'G#m', 'A', 'B', 'E']);
    // Ab | Db | Eb | Fm in Ab major: Db, not C#
    const abMajor: N[] = [...block(0, BAR, [56, 60, 63]), ...block(BAR, BAR, [61, 65, 68]), ...block(BAR * 2, BAR, [63, 67, 70]), ...block(BAR * 3, BAR, [65, 68, 72])];
    expect(names(analyzeChords(open(conductor(), trackEvents(0, abMajor))))).toEqual(['Ab', 'Db', 'Eb', 'Fm']);
    // a key signature wins over the estimate
    expect(names(analyzeChords(open(conductor([meta(0, 0x59, [0xfd, 0])]), trackEvents(0, eMajor))))).toEqual(['E', 'Abm', 'A', 'B', 'E']);
    // the estimate itself: E major (four sharps); A minor is spelled like C major
    const notes = (n: N[]) => n.map(([tick, durationTicks, pitch]) => ({ note: { tick, durationTicks, pitch } }));
    expect(estimateKey(notes(eMajor))).toMatchObject({ tonic: 4, mode: 'major', sharpsFlats: 4 });
    const aMinor: N[] = [...block(0, BAR, [57, 60, 64]), ...block(BAR, BAR, [62, 65, 69]), ...block(BAR * 2, BAR, [64, 68, 71]), ...block(BAR * 3, BAR, [57, 60, 64])];
    expect(estimateKey(notes(aMinor))).toMatchObject({ tonic: 9, mode: 'minor', sharpsFlats: 0 });
    expect(estimateKey([])).toBeNull();
  });

  it('U-CHD-20 octave doublings are one voice: a bass or a melody played in octaves is not a chord part', () => {
    const notes = (n: N[]) => n.map(([tick, durationTicks, pitch]) => ({ tick, durationTicks, pitch }));
    const line = [36, 43, 39, 41];
    expect(trackRole(notes(line.flatMap((p, i): N[] => [[i * Q, Q, p], [i * Q, Q, p + 24]])))).toBe('bass');
    expect(trackRole(notes(line.flatMap((p, i): N[] => [[i * Q, Q, p + 36], [i * Q, Q, p + 48]])))).toBe('lead');
    expect(trackRole(notes([...block(0, BAR, [60, 64, 67]), ...block(BAR, BAR, [62, 65, 69])]))).toBe('chord');
  });

  it('U-CHD-21 a chord shorter than a beat between two others joins a neighbour (MEGA.MID)', () => {
    // C | Dm for half a beat, then G7 struck on the "and" of beat 1
    const halfDm: N[] = [...block(0, BAR, [60, 64, 67]), ...block(BAR, Q / 2, [62, 65, 69]), ...block(BAR + Q / 2, BAR - Q / 2, [55, 59, 62, 65])];
    const s = analyzeChords(open(conductor(), trackEvents(0, halfDm)));
    expect(names(s)).toEqual(['C', 'G7']);
    expect(s[1].tick).toBe(BAR);
    // C | Dm for half a beat | back to C: the Dm is flicker (bar 2 is struck, so C is named again there: U-CHD-24)
    const back: N[] = [...block(0, BAR, [60, 64, 67]), ...block(BAR, Q / 2, [62, 65, 69]), ...block(BAR + Q / 2, BAR - Q / 2, [60, 64, 67])];
    const sb = analyzeChords(open(conductor(), trackEvents(0, back)));
    expect(names(sb)).toEqual(['C', 'C']);
    expect(sb.map((x) => x.tick)).toEqual([0, BAR]);
  });

  it('U-CHD-22 a chord pushed on 3& goes on over a partial voicing of it on beat 4 (GROOVIN6 bar 21)', () => {
    // the notes of GROOVIN6 bars 20.4-22.1 (PPQ 48, scaled x10), bar 21 placed at bar 2
    const at = (t48: number, d48: number, pitch: number): N => [BAR + t48 * 10, d48 * 10, pitch];
    const clavi: N[] = [
      at(0, 21, 66), at(0, 21, 62), at(0, 21, 69), at(48, 14, 62), at(48, 27, 66), at(48, 26, 69), at(88, 4, 62), at(88, 7, 69), at(88, 8, 66),
      at(119, 24, 61), at(119, 25, 64), at(119, 23, 69), at(160, 26, 69), at(160, 15, 64), at(160, 8, 61), at(184, 7, 64),
      at(192, 21, 66), at(192, 21, 62), at(192, 21, 69),
    ];
    const bass: N[] = [at(-32, 33, 30), at(0, 13, 28), at(48, 21, 28), at(88, 10, 28), at(119, 21, 30), at(160, 32, 30), at(192, 13, 28)];
    const strings: N[] = [at(-48, 51, 79), at(0, 144, 78), at(191, 54, 79)];
    const guitar: N[] = [at(24, 13, 59), at(24, 13, 62), at(37, 11, 59), at(37, 11, 62), at(48, 2, 59), at(48, 2, 62), at(120, 10, 62), at(144, 48, 64)];
    const s = analyzeChords(open(conductor(), trackEvents(0, clavi), trackEvents(1, bass), trackEvents(3, strings), trackEvents(5, guitar)));
    expect(chordAt(s, BAR)?.name).toBe('Dadd9/E');
    expect(chordAt(s, BAR + 119 * 10)?.name).toBe('F#m7');
    expect(chordAt(s, BAR + 119 * 10)?.tick).toBe(BAR + 119 * 10);
    expect(chordAt(s, BAR + 170 * 10)?.name).toBe('F#m7');
  });

  it('U-CHD-23 notes played on a sound-effect program (121-128: seashore, bird...) are not harmony (SEASHORE)', () => {
    // channel 1 plays C E G on Seashore in bar 1, then on Nylon Guitar from bar 3 (program changes in
    // another track); a Bird on channel 2 sings F A over bar 3
    const ch1: N[] = [...block(0, BAR, [60, 64, 67]), ...block(BAR * 2, BAR, [60, 64, 67])];
    const programs: Ev[] = [program(0, 0, 122), program(0, 1, 123), program(BAR * 2, 0, 24)];
    const s = analyzeChords(open(conductor(), programs, trackEvents(0, ch1), trackEvents(1, block(BAR * 2, BAR, [65, 69, 72]).map(([t, d, p]): N => [t, d, p + 12]).slice(0, 2))));
    expect(names(s)).toEqual(['C']);
    expect(s[0].tick).toBe(BAR * 2);
  });

  it('U-CHD-24 the same chord struck again on a bar line is named again there (RMIND_GS bars 33 / 35)', () => {
    // the piano strikes Ebmaj7 in bars 1 and 2: Ebmaj7 | Ebmaj7; held over the bar line it stays one
    const piano: N[] = [...block(0, BAR, [51, 58, 62, 67]), ...block(BAR, BAR, [51, 58, 62, 67])];
    const s = analyzeChords(open(conductor(), trackEvents(0, piano)));
    expect(names(s)).toEqual(['Ebmaj7', 'Ebmaj7']);
    expect(s.map((x) => x.tick)).toEqual([0, BAR]);
    expect(names(analyzeChords(open(conductor(), trackEvents(0, block(0, BAR * 2, [51, 58, 62, 67])))))).toEqual(['Ebmaj7']);
    // Am7(b5) held by the piano; strings touch Eb on 4& and stop at the bar line; the piano strikes
    // Ebmaj7 on 1: the change is on the bar line
    const pad: N[] = [...block(0, BAR, [57, 60, 63, 67]), ...block(BAR, BAR, [51, 58, 62, 67])];
    const strings: N[] = block(3 * Q + Q / 2, Q / 2, [70, 74, 79]);
    const t = analyzeChords(open(conductor(), trackEvents(0, pad), trackEvents(1, strings)));
    expect(chordAt(t, BAR)?.tick).toBe(BAR);
    expect(chordAt(t, BAR)?.name).toBe('Ebmaj7');
    expect(chordAt(t, 3 * Q + Q / 2)?.name).not.toBe('Ebmaj7');
    // the same push held over the bar line (tied) is an anticipation: it starts on 4&
    const tied: N[] = block(3 * Q + Q / 2, Q, [70, 74, 75, 79]);
    const u = analyzeChords(open(conductor(), trackEvents(0, [...block(0, 3 * Q + Q / 2, [57, 60, 64]), ...block(BAR, BAR, [51, 58, 62, 67])]), trackEvents(1, tied)));
    expect(chordAt(u, BAR)?.tick).toBe(3 * Q + Q / 2);
  });

  it('U-CHD-25 no harmony, no chord: bass only, melody only, bass + melody (RMIND_GS bars 5-8)', () => {
    const riff: N[] = [[0, Q, 34], [Q, Q / 2, 41], [Q + Q / 2, Q / 2, 46], [2 * Q, Q, 39], [3 * Q, Q, 41], [BAR, Q, 34], [BAR + Q, Q, 38], [BAR + 2 * Q, Q, 41], [BAR + 3 * Q, Q, 46]];
    const melody: N[] = [[0, Q, 70], [Q, Q, 74], [2 * Q, Q, 77], [3 * Q, Q, 75], [BAR, 2 * Q, 74], [BAR + 2 * Q, 2 * Q, 72]];
    expect(analyzeChords(open(conductor(), trackEvents(1, riff)))).toEqual([]);
    expect(analyzeChords(open(conductor(), trackEvents(0, melody)))).toEqual([]);
    expect(analyzeChords(open(conductor(), trackEvents(0, melody), trackEvents(1, riff)))).toEqual([]);
    // the piano strikes Bb on beat 1 of bar 1 only: the chord holds over the bass and melody of that bar
    // and the next, then is dropped while only bass and melody go on
    const long: N[] = [0, 1, 2, 3].flatMap((b) => riff.map(([t, d, p]): N => [t + b * BAR * 2, d, p]));
    const s = analyzeChords(open(conductor(), trackEvents(0, block(0, Q / 2, [58, 62, 65])), trackEvents(1, long)));
    expect(names(s)).toEqual(['Bb']);
    expect(s[0].tick).toBe(0);
    expect(s[0].endTick).toBeLessThanOrEqual(BAR * 2);
    expect(s[0].endTick).toBeGreaterThanOrEqual(BAR);
  });

  it('U-CHD-26 channel 10 made a normal part by GS plays harmony; a bar-line strike played a little early still counts', () => {
    // GS "Use for Rhythm Part" = 0 (normal part) on channel 10 (part 10 is address block 0)
    const PART10_NORMAL = [0x41, 0x10, 0x42, 0x12, 0x40, 0x10, 0x15, 0x00, 0x1b, 0xf7];
    const triad = block(0, BAR, [60, 64, 67]);
    expect(analyzeChords(open(conductor(), trackEvents(9, triad)))).toEqual([]);
    expect(names(analyzeChords(open(conductor([sysex(0, GS_RESET), sysex(0, PART10_NORMAL)]), trackEvents(9, triad))))).toEqual(['C']);
    // the piano strikes Ebmaj7 again 20 ticks (< 1/8 beat) before bar 2: named again at the bar line
    const early: N[] = [...block(0, BAR - 20, [51, 58, 62, 67]), ...block(BAR - 20, BAR + 20, [51, 58, 62, 67])];
    const s = analyzeChords(open(conductor(), trackEvents(0, early)));
    expect(names(s)).toEqual(['Ebmaj7', 'Ebmaj7']);
    expect(s[1].tick).toBe(BAR);
  });
});
