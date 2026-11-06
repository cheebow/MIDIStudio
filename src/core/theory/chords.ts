// Chord names estimated from the notes of the song (ADR-090). Display only: the result is derived
// from the project and never written back. Every beat is analysed on its own, then runs of the
// same chord are merged.
//
// Only what is heard counts: drum tracks, channel 10, GS rhythm parts, muted (or not soloed)
// tracks and loose notes are left out. Melody lines and riffs play many notes outside the chord,
// so their weight is lowered (single-line tracks above the bass), short notes count less (passing
// tones) and notes sounding at the start of the beat count more. The result is an estimate and can
// be wrong (inversions, tensions, sparse textures).
import type { MidiProject, MidiTrack, NoteEvent } from '../model/types';
import { gsRhythmChanges } from '../gs/gsProject';
import { looseNoteIds } from '../model/looseNotes';
import { TimeSignatureMap } from '../timing/timeSignatureMap';
import { NOTE_FLAT, NOTE_SHARP } from '../list/noteNames';
import { lastAtOrBefore } from '../visual/monitorData';

export type ChordQuality = 'maj' | 'm' | '5' | '7' | 'maj7' | 'm7' | 'dim' | 'aug' | 'sus4' | 'sus2' | 'm7b5' | 'dim7' | '6' | 'm6' | '7sus4' | 'add9' | '9' | 'm9' | 'maj9' | 'm11';

export interface ChordSegment {
  tick: number;
  endTick: number;
  /** pitch class of the root, 0 = C */
  root: number;
  quality: ChordQuality;
  /** pitch class of the bass when it is not the root (slash chord) */
  bass: number | null;
  name: string;
}

interface Template {
  quality: ChordQuality;
  suffix: string;
  intervals: number[];
  /** small penalty so plain triads win unless the extra tone is really there */
  cost: number;
  /** only when its root is in the bass (9th / 11th chords over the bass root) */
  bassRoot?: boolean;
}

// Order matters for exact ties (C6 = Am7 without a bass hint): the earlier one wins.
const TEMPLATES: Template[] = [
  { quality: 'maj', suffix: '', intervals: [0, 4, 7], cost: 0 },
  { quality: 'm', suffix: 'm', intervals: [0, 3, 7], cost: 0 },
  { quality: '7', suffix: '7', intervals: [0, 4, 7, 10], cost: 0.04 },
  { quality: 'm7', suffix: 'm7', intervals: [0, 3, 7, 10], cost: 0.04 },
  { quality: 'maj7', suffix: 'maj7', intervals: [0, 4, 7, 11], cost: 0.05 },
  { quality: '5', suffix: '5', intervals: [0, 7], cost: 0.02 },
  { quality: 'dim', suffix: 'dim', intervals: [0, 3, 6], cost: 0.03 },
  { quality: 'sus4', suffix: 'sus4', intervals: [0, 5, 7], cost: 0.04 },
  { quality: 'aug', suffix: 'aug', intervals: [0, 4, 8], cost: 0.05 },
  { quality: 'sus2', suffix: 'sus2', intervals: [0, 2, 7], cost: 0.05 },
  { quality: 'm7b5', suffix: 'm7(b5)', intervals: [0, 3, 6, 10], cost: 0.06 },
  { quality: 'dim7', suffix: 'dim7', intervals: [0, 3, 6, 9], cost: 0.07 },
  { quality: '7sus4', suffix: '7sus4', intervals: [0, 5, 7, 10], cost: 0.07 },
  { quality: '6', suffix: '6', intervals: [0, 4, 7, 9], cost: 0.08 },
  { quality: 'm6', suffix: 'm6', intervals: [0, 3, 7, 9], cost: 0.09 },
  { quality: 'add9', suffix: 'add9', intervals: [0, 2, 4, 7], cost: 0.1 },
  // tensions over a seventh chord: G A B D over an E bass is Em7(11), not Gadd9/E
  { quality: 'm11', suffix: 'm7(11)', intervals: [0, 3, 7, 10, 5], cost: 0.1, bassRoot: true },
  { quality: 'm9', suffix: 'm9', intervals: [0, 3, 7, 10, 2], cost: 0.1, bassRoot: true },
  { quality: '9', suffix: '9', intervals: [0, 4, 7, 10, 2], cost: 0.1, bassRoot: true },
  { quality: 'maj9', suffix: 'maj9', intervals: [0, 4, 7, 11, 2], cost: 0.1, bassRoot: true },
];

/** Tuning of the estimate (exported for the tests and the ADR). */
export const CHORD_TUNING = {
  /** weight of tones outside the chord, relative to tones inside */
  outside: 0.6,
  /** penalty for a chord tone that is missing (the fifth is often left out: smaller penalty) */
  missing: 0.15,
  missingFifth: 0.05,
  /** a tone counts as present from this share of the beat's weight */
  present: 0.08,
  /** bonus when the root is in the bass */
  bassRoot: 0.1,
  /** keep the previous chord unless the new best is better by this much */
  hysteresis: 0.05,
  /** ... or by this much when the new best only adds tones to it (C -> Cadd9 over a passing D) */
  extensionHysteresis: 0.15,
  /** below this score the beat keeps the previous chord (or shows none) */
  minScore: 0.25,
  /** a one-beat chord between two beats of the same chord is absorbed when it is not clearly better */
  islandMargin: 0.15,
  /** notes shorter than this share of the beat count less (passing tones) */
  shortNote: 0.25,
  shortWeight: 0.4,
  /** notes sounding at the start of the beat count more */
  onBeat: 1.5,
  /** role weights of tracks */
  chordTrack: 1.5,
  leadTrack: 0.5,
  midTrack: 0.7,
  /** the bass mostly tells the root / inversion; its passing notes should not colour the chord */
  bassTrack: 0.7,
  /** average simultaneous notes from which a track counts as a chord part */
  chordPolyphony: 1.8,
  /** median pitch below which a single-line track counts as the bass */
  bassMedian: 55,
  /** median pitch from which a single-line track counts as a melody / lead */
  leadMedian: 60,
  /**
   * Anticipation (syncopation): when notes struck before a beat and held across it make up this
   * share of what sounds at the beat, the chord starts where they were struck (an eighth early…).
   */
  anticipationShare: 0.5,
  /** ... and they must be held at least this share of the next beat (tied over) */
  anticipationHold: 0.25,
  /** a chord part striking a new voicing off the beat needs at least this many tones to split the beat */
  pushPitchClasses: 2,
  /** a chord between two others lasting less than this share of a beat is flicker and joins a neighbour */
  minChordBeats: 0.75,
};

export type Role = 'chord' | 'bass' | 'lead' | 'mid';

export interface Source {
  note: NoteEvent;
  weight: number;
  role: Role;
  track: string;
}

/** Tracks heard during playback (solo wins over mute), like the playback snapshot. */
function audible(project: MidiProject): Set<string> {
  const anySolo = project.tracks.some((t) => t.solo);
  return new Set(project.tracks.filter((t) => (anySolo ? t.solo : !t.mute)).map((t) => t.id));
}

/** GM / GS sound effects (programs 121-128: fret noise, breath, seashore, bird, telephone, helicopter, applause, gunshot). */
const SFX_PROGRAM_FROM = 120;

/** Program changes per port:channel over the whole song (any track may set a channel's program), by tick. */
function programTimeline(project: MidiProject): Map<string, { ticks: number[]; programs: number[] }> {
  const raw = new Map<string, { tick: number; program: number }[]>();
  for (const track of project.tracks) {
    for (const e of track.events) {
      if (e.kind !== 'program') continue;
      const key = `${track.port}:${e.channelOverride ?? track.channel}`;
      const list = raw.get(key) ?? [];
      list.push({ tick: e.tick, program: e.program });
      raw.set(key, list);
    }
  }
  const out = new Map<string, { ticks: number[]; programs: number[] }>();
  for (const [key, list] of raw) {
    list.sort((a, b) => a.tick - b.tick);
    out.set(key, { ticks: list.map((x) => x.tick), programs: list.map((x) => x.program) });
  }
  return out;
}

/**
 * Pitched notes of a track that are heard (no drum channel, no rhythm part, no loose note, no
 * sound effect: a seashore or a bird is not part of the harmony, ADR-090).
 */
/** GS rhythm-part settings per port:channel, in time order. */
type RhythmTimeline = Map<string, { ticks: number[]; values: number[] }>;
function rhythmTimeline(project: MidiProject): RhythmTimeline {
  const out: RhythmTimeline = new Map();
  for (const c of gsRhythmChanges(project)) {
    const tl = out.get(c.key) ?? { ticks: [], values: [] };
    tl.ticks.push(c.tick);
    tl.values.push(c.value);
    out.set(c.key, tl);
  }
  return out;
}

function pitchedNotes(project: MidiProject, track: MidiTrack, rhythm: RhythmTimeline, programs: ReturnType<typeof programTimeline>): NoteEvent[] {
  // the GS "Use for Rhythm Part" setting in effect at a tick (undefined: never set until then)
  const settingAt = (ch: number, tick: number) => {
    const tl = rhythm.get(`${track.port}:${ch}`);
    const i = tl ? lastAtOrBefore(tl.ticks, tick) : -1;
    return tl && i >= 0 ? tl.values[i] : undefined;
  };
  // drums: a rhythm part at that time, or channel 10 unless GS made it a normal part by then. A track
  // shown as drums plays drums unless GS made its channel a normal part.
  const drum = (ch: number, tick: number) => {
    const set = settingAt(ch, tick);
    return set !== undefined ? set > 0 : ch === 9 || track.displayMode === 'drum';
  };
  const loose = looseNoteIds(project, track);
  return track.events.filter((e): e is NoteEvent => {
    if (e.kind !== 'note' || loose.has(e.id)) return false;
    const ch = e.channelOverride ?? track.channel;
    const key = `${track.port}:${ch}`;
    if (drum(ch, e.tick)) return false;
    const timeline = programs.get(key);
    const i = timeline ? lastAtOrBefore(timeline.ticks, e.tick) : -1;
    return !(timeline && i >= 0 && timeline.programs[i] >= SFX_PROGRAM_FROM);
  });
}

type RoleNote = Pick<NoteEvent, 'tick' | 'durationTicks' | 'pitch'>;
/** The role of a track from its notes: chord part, bass, lead (melody / riff) or mid. Exported for tests. */
export function trackRole(notes: readonly RoleNote[]): Role {
  // average number of notes sounding while the track sounds at all. Octave doublings (a bass or a
  // melody played in octaves, C2 + C4) are one voice: per onset and pitch class, the lowest pitch for
  // the register and the longest length.
  const voices = new Map<string, RoleNote>();
  for (const n of notes) {
    const key = `${n.tick}:${n.pitch % 12}`;
    const had = voices.get(key);
    voices.set(key, had ? { tick: n.tick, pitch: Math.min(had.pitch, n.pitch), durationTicks: Math.max(had.durationTicks, n.durationTicks) } : n);
  }
  const sorted = [...voices.values()].sort((a, b) => a.tick - b.tick);
  let total = 0;
  let union = 0;
  let coverEnd = -Infinity;
  for (const n of sorted) {
    const end = n.tick + n.durationTicks;
    total += n.durationTicks;
    if (end > coverEnd) {
      union += end - Math.max(n.tick, coverEnd);
      coverEnd = end;
    }
  }
  const polyphony = union > 0 ? total / union : 1;
  if (polyphony >= CHORD_TUNING.chordPolyphony) return 'chord';
  const pitches = sorted.map((n) => n.pitch).sort((a, b) => a - b);
  const median = pitches[pitches.length >> 1];
  if (median < CHORD_TUNING.bassMedian) return 'bass';
  if (median >= CHORD_TUNING.leadMedian) return 'lead';
  return 'mid';
}

const ROLE_WEIGHT: Record<Role, number> = { chord: CHORD_TUNING.chordTrack, bass: CHORD_TUNING.bassTrack, lead: CHORD_TUNING.leadTrack, mid: CHORD_TUNING.midTrack };

/** Beat boundaries from tick 0 up to (and past) `end`, following time-signature changes. */
export function beatBoundaries(sig: TimeSignatureMap, end: number): number[] {
  const out: number[] = [];
  for (let bar = 1; bar < 100000; bar++) {
    const num = sig.signatureAt(sig.barBeatToTick(bar)).numerator;
    const next = sig.barBeatToTick(bar + 1);
    for (let b = 1; b <= num; b++) {
      const t = Math.round(sig.barBeatToTick(bar, b));
      if (t >= next) break; // bar cut short by a time-signature change
      if (out.length === 0 || t > out[out.length - 1]) out.push(t);
    }
    if (next >= end) {
      out.push(Math.round(next));
      break;
    }
  }
  return out;
}

/**
 * Beat boundaries moved back to where an anticipated chord is struck (ADR-090 追記): notes struck
 * inside the previous beat and held across the boundary, weighing at least `anticipationShare` of
 * what sounds at the boundary, move it to their (most weighty) onset. A melody note tied over the
 * bar line alone weighs too little to move it.
 */
export function anticipatedBounds(bounds: readonly number[], sources: readonly { note: NoteEvent; weight: number }[]): number[] {
  const n = bounds.length;
  const atBound = new Array<number>(n).fill(0);
  const early: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (const s of sources) {
    const { tick, durationTicks } = s.note;
    const end = tick + durationTicks;
    for (let j = Math.max(1, lastAtOrBefore(bounds, tick)); j < n - 1 && bounds[j] < end; j++) {
      if (bounds[j] < tick) continue;
      atBound[j] += s.weight;
      const held = end - bounds[j] >= (bounds[j + 1] - bounds[j]) * CHORD_TUNING.anticipationHold;
      if (tick > bounds[j - 1] && tick < bounds[j] && held) early[j].set(tick, (early[j].get(tick) ?? 0) + s.weight);
    }
  }
  const out = [...bounds];
  for (let j = 1; j < n - 1; j++) {
    let sum = 0;
    let best = -1;
    let bestW = 0;
    for (const [t, w] of early[j]) {
      sum += w;
      if (w > bestW) [best, bestW] = [t, w];
    }
    if (best >= 0 && sum >= atBound[j] * CHORD_TUNING.anticipationShare) out[j] = best;
  }
  return out;
}

const fits = (c: Scored, pc: number) => c.t.intervals.includes((pc - c.root + 12) % 12);
const same = (a: Scored, b: Scored) => a.root === b.root && a.t.quality === b.t.quality;

/**
 * Off-beat onsets where a chord part strikes a new voicing (ADR-090 追記): "the and of 4" stabs,
 * pushes, passing chords. The beat is split there before it is judged, so the old chord on the beat
 * and the new one on the off-beat are not mixed into one (C + F judged as Fmaj9/C). Only the chord
 * parts are looked at: arpeggios and melodies often keep playing the old chord past a push, and a
 * repeat of the same voicing is not a change. Returns the pitch classes struck at each point.
 */
export function pushPoints(bounds: readonly number[], sources: readonly Source[]): Map<number, number[][]> {
  const beatLenAt = (t: number) => {
    const k = lastAtOrBefore(bounds, t);
    return k >= 0 && k + 1 < bounds.length ? bounds[k + 1] - bounds[k] : Infinity;
  };
  const byTrack = new Map<string, Map<number, Set<number>>>();
  for (const s of sources) {
    if (s.role !== 'chord') continue;
    // a grace-like blip (shorter than a 1/8 beat) is not part of the voicing
    if (s.note.durationTicks < beatLenAt(s.note.tick) / 8) continue;
    const strikes = byTrack.get(s.track) ?? new Map<number, Set<number>>();
    byTrack.set(s.track, strikes);
    const pcs = strikes.get(s.note.tick) ?? new Set<number>();
    strikes.set(s.note.tick, pcs);
    pcs.add(s.note.pitch % 12);
  }
  // each push keeps the voicing of every part struck there
  const out = new Map<number, number[][]>();
  for (const strikes of byTrack.values()) {
    let prevKey = '';
    for (const t of [...strikes.keys()].sort((a, b) => a - b)) {
      const pcs = [...strikes.get(t)!].sort((a, b) => a - b);
      const key = pcs.join(',');
      const onGrid = bounds[lastAtOrBefore(bounds, t)] === t;
      if (!onGrid && pcs.length >= CHORD_TUNING.pushPitchClasses && key !== prevKey) out.set(t, [...(out.get(t) ?? []), pcs]);
      prevKey = key;
    }
  }
  // parts struck a hair apart (humanized timing: brass on 4.49, piano on 4.50) are one push
  const merged = new Map<number, number[][]>();
  let last = -Infinity;
  for (const t of [...out.keys()].sort((a, b) => a - b)) {
    if (t - last < beatLenAt(t) / 8 && merged.has(last)) merged.get(last)!.push(...out.get(t)!);
    else {
      merged.set(t, [...out.get(t)!]);
      last = t;
    }
  }
  return merged;
}

interface Scored {
  root: number;
  t: Template;
  score: number;
}

function scoreAll(w: readonly number[], bassPc: number | null): Scored[] {
  const out: Scored[] = [];
  for (let root = 0; root < 12; root++) {
    for (const t of TEMPLATES) {
      if (t.bassRoot && bassPc !== root) continue;
      let inside = 0;
      let missing = 0;
      for (const iv of t.intervals) {
        const v = w[(root + iv) % 12];
        inside += v;
        if (v < CHORD_TUNING.present) missing += iv === 7 ? CHORD_TUNING.missingFifth : CHORD_TUNING.missing;
      }
      const score = inside - CHORD_TUNING.outside * (1 - inside) - missing - t.cost + (bassPc === root ? CHORD_TUNING.bassRoot : 0);
      out.push({ root, t, score });
    }
  }
  return out;
}

interface Beat {
  tick: number;
  endTick: number;
  scores: Scored[] | null;
  /** pitch classes with a noticeable share of the beat */
  present: number[];
  bassPc: number | null;
  /** the bass struck inside the segment (not held from before), for an anticipated chord */
  freshBassPc: number | null;
  /** takes the bass of the next segment (an anticipated chord without its own bass) */
  bassFromNext: boolean;
  /** a part of a beat (cut by a push): a tone fading out there does not change the chord */
  partial: boolean;
  chosen: Scored | null;
}

function scoreOf(scores: readonly Scored[], root: number, quality: ChordQuality): number {
  return scores.find((s) => s.root === root && s.t.quality === quality)?.score ?? -Infinity;
}

/**
 * Root / bass spelling in a key (sharps > 0, flats < 0): a tone of the key's scale as the key writes
 * it (D# in E major, Eb in Bb major); a black key outside the scale as the usual borrowed / chromatic
 * chords are written, from the major tonic: b3, b6, b7 flat (Bb and Eb in G major: bVII, bIII), #1
 * and #4 sharp (C#m7(b5) in G major). In C major / A minor this is C# Eb F# Ab Bb.
 */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const FLAT_DEGREES = new Set([3, 8, 10]);
export function pcName(pc: number, sharpsFlats: number): string {
  const p = ((pc % 12) + 12) % 12;
  const tonic = (((sharpsFlats * 7) % 12) + 12) % 12;
  const degree = (p - tonic + 12) % 12;
  if (MAJOR_SCALE.includes(degree)) return (sharpsFlats < 0 ? NOTE_FLAT : NOTE_SHARP)[p];
  return (FLAT_DEGREES.has(degree) ? NOTE_FLAT : NOTE_SHARP)[p];
}

/** Every chord quality the analysis can name, in template order (ADR-091: the guitar-voicing dialog lists them). */
export const CHORD_QUALITIES: readonly ChordQuality[] = TEMPLATES.map((x) => x.quality);

/** The suffix written after the root for a quality ('' for major, 'm7(b5)' for m7b5...). */
export function chordSuffix(quality: ChordQuality): string {
  return TEMPLATES.find((x) => x.quality === quality)?.suffix ?? '';
}

/** Without a key the bass follows the root's side: E/G# (not E/Ab), Eb/Bb (not Eb/A#). */
const SHARP_SIDE_ROOTS = new Set([1, 2, 4, 6, 9, 11]); // C# D E F# A B
const FLAT_SIDE_ROOTS = new Set([3, 5, 8, 10]); // Eb F Ab Bb

export function chordName(root: number, quality: ChordQuality, bass: number | null, sharpsFlats = 0): string {
  const t = TEMPLATES.find((x) => x.quality === quality);
  const bassName = (pc: number) =>
    sharpsFlats !== 0 ? pcName(pc, sharpsFlats) : SHARP_SIDE_ROOTS.has(root) ? NOTE_SHARP[pc] : FLAT_SIDE_ROOTS.has(root) ? NOTE_FLAT[pc] : pcName(pc, 0);
  return `${pcName(root, sharpsFlats)}${t?.suffix ?? ''}${bass !== null && bass !== root ? `/${bassName(bass)}` : ''}`;
}

interface Candidate {
  pitch: number;
  tick: number;
  long: boolean;
  bassTrack: boolean;
  held: boolean;
}

/** Adds a note's share of [b0, b1) to the pitch-class weights and the bass candidates. */
function addNote(s: Source, b0: number, b1: number, weights: number[], lowest: Candidate[]): void {
  const n = s.note;
  const nEnd = n.tick + n.durationTicks;
  const len = b1 - b0;
  const overlap = Math.min(nEnd, b1) - Math.max(n.tick, b0);
  if (overlap <= 0) return;
  let w = s.weight * overlap;
  if (n.durationTicks < len * CHORD_TUNING.shortNote) w *= CHORD_TUNING.shortWeight;
  if (n.tick <= b0 && nEnd > b0) w *= CHORD_TUNING.onBeat;
  const pc = n.pitch % 12;
  weights[pc] += w;
  // accompaniment only (chord parts + bass), and chord parts only: see finishBeat
  if (s.role === 'chord' || s.role === 'bass') weights[12 + pc] += w;
  if (s.role === 'chord') weights[24 + pc] += w;
  lowest.push({ pitch: n.pitch, tick: n.tick, long: overlap >= len * CHORD_TUNING.shortNote, bassTrack: s.role === 'bass', held: n.tick < b0 });
}

/**
 * A segment from its weights: the tones present, the bass and the score of every chord. While a
 * chord part (piano, pad, brass section ...) plays two or more tones, the harmony is what the
 * accompaniment (chord parts + bass) plays: melodies, riffs and arpeggios are left out, so a held
 * melody G over a sus4 in the piano does not turn it into a major chord (ADR-090 追記).
 */
function finishBeat(tick: number, endTick: number, weights: readonly number[], lowest: readonly Candidate[], anticipated: boolean): Beat {
  const beat: Beat = { tick, endTick, scores: null, present: [], bassPc: null, freshBassPc: null, bassFromNext: false, partial: false, chosen: null };
  const chordPart = weights.slice(24, 36);
  const chordTotal = chordPart.reduce((a, b) => a + b, 0);
  const accompaniment = chordTotal > 0 && chordPart.filter((v) => v >= chordTotal * 0.1).length >= 2;
  const w = accompaniment ? weights.slice(12, 24) : weights.slice(0, 12);
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return beat;
  const norm = w.map((v) => v / total);
  beat.present = norm.flatMap((v, pc) => (v >= CHORD_TUNING.present ? [pc] : []));
  // a single sounding pitch class is not a chord (the bass is still noted for the naming)
  if (norm.filter((v) => v >= 0.1).length < 2) {
    beat.scores = [];
    return beat;
  }
  // on an anticipated chord the bass often comes on the beat: the bass note still held from the
  // previous chord is not its bass (F struck on 4& over a held C is F, not F/C)
  const lowestOf = (cands: readonly Candidate[]) => {
    const pool = cands.some((c) => c.bassTrack) ? cands.filter((c) => c.bassTrack) : cands.some((c) => c.long) ? cands.filter((c) => c.long) : cands;
    return Math.min(...pool.map((c) => c.pitch)) % 12;
  };
  // with a bass part, only a bass note struck here is a new bass (the low note of a chord stab is not)
  const fresh = lowest.filter((c) => !c.held && (c.bassTrack || !lowest.some((x) => x.bassTrack)));
  // the bass struck with the push (the first one), not a passing note later in the segment
  const first = fresh.length ? Math.min(...fresh.map((c) => c.tick)) : 0;
  beat.freshBassPc = fresh.length ? lowestOf(fresh.filter((c) => c.tick === first)) : null;
  // an anticipated segment without a bass of its own takes the bass of the next beat (bassFromNext)
  beat.bassFromNext = anticipated && beat.freshBassPc === null;
  beat.bassPc = anticipated ? beat.freshBassPc : lowestOf(lowest);
  beat.scores = scoreAll(norm, beat.bassPc);
  return beat;
}

/** The chord of a scored segment, keeping the previous chord while it still fits about as well (no flicker). */
function pick(beat: Beat, prev: Scored | null): Scored | null {
  if (!beat.scores?.length) return null;
  let best = beat.scores[0];
  for (const s of beat.scores) if (s.score > best.score) best = s;
  if (prev) {
    const keep = scoreOf(beat.scores, prev.root, prev.t.quality);
    const p = prev;
    // nothing heard contradicts the previous chord (a partial voicing of it): keep it, unless a
    // complete chord with fewer tones is heard (C6 -> C E G is C again)
    const top = best;
    const complete = !beat.partial && top.t.intervals.every((iv) => beat.present.includes((top.root + iv) % 12));
    // a 9th / 11th chord holds only over its root in the bass
    const held = !p.t.bassRoot || beat.bassPc === p.root;
    const within = held && !complete && beat.present.every((pc) => fits(p, pc));
    const extends_ = top.root === p.root && p.t.intervals.every((iv) => top.t.intervals.includes(iv));
    // only a 9th / 11th added on top (Em7 -> Em7(11), C -> Cadd9) is a colour of the same chord
    const tensionOnly = held && extends_ && top.t.intervals.every((iv) => p.t.intervals.includes(iv) || iv === 2 || iv === 5);
    const margin = extends_ ? CHORD_TUNING.extensionHysteresis : CHORD_TUNING.hysteresis;
    // a weak beat keeps the previous chord, but only one it can hold (a 9th / 11th chord whose root
    // left the bass, unscored here, is not kept)
    const canKeep = held && keep > -Infinity;
    if (canKeep && (within || tensionOnly || keep >= best.score - margin || best.score < CHORD_TUNING.minScore)) return { ...prev, score: keep };
  }
  return best.score < CHORD_TUNING.minScore ? null : best;
}

/** Krumhansl-Kessler key profiles (major / minor), index 0 = tonic. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/** Key signature (sharps > 0, flats < 0) of each major tonic: Db / Eb / Ab / Bb on the flat side, F# with six sharps. */
const MAJOR_SIGNATURE = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

export interface KeyEstimate {
  tonic: number;
  mode: 'major' | 'minor';
  sharpsFlats: number;
}

/**
 * The song's key from how long each pitch class sounds (Krumhansl-Schmuckler: correlation with
 * the key profiles). Only used for spelling when the song has no key signature. Null without notes.
 */
export function estimateKey(notes: readonly { note: Pick<NoteEvent, 'pitch' | 'durationTicks'>; weight?: number }[]): KeyEstimate | null {
  const hist = new Array<number>(12).fill(0);
  for (const { note, weight = 1 } of notes) hist[note.pitch % 12] += note.durationTicks * weight;
  if (hist.every((v) => v === 0)) return null;
  const corr = (profile: readonly number[], tonic: number) => {
    const xm = hist.reduce((a, b) => a + b, 0) / 12;
    const ym = profile.reduce((a, b) => a + b, 0) / 12;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 12; i++) {
      const x = hist[(tonic + i) % 12] - xm;
      const y = profile[i] - ym;
      num += x * y;
      dx += x * x;
      dy += y * y;
    }
    return dx === 0 ? 0 : num / Math.sqrt(dx * dy);
  };
  let best: KeyEstimate | null = null;
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    const major = corr(MAJOR_PROFILE, tonic);
    if (major > bestScore) {
      bestScore = major;
      best = { tonic, mode: 'major', sharpsFlats: MAJOR_SIGNATURE[tonic] };
    }
    const minor = corr(MINOR_PROFILE, tonic);
    if (minor > bestScore) {
      bestScore = minor;
      // a minor key is spelled like its relative major (C#m like E: four sharps)
      best = { tonic, mode: 'minor', sharpsFlats: MAJOR_SIGNATURE[(tonic + 3) % 12] };
    }
  }
  return best;
}

/** Estimated chords of the song, one segment per run of the same chord. Beats without notes have none. */
export function analyzeChords(project: MidiProject): ChordSegment[] {
  const rhythm = rhythmTimeline(project);
  const programs = programTimeline(project);
  const heard = audible(project);
  const sources: Source[] = [];
  for (const track of project.tracks) {
    if (!heard.has(track.id)) continue;
    const notes = pitchedNotes(project, track, rhythm, programs);
    if (notes.length === 0) continue;
    const role = trackRole(notes);
    for (const note of notes) sources.push({ note, weight: ROLE_WEIGHT[role] * (0.5 + note.velocity / 254), role, track: track.id });
  }
  if (sources.length === 0) return [];
  let end = 0;
  for (const s of sources) end = Math.max(end, s.note.tick + s.note.durationTicks);
  const sig = new TimeSignatureMap(
    project.ppq,
    project.conductor.filter((c) => c.kind === 'time-signature'),
  );
  const beatBounds = beatBoundaries(sig, end);
  // bar lines where a chord part strikes a chord again (2+ tones within 1/8 beat of the bar line): the
  // same chord goes on, but the name is shown again there, like a chord chart (ADR-090 追記)
  const strikes: { bar: number; at: number }[] = [];
  {
    const struck = new Map<number, Set<number>>();
    const last = new Map<number, number>();
    for (let bar = 1; ; bar++) {
      const t = Math.round(sig.barBeatToTick(bar));
      if (t >= end) break;
      struck.set(t, new Set());
    }
    const barTicks = [...struck.keys()];
    for (const src of sources) {
      if (src.role !== 'chord') continue;
      const { tick, durationTicks } = src.note;
      // a strike within 1/8 beat of the bar line, on either side (a played part hits it a little early or late)
      const window = sig.ticksPerBar(tick) / sig.signatureAt(tick).numerator / 8;
      const i = lastAtOrBefore(barTicks, tick + window);
      if (i < 0 || Math.abs(tick - barTicks[i]) > window || durationTicks < window) continue;
      struck.get(barTicks[i])!.add(src.note.pitch % 12);
      // the last strike near the bar line (strings on the beat, the piano 4 ticks late: the chord is struck at 4)
      last.set(barTicks[i], Math.max(last.get(barTicks[i]) ?? tick, tick));
    }
    for (const [t, pcs] of struck) if (pcs.size >= CHORD_TUNING.pushPitchClasses) strikes.push({ bar: t, at: last.get(t)! });
  }
  const held = anticipatedBounds(beatBounds, sources);
  const pushes = pushPoints(held, sources);
  const bounds = [...new Set([...held, ...pushes.keys()])].sort((a, b) => a - b);
  const anticipated = new Set([...held.filter((b, i) => b !== beatBounds[i]), ...pushes.keys()]);
  const nBeats = bounds.length - 1;
  const weights = Array.from({ length: nBeats }, () => new Array<number>(36).fill(0));
  const lowest: Candidate[][] = Array.from({ length: nBeats }, () => []);
  for (const s of sources) {
    const n = s.note;
    const nEnd = n.tick + n.durationTicks;
    for (let i = Math.max(0, lastAtOrBefore(bounds, n.tick)); i < nBeats && bounds[i] < nEnd; i++) addNote(s, bounds[i], bounds[i + 1], weights[i], lowest[i]);
  }
  const beats: Beat[] = [];
  for (let i = 0; i < nBeats; i++) beats.push(finishBeat(bounds[i], bounds[i + 1], weights[i], lowest[i], anticipated.has(bounds[i])));
  const onGrid = new Set(beatBounds);
  for (const b of beats) b.partial = !onGrid.has(b.tick) || !onGrid.has(b.endTick);
  // a bass repeating the previous note on the push (C C | F) has not moved yet: the bass comes from the next beat
  const bassNotes = sources.filter((s) => s.role === 'bass').map((s) => s.note).sort((a, b) => a.tick - b.tick);
  const bassTicks = bassNotes.map((n) => n.tick);
  for (let i = 1; i < nBeats; i++) {
    const b = beats[i];
    const k = lastAtOrBefore(bassTicks, b.tick - 1);
    if (anticipated.has(b.tick) && b.freshBassPc !== null && k >= 0 && b.freshBassPc === bassNotes[k].pitch % 12) {
      b.freshBassPc = null;
      b.bassPc = null;
      b.bassFromNext = true;
    }
  }
  // choose, keeping the previous chord while it still fits about as well (no flicker)
  let prev: Scored | null = null;
  const undecided: number[] = []; // indices into beats
  for (const [bi, beat] of beats.entries()) {
    if (!beat.scores) {
      prev = null; // silence ends the chord
      continue;
    }
    if (beat.scores.length === 0) {
      // one pitch class: part of the previous chord, or decided after the loop (a bass note that
      // already belongs to the next chord: the chord was pushed and the beat itself is empty)
      const p = prev;
      if (p && beat.present.every((pc) => fits(p, pc))) beat.chosen = p;
      else undecided.push(bi);
      continue;
    }
    const best = pick(beat, prev);
    if (!best) continue;
    beat.chosen = best;
    // a push mixes the old and the new chord: the beat after it is judged against the chord
    // before the push (it is set to the anticipated chord below)
    if (!pushes.has(beat.tick)) prev = best;
  }
  for (const i of undecided) {
    const beat = beats[i];
    const before = beats[i - 1]?.endTick === beat.tick ? beats[i - 1].chosen : null;
    const after = beats[i + 1]?.tick === beat.endTick ? beats[i + 1].chosen : null;
    beat.chosen = after && beat.present.every((pc) => fits(after, pc)) ? after : before;
  }
  // absorb a one-beat chord between two beats of the same chord when it is not clearly better
  for (let i = 1; i + 1 < beats.length; i++) {
    const a = beats[i - 1].chosen;
    const b = beats[i].chosen;
    const c = beats[i + 1].chosen;
    if (!a || !b || !c || !beats[i].scores?.length) continue;
    if (a.root !== c.root || a.t.quality !== c.t.quality || (b.root === a.root && b.t.quality === a.t.quality)) continue;
    const there = scoreOf(beats[i].scores!, a.root, a.t.quality);
    if (b.score - there < CHORD_TUNING.islandMargin) beats[i].chosen = { ...a, score: there };
  }
  // a push striking a new chord (F#m7 on 3&) goes on into the beats after it while they only hold a
  // part of it and it fits them better than the chord before the push (E F# A over an F# bass after
  // the push is still F#m7, not back to Dadd9 just because those tones are also in Dadd9)
  for (let i = 1; i + 1 < beats.length; i++) {
    const seg = beats[i];
    const c = seg.chosen;
    const before = beats[i - 1].endTick === seg.tick ? beats[i - 1].chosen : null;
    if (!pushes.has(seg.tick) || !c || !before || same(c, before)) continue;
    for (let j = i + 1; j < beats.length && beats[j].tick === beats[j - 1].endTick; j++) {
      const b = beats[j];
      if (!b.chosen || !same(b.chosen, before) || !b.scores?.length || !b.present.every((pc) => fits(c, pc))) break;
      const there = scoreOf(b.scores, c.root, c.t.quality);
      if (there <= b.chosen.score) break;
      b.chosen = { ...c, score: there };
    }
  }
  // a push that strikes the next beat's chord (and leaves the chord before it) is that chord,
  // anticipated: it starts at the push even when the parts still holding the old chord outweigh it
  for (let i = beats.length - 2; i >= 1; i--) {
    const seg = beats[i];
    const voicings = pushes.get(seg.tick);
    const next = beats[i + 1];
    const n = next.chosen;
    if (!voicings || !n || next.tick !== seg.endTick || (seg.chosen && seg.chosen.root === n.root && seg.chosen.t.quality === n.t.quality)) continue;
    // parts striking a new voicing of the chord before (the brass still on Eb) are not pushing
    const before = beats[i - 1].endTick === seg.tick ? beats[i - 1].chosen : null;
    const moving = voicings.filter((pcs) => !before || !pcs.every((pc) => fits(before, pc)));
    // the parts that move strike the next chord's tones (one tension allowed: D G A B pushing Em7)
    const pushing = moving.length > 0 && moving.every((pcs) => pcs.filter((pc) => fits(n, pc) || next.present.includes(pc)).length >= Math.max(CHORD_TUNING.pushPitchClasses, pcs.length - 1));
    if (!pushing) continue;
    seg.chosen = n;
    // the bass of a push is the next beat's: a bass pickup (D# A# G# D# | C#) is not an inversion
    seg.bassPc = null;
    seg.bassFromNext = true;
  }
  // no harmony, no chord name (ADR-090 追記): only bass and drums, or only a melody, is not a chord.
  // A beat has harmony when, at some moment in it, 3+ pitch classes sound together (the parts
  // together) or one part sounds 2+ together (a power chord, a double stop), or when one part outlines
  // 3+ tones of the chord in it (an arpeggio; a bass line outlining the chord does not count). After the last harmony the chord is kept for up to a
  // bar (the piano struck on 1, only bass and melody on 2-4); further on, without harmony, it is dropped.
  {
    const beatTicks = beats.map((b) => b.tick);
    const inBeat: Source[][] = beats.map(() => []);
    for (const src of sources) {
      const end = src.note.tick + src.note.durationTicks;
      for (let i = Math.max(0, lastAtOrBefore(beatTicks, src.note.tick)); i < beats.length && beats[i].tick < end; i++) {
        if (beats[i].endTick > src.note.tick) inBeat[i].push(src);
      }
    }
    const hasHarmony = (beat: Beat, all: readonly Source[]): boolean => {
      const blip = (beat.endTick - beat.tick) / 8;
      const notes = all.filter((x) => x.note.durationTicks >= blip);
      // sweep the note starts and ends in time order (ends first at the same tick), counting the
      // pitch classes sounding (all parts) and per part (bass left out); check after each start
      const events: { t: number; d: 1 | -1; x: Source }[] = [];
      for (const x of notes) {
        events.push({ t: Math.max(x.note.tick, beat.tick), d: 1, x });
        events.push({ t: x.note.tick + x.note.durationTicks, d: -1, x });
      }
      events.sort((a, b) => a.t - b.t || a.d - b.d);
      const all12 = new Array<number>(12).fill(0);
      let distinct = 0;
      const part = new Map<string, number[]>();
      const partDistinct = new Map<string, number>();
      for (let k = 0; k < events.length; k++) {
        const { t, d, x } = events[k];
        if (t >= beat.endTick) break;
        const pc = x.note.pitch % 12;
        all12[pc] += d;
        if (d === 1 ? all12[pc] === 1 : all12[pc] === 0) distinct += d;
        if (x.role !== 'bass') {
          const counts = part.get(x.track) ?? new Array<number>(12).fill(0);
          part.set(x.track, counts);
          counts[pc] += d;
          if (d === 1 ? counts[pc] === 1 : counts[pc] === 0) partDistinct.set(x.track, (partDistinct.get(x.track) ?? 0) + d);
        }
        // check once all the events at this tick are in
        if (events[k + 1]?.t === t) continue;
        if (distinct >= 3 || [...partDistinct.values()].some((n) => n >= 2)) return true;
      }
      const c = beat.chosen;
      if (!c || c.t.intervals.length < 3) return false;
      const perTrack = new Map<string, Set<number>>();
      for (const x of notes) if (x.role !== 'bass') perTrack.set(x.track, (perTrack.get(x.track) ?? new Set()).add(x.note.pitch % 12));
      return [...perTrack.values()].some((pcs) => pcs.size >= 3 && [...pcs].every((pc) => fits(c, pc)));
    };
    let lastHarmony = -Infinity;
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      if (hasHarmony(beat, inBeat[i])) lastHarmony = beat.endTick;
      else if (!beat.scores) lastHarmony = -Infinity; // silence: the chord before is over
      else if (beat.chosen && beat.tick >= lastHarmony + sig.ticksPerBar(beat.tick) - 1) beat.chosen = null;
    }
  }
  // merge runs and name them. The bass of a run is the bass of its first beat: a walking bass under
  // one chord does not split it into C, C/E, C/G.
  const keys = project.conductor.filter((c) => c.kind === 'key-signature').sort((a, b) => a.tick - b.tick);
  const keyTicks = keys.map((k) => k.tick);
  // a song without a key signature (or only the C major many files carry by default) is spelled
  // in its estimated key: D#sus4 in E major, not Ebsus4
  const signed = keys.some((k) => k.sharpsFlats !== 0);
  const estimated = signed ? 0 : (estimateKey(sources)?.sharpsFlats ?? 0);
  const sharpsFlatsAt = (tick: number) => {
    if (!signed) return estimated;
    const i = lastAtOrBefore(keyTicks, tick);
    return i >= 0 ? keys[i].sharpsFlats : 0;
  };
  const out: (ChordSegment & { bassPending: boolean })[] = [];
  for (const beat of beats) {
    const c = beat.chosen;
    if (!c) continue;
    // slash chord only for a chord tone in the bass (an inversion); a passing bass note is not named
    const bass = beat.bassPc !== null && beat.bassPc !== c.root && c.t.intervals.includes((beat.bassPc - c.root + 12) % 12) ? beat.bassPc : null;
    const last = out[out.length - 1];
    if (last && last.endTick === beat.tick && last.root === c.root && last.quality === c.t.quality) {
      last.endTick = beat.endTick;
      if (last.bass === null && bass !== null && last.bassPending) {
        last.bass = bass;
        last.name = chordName(last.root, last.quality, bass, sharpsFlatsAt(last.tick));
      }
      last.bassPending = false;
      continue;
    }
    // an anticipated start without its own bass takes the bass of the next beat
    out.push({ tick: beat.tick, endTick: beat.endTick, root: c.root, quality: c.t.quality, bass, name: chordName(c.root, c.t.quality, bass, sharpsFlatsAt(beat.tick)), bassPending: (beat.bassFromNext || anticipated.has(beat.tick)) && bass === null });
  }
  // a chord shorter than a beat between two others is flicker (a stab or a bass pickup splitting the
  // beat): it joins the next chord when that one follows right away (the change came early), or else
  // the previous one keeps sounding over it
  const beatLen = (tick: number) => {
    const i = lastAtOrBefore(beatBounds, tick);
    return i >= 0 && i < beatBounds.length - 1 ? beatBounds[i + 1] - beatBounds[i] : project.ppq;
  };
  const kept: ChordSegment[] = [];
  for (let i = 0; i < out.length; i++) {
    const { tick, endTick, root, quality, bass, name } = out[i];
    const seg: ChordSegment = { tick, endTick, root, quality, bass, name };
    const next = out[i + 1];
    const last = kept[kept.length - 1];
    const short = seg.endTick - seg.tick < beatLen(seg.tick) * CHORD_TUNING.minChordBeats;
    const lastTouches = !!last && last.endTick === seg.tick;
    if (short && next && next.tick === seg.endTick && (lastTouches || next.endTick - next.tick >= beatLen(next.tick) * CHORD_TUNING.minChordBeats)) {
      next.tick = seg.tick;
      continue;
    }
    if (short && lastTouches) {
      last.endTick = seg.endTick;
      continue;
    }
    if (lastTouches && last.name === seg.name) {
      last.endTick = seg.endTick;
      continue;
    }
    kept.push(seg);
  }
  // a chord built up note by note (an arpeggio held to the end of the chord, a slow strum: F A, then
  // + C E) is one chord from its first note: F → Fmaj7 is Fmaj7, E5 → Em → Em7 is Em7 (ADR-093). A
  // segment goes into the chord after it when, within a bar,
  //   - every note sounding in it is a tone of that chord,
  //   - every one of them goes on sounding into it (notes are only added, none is let go: a line
  //     cliché C → Cmaj7 releases the C and stays two chords), and
  //   - nothing lower than its lowest note starts there (the bass stays: C → Am7 with a new A in the
  //     bass stays two chords).
  // A chord held for more than a bar before a tone is added (C for two bars, then + B) stays two, and
  // so does a colour over a chord that comes back (C → C6 → C).
  for (let i = kept.length - 2; i >= 0; i--) {
    const seg = kept[i];
    const next = kept[i + 1];
    if (next.tick !== seg.endTick || (next.root === seg.root && next.quality === seg.quality)) continue;
    if (next.tick - seg.tick >= sig.ticksPerBar(seg.tick)) continue;
    // C → C6 → C: a colour for a moment over a chord that comes back, not a chord being built up
    const after = kept[i + 2];
    if (after && after.tick === next.endTick && after.root === seg.root && after.quality === seg.quality) continue;
    const blip = beatLen(seg.tick) / 8;
    const inSeg = sources.filter((x) => x.note.tick < seg.endTick - blip && x.note.tick + x.note.durationTicks > seg.tick + blip);
    if (inSeg.length === 0) continue;
    const tones = TEMPLATES.find((x) => x.quality === next.quality)!.intervals.map((iv) => (next.root + iv) % 12);
    if (!inSeg.every((x) => tones.includes(x.note.pitch % 12))) continue;
    // still sounding after the boundary, or struck again right away (an up-and-down arpeggio repeats
    // a tone: that is not letting it go)
    const goesOn = (x: Source): boolean => {
      const end = x.note.tick + x.note.durationTicks;
      if (end >= next.tick + blip) return true;
      return sources.some((y) => y !== x && y.note.pitch === x.note.pitch && Math.abs(y.note.tick - end) <= blip && y.note.tick + y.note.durationTicks >= next.tick + blip);
    };
    if (!inSeg.every(goesOn)) continue;
    const low = Math.min(...inSeg.map((x) => x.note.pitch));
    if (sources.some((x) => x.note.tick >= next.tick && x.note.tick < next.endTick && x.note.pitch < low)) continue;
    next.tick = seg.tick;
    kept.splice(i, 1);
  }
  // a chord struck again by a chord part on a bar line is named again there (Ebmaj7 | Ebmaj7: the
  // chord chart of the bar). When it began less than about a beat before the bar line (strings
  // touching it on 4& and stopping at the bar line, the piano striking it on 1), the change is on the
  // bar line: the chord before goes on up to it. A chord part tied over the bar line (the piano struck
  // on 4& and held into the bar) is an anticipation and stays. The bass of the new name is the bass on
  // the bar line.
  const tiedOver = (from: number, bar: number) =>
    sources.some((x) => x.role === 'chord' && x.note.tick >= from && x.note.tick < bar && x.note.tick + x.note.durationTicks >= bar + beatLen(bar) / 8);
  const beatStarts = beats.map((b) => b.tick);
  const atBar = (seg: ChordSegment, bar: number): ChordSegment => {
    const bi = lastAtOrBefore(beatStarts, bar);
    const beat = bi >= 0 && bar < beats[bi].endTick ? beats[bi] : undefined;
    if (!beat) return { ...seg, tick: bar }; // no beat there: keep the name (never another beat's bass)
    const t = TEMPLATES.find((x) => x.quality === seg.quality)!;
    const bass = beat.bassPc !== null && beat.bassPc !== seg.root && t.intervals.includes((beat.bassPc - seg.root + 12) % 12) ? beat.bassPc : null;
    return { ...seg, tick: bar, bass, name: chordName(seg.root, seg.quality, bass, sharpsFlatsAt(bar)) };
  };
  for (const { bar, at } of strikes) {
    const k = kept.findIndex((x) => x.tick <= at && at < x.endTick);
    if (k < 0 || kept[k].tick >= bar) continue;
    const seg = kept[k];
    if (bar - seg.tick >= beatLen(bar) * CHORD_TUNING.minChordBeats) {
      kept.splice(k + 1, 0, atBar(seg, bar));
      seg.endTick = bar;
    } else if (k > 0 && kept[k - 1].endTick === seg.tick && !tiedOver(seg.tick, bar)) {
      kept[k - 1].endTick = bar;
      kept[k] = atBar(seg, bar);
    }
  }
  return kept;
}

/** The chord at a tick (segments sorted, not overlapping), or null. */
export function chordAt(segments: readonly ChordSegment[], tick: number): ChordSegment | null {
  const i = chordIndexAtOrBefore(segments, tick);
  return i >= 0 && tick < segments[i].endTick ? segments[i] : null;
}

/** Index of the last segment starting at or before `tick` (segments sorted), or -1. */
export function chordIndexAtOrBefore(segments: readonly ChordSegment[], tick: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].tick <= tick) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
