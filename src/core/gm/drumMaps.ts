// Drum maps (REQ-EDT-06/07, MIDI_GS_SPEC 4). A map only provides labels, grouping, lane order and
// default velocities. Changing the map never changes Note.pitch (E09).

export interface DrumMapEntry {
  pitch: number;
  name: string;
  group: 'kick' | 'snare' | 'hihat' | 'cymbal' | 'tom' | 'percussion' | 'fx';
  defaultVelocity: number;
}

export interface DrumMap {
  id: string;
  name: string;
  /** lane order, top to bottom */
  entries: DrumMapEntry[];
  /** pitches hidden in the editor (still played and exported) */
  hidden?: number[];
  builtIn?: boolean;
}

const gm: [number, string, DrumMapEntry['group']][] = [
  [35, 'Acoustic Bass Drum', 'kick'], [36, 'Bass Drum 1', 'kick'], [37, 'Side Stick', 'snare'], [38, 'Acoustic Snare', 'snare'],
  [39, 'Hand Clap', 'percussion'], [40, 'Electric Snare', 'snare'], [41, 'Low Floor Tom', 'tom'], [42, 'Closed Hi-Hat', 'hihat'],
  [43, 'High Floor Tom', 'tom'], [44, 'Pedal Hi-Hat', 'hihat'], [45, 'Low Tom', 'tom'], [46, 'Open Hi-Hat', 'hihat'],
  [47, 'Low-Mid Tom', 'tom'], [48, 'Hi-Mid Tom', 'tom'], [49, 'Crash Cymbal 1', 'cymbal'], [50, 'High Tom', 'tom'],
  [51, 'Ride Cymbal 1', 'cymbal'], [52, 'Chinese Cymbal', 'cymbal'], [53, 'Ride Bell', 'cymbal'], [54, 'Tambourine', 'percussion'],
  [55, 'Splash Cymbal', 'cymbal'], [56, 'Cowbell', 'percussion'], [57, 'Crash Cymbal 2', 'cymbal'], [58, 'Vibraslap', 'percussion'],
  [59, 'Ride Cymbal 2', 'cymbal'], [60, 'Hi Bongo', 'percussion'], [61, 'Low Bongo', 'percussion'], [62, 'Mute Hi Conga', 'percussion'],
  [63, 'Open Hi Conga', 'percussion'], [64, 'Low Conga', 'percussion'], [65, 'High Timbale', 'percussion'], [66, 'Low Timbale', 'percussion'],
  [67, 'High Agogo', 'percussion'], [68, 'Low Agogo', 'percussion'], [69, 'Cabasa', 'percussion'], [70, 'Maracas', 'percussion'],
  [71, 'Short Whistle', 'percussion'], [72, 'Long Whistle', 'percussion'], [73, 'Short Guiro', 'percussion'], [74, 'Long Guiro', 'percussion'],
  [75, 'Claves', 'percussion'], [76, 'Hi Wood Block', 'percussion'], [77, 'Low Wood Block', 'percussion'], [78, 'Mute Cuica', 'percussion'],
  [79, 'Open Cuica', 'percussion'], [80, 'Mute Triangle', 'percussion'], [81, 'Open Triangle', 'percussion'],
];

/** GS Standard kit additions outside the GM range (names as commonly documented; sound depends on the SoundFont). */
const gsExtra: [number, string, DrumMapEntry['group']][] = [
  [27, 'High Q', 'fx'], [28, 'Slap', 'fx'], [29, 'Scratch Push', 'fx'], [30, 'Scratch Pull', 'fx'], [31, 'Sticks', 'percussion'],
  [32, 'Square Click', 'fx'], [33, 'Metronome Click', 'fx'], [34, 'Metronome Bell', 'fx'],
  [82, 'Shaker', 'percussion'], [83, 'Jingle Bell', 'percussion'], [84, 'Belltree', 'percussion'], [85, 'Castanets', 'percussion'],
  [86, 'Mute Surdo', 'percussion'], [87, 'Open Surdo', 'percussion'],
];

const velocityFor = (g: DrumMapEntry['group']) => (g === 'kick' || g === 'snare' ? 110 : g === 'hihat' ? 85 : 100);
const entry = ([pitch, name, group]: [number, string, DrumMapEntry['group']]): DrumMapEntry => ({ pitch, name, group, defaultVelocity: velocityFor(group) });

/** Kit order with the core kit on top (visible without scrolling): kick, snare, hi-hats, toms, cymbals, then the rest by pitch. */
const ORDER: DrumMapEntry['group'][] = ['kick', 'snare', 'hihat', 'tom', 'cymbal', 'percussion', 'fx'];
function kitOrder(entries: DrumMapEntry[]): DrumMapEntry[] {
  return [...entries].sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || a.pitch - b.pitch);
}

export const GM_DRUM_MAP: DrumMap = { id: 'gm', name: 'GM Standard', entries: kitOrder(gm.map(entry)), builtIn: true };
export const GS_DRUM_MAP: DrumMap = { id: 'gs', name: 'GS Standard', entries: kitOrder([...gsExtra, ...gm].map(entry)), builtIn: true };
export const BUILT_IN_DRUM_MAPS = [GM_DRUM_MAP, GS_DRUM_MAP];

export function findDrumMap(id: string | undefined, userMaps: readonly DrumMap[] = []): DrumMap {
  return [...BUILT_IN_DRUM_MAPS, ...userMaps].find((m) => m.id === id) ?? GM_DRUM_MAP;
}

/** Lanes to show: the map's visible entries plus any pitch used by the track that the map lacks. */
export function drumLanes(map: DrumMap, usedPitches: Iterable<number>, opts: { onlyUsed?: boolean } = {}): DrumMapEntry[] {
  const used = new Set(usedPitches);
  const hidden = new Set(map.hidden ?? []);
  const known = new Set(map.entries.map((e) => e.pitch));
  const extra = [...used].filter((p) => !known.has(p)).sort((a, b) => b - a).map((pitch): DrumMapEntry => ({ pitch, name: `Note ${pitch}`, group: 'percussion', defaultVelocity: 100 }));
  const lanes = [...map.entries.filter((e) => !hidden.has(e.pitch) || used.has(e.pitch)), ...extra];
  return opts.onlyUsed ? lanes.filter((e) => used.has(e.pitch)) : lanes;
}

export function drumName(map: DrumMap, pitch: number): string {
  return map.entries.find((e) => e.pitch === pitch)?.name ?? `Note ${pitch}`;
}
