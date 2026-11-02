// MIDI Studio internal data model (ARCHITECTURE.md section C). Pure data, JSON-serializable.
// All time values are non-negative safe-integer absolute ticks; `ppq` belongs to the project.

export type Tick = number;
/** Port label used in the UI ("A".."D", then "E"...). The exported SMF port number is portIndex(label). */
export type PortId = string;
export type TrackId = string;
export type EventId = string;

interface EventBase {
  id: EventId;
  tick: Tick;
  /**
   * Stable ordering key among events of the same track at the same tick.
   * Imported events keep the SMF file order; new events get increasing values from
   * `MidiProject.nextOriginOrder` (DECISIONS ADR-014).
   */
  originOrder: number;
}

interface ChannelBase extends EventBase {
  /** 0..15. When set, overrides MidiTrack.channel (imported multi-channel tracks). */
  channelOverride?: number;
}

export interface NoteEvent extends ChannelBase {
  kind: 'note';
  pitch: number; // 0..127
  velocity: number; // 1..127
  durationTicks: number; // >= 1
  releaseVelocity: number; // 0..127
  /** How the Note Off was encoded in the source SMF (kept for faithful re-export). */
  sourceEncoding?: 'note-off' | 'note-on-zero';
  /**
   * File order of the imported Note Off. Present only while the note keeps its imported
   * onset/duration; edits that move the Note Off drop it (ADR-014).
   */
  releaseOrder?: number;
}

export interface CcEvent extends ChannelBase {
  kind: 'cc';
  controller: number; // 0..127
  value: number; // 0..127
}
export interface ProgramEvent extends ChannelBase {
  kind: 'program';
  program: number; // 0..127 (UI shows 1..128)
}
export interface PitchBendEvent extends ChannelBase {
  kind: 'pitch-bend';
  value: number; // -8192..8191
}
export interface ChannelPressureEvent extends ChannelBase {
  kind: 'channel-pressure';
  pressure: number; // 0..127
}
export interface PolyPressureEvent extends ChannelBase {
  kind: 'poly-pressure';
  pitch: number;
  pressure: number;
}
export type ChannelEvent = CcEvent | ProgramEvent | PitchBendEvent | ChannelPressureEvent | PolyPressureEvent;

export interface SysExEvent extends EventBase {
  kind: 'sysex';
  /** SMF event status. `F0`: data excludes the leading F0 byte (as stored in SMF). */
  status: 'F0' | 'F7';
  dataBase64: string;
}

/** A MIDI message kept verbatim because it could not be represented otherwise (never dropped). */
export interface RawMidiEvent extends EventBase {
  kind: 'raw';
  /** Complete message bytes including the status byte (channel messages) */
  rawBase64: string;
  reason: RawReason;
}
export type RawReason = 'unpaired-note-off' | 'unpaired-note-on' | 'zero-length-note' | 'other';

export interface TrackMetaEvent extends EventBase {
  kind: 'meta';
  metaType: number; // 0..127 (FF xx)
  dataBase64: string;
}

export type MidiEvent = NoteEvent | ChannelEvent | SysExEvent | RawMidiEvent | TrackMetaEvent;
export type MidiEventKind = MidiEvent['kind'];

export interface TempoEvent extends EventBase {
  kind: 'tempo';
  usPerQuarter: number; // integer 1..0xFFFFFF
}
export interface TimeSignatureEvent extends EventBase {
  kind: 'time-signature';
  numerator: number;
  denominator: number; // power of two
  /** SMF FF 58 bytes 3/4 (MIDI clocks per metronome click, 32nds per quarter); kept for export */
  clocksPerClick?: number;
  thirtySecondsPerQuarter?: number;
}
export interface KeySignatureEvent extends EventBase {
  kind: 'key-signature';
  sharpsFlats: number; // -7..7
  minor: boolean;
}
export interface MarkerEvent extends EventBase {
  kind: 'marker';
  text: string;
  /** original bytes when the text was not valid UTF-8 (exported verbatim) */
  rawBase64?: string;
}
export type ConductorEvent = TempoEvent | TimeSignatureEvent | KeySignatureEvent | MarkerEvent;

export type DisplayMode = 'melodic' | 'drum';

export interface MidiTrack {
  id: TrackId;
  name: string;
  color: string;
  port: PortId;
  channel: number; // 0..15 (UI shows 1..16)
  displayMode: DisplayMode;
  drumMapId?: string;
  mute: boolean;
  solo: boolean;
  recordArm: boolean;
  /** Mixer defaults are stored as MIDI events (CC7/CC10) in `events`; these are UI-only fields. */
  events: MidiEvent[];
  /** End of Track tick from the source SMF (keeps the song length on re-export). */
  endOfTrackTick?: Tick;
  /** Index of the MTrk this track came from (diagnostics). */
  sourceSmfTrack?: number;
  /** Whether the source track carried an explicit FF 21 port prefix (re-emitted even for port A). */
  hasPortPrefix?: boolean;
  /** Source bytes of the FF 03 track name when not UTF-8 (exported verbatim while `name` is unchanged). */
  sourceName?: SourceText;
}

export interface MidiClip {
  id: string;
  trackId: TrackId;
  startTick: Tick;
  endTick: Tick;
  /** Events grouped by this clip. Track.events is the only source of truth (ADR-005). */
  eventIds: EventId[];
  name?: string;
  color?: string;
}

export interface LoopRange {
  enabled: boolean;
  startTick: Tick;
  endTick: Tick;
}

export type ListDisplayUnit = 'native' | 'classic48';
export type EditorPanel = 'piano-roll' | 'drum' | 'list' | 'mixer' | 'tempo';

export interface ProjectViewSettings {
  selectedTrackId?: TrackId;
  activePanel: EditorPanel;
  listDisplayUnit: ListDisplayUnit;
  /** Snap in ticks (0 = off). Stored in ticks so it is exact for the project PPQ. */
  snapTicks: number;
  /** arrangement: pixels per quarter note */
  horizontalZoom: number;
  followPlayback: boolean;
  metronome: boolean;
  /** piano roll: pixels per quarter note */
  pianoRollZoom: number;
  /** piano roll: lowest visible pitch when last saved */
  pianoRollScrollPitch: number;
  /** controller lane under the piano roll: 'velocity', a CC number, or 'pitch-bend' */
  controllerLane: 'velocity' | 'pitch-bend' | number;
  showGhostNotes: boolean;
  /** grid used for snapping and new note length */
  grid: { division: number; kind: 'straight' | 'triplet' | 'dotted' };
  snapEnabled: boolean;
  /** TM monitor display preferences (REQ-PLAY-03) */
  tm: TmSettings;
  /** recording preferences (REQ-IN-04/05) */
  recording: RecordingSettings;
  /** last values of the quantize dialog (ADR-043); the Q key uses `grid` instead */
  quantize: QuantizeSettings;
  /** last values of the humanize dialog (ADR-050) */
  humanize: HumanizeSettings;
  /** layout: height of the bottom editor panel in px (null = automatic), collapsed state */
  editorHeight: number | null;
  editorCollapsed: boolean;
  /** controller lane under the piano roll / drum editor */
  laneHeight: number;
  laneCollapsed: boolean;
}

export interface RecordingSettings {
  mode: 'overdub' | 'replace';
  /** loop recording: keep every pass merged, or only the last pass */
  loopTakes: 'merge' | 'last';
  /** use the loop range as punch in/out */
  punch: boolean;
  countInBars: 0 | 1 | 2 | 4;
  /** selecting a track makes it the only record-armed track (ADR-040) */
  armFollowsSelection: boolean;
  /** quantize recorded note onsets to the current grid */
  quantize: boolean;
  latencyMs: number;
  /** step recording */
  stepTicks: number;
  gatePercent: number;
  drumAutoAdvance: boolean;
}

export interface QuantizeSettings {
  /** note value the onsets move to (independent of the editing grid) */
  grid: { division: number; kind: 'straight' | 'triplet' | 'dotted' };
  /** 0..100 %: how far each note moves towards its grid line */
  strength: number;
  /** shuffle 50..75 %: 50 = none, about 67 = triplet feel */
  swing: number;
  /** keep lengths, snap the note ends too, or round lengths to a multiple of the grid */
  lengths: 'keep' | 'ends' | 'grid';
}

export interface HumanizeSettings {
  /** onsets move by up to ± this many ticks */
  timingTicks: number;
  /** velocities move by up to ± this */
  velocity: number;
  /** lengths change by up to ± this percent */
  lengthPercent: number;
}

export interface TmSettings {
  /** visual-mode view: RCM-style list, all-tracks piano roll, or per-track keyboards */
  view?: 'list' | 'roll' | 'keys';
  layout: 'single' | 'columns-2' | 'rows-2' | 'quad';
  /** track per pane (null = selected track) */
  paneTracks: (string | null)[];
  mode: 'fixed-cursor' | 'page-turn' | 'smooth';
  theme: 'rcm' | 'retro-blue' | 'retro-green' | 'modern';
  fontSize: number;
  unit: 'native' | 'classic48';
}

/** Physical key (`KeyboardEvent.code`) -> MIDI pitch. */
export type KeyMap = Record<string, number>;

export interface SavedInputPresets {
  layout: 'jis' | 'us';
  pianoKeys: KeyMap;
  pianoOctaveShift: number;
  drumPadKeys: KeyMap;
  numpadKeys: KeyMap;
  defaultVelocity: number;
  accentVelocity: number;
}

export interface MidiProject {
  schemaVersion: 1;
  id: string;
  title: string;
  ppq: number;
  conductor: ConductorEvent[];
  /**
   * Non-conductor meta events of the SMF conductor track (track 0 of Format 1: copyright, text...).
   * Exported back into track 0 (ARCHITECTURE C: "Track Metaの未知情報は元のトラックへ保持").
   */
  conductorMeta: TrackMetaEvent[];
  tracks: MidiTrack[];
  clips: MidiClip[];
  loop: LoopRange;
  settings: ProjectViewSettings;
  inputPresets: SavedInputPresets;
  /** Next value for EventBase.originOrder of newly created events. */
  nextOriginOrder: number;
  /** End of Track tick of the source conductor track (keeps trailing silence on export). */
  conductorEndOfTrackTick?: Tick;
  /** Source bytes of the conductor track name when not UTF-8. */
  sourceTitle?: SourceText;
  /** User drum maps (labels / lane order / hidden lanes). Built-in GM / GS maps are not stored. */
  drumMaps?: import('../gm/drumMaps').DrumMap[];
  metadata?: Record<string, string>;
}

export const MIDI_CHANNELS = 16;

/** A decoded name plus its source bytes when they were not plain UTF-8 (re-exported verbatim while unchanged). */
export interface SourceText {
  text: string;
  base64: string;
}
