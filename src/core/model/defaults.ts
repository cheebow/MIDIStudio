import { newId } from './ids';
import type { MidiProject, MidiTrack, ProjectViewSettings, SavedInputPresets } from './types';
import { t } from '../../i18n';

export const DEFAULT_PPQ = 480;
export const DEFAULT_TEMPO_US = 500_000; // 120 BPM

export const TRACK_COLORS = ['#4f8ef7', '#f2994a', '#27ae60', '#eb5757', '#9b51e0', '#2d9cdb', '#f2c94c', '#6fcf97'];

export function defaultViewSettings(ppq: number): ProjectViewSettings {
  return {
    activePanel: 'piano-roll',
    listDisplayUnit: 'native',
    // 1/16 when exact; otherwise snap off rather than a silently rounded grid (ADR-002)
    snapTicks: ppq % 4 === 0 ? ppq / 4 : 0,
    horizontalZoom: 24,
    followPlayback: true,
    metronome: false,
    pianoRollZoom: 80,
    pianoRollScrollPitch: 48,
    controllerLane: 'velocity',
    showGhostNotes: true,
    grid: { division: 16, kind: 'straight' },
    snapEnabled: true,
    tm: { layout: 'single', paneTracks: [null, null, null, null], mode: 'fixed-cursor', theme: 'rcm', fontSize: 20, unit: 'classic48' },
    editorHeight: null,
    editorCollapsed: false,
    laneHeight: 72,
    laneCollapsed: false,
    recording: { mode: 'overdub', loopTakes: 'merge', punch: false, countInBars: 1, quantize: false, latencyMs: 0, stepTicks: ppq % 2 === 0 ? ppq / 2 : ppq, gatePercent: 90, drumAutoAdvance: false },
    quantize: { grid: { division: 16, kind: 'straight' }, strength: 100, swing: 50, lengths: 'keep' },
    humanize: { timingTicks: Math.max(1, Math.round(ppq / 32)), velocity: 10, lengthPercent: 10 },
    list: { enterMoves: 'down', captureAdvance: true, captureVelocity: false },
  };
}

/** INPUT_RECORDING.md section 2/3 defaults (physical `KeyboardEvent.code`). */
export function defaultInputPresets(): SavedInputPresets {
  return {
    layout: 'jis',
    pianoKeys: {
      KeyZ: 60, KeyS: 61, KeyX: 62, KeyD: 63, KeyC: 64, KeyV: 65, KeyG: 66, KeyB: 67, KeyH: 68, KeyN: 69, KeyJ: 70, KeyM: 71,
      Comma: 72, KeyQ: 72, Digit2: 73, KeyW: 74, Digit3: 75, KeyE: 76, KeyR: 77, Digit5: 78, KeyT: 79, Digit6: 80, KeyY: 81, Digit7: 82, KeyU: 83, KeyI: 84,
    },
    pianoOctaveShift: 0,
    drumPadKeys: { KeyU: 49, KeyI: 51, KeyO: 46, KeyJ: 45, KeyK: 47, KeyL: 50, KeyM: 36, Comma: 38, Period: 42 },
    numpadKeys: {
      Numpad7: 49, Numpad8: 51, Numpad9: 46, Numpad4: 45, Numpad5: 47, Numpad6: 50,
      Numpad1: 36, Numpad2: 38, Numpad3: 42, Numpad0: 36, NumpadDecimal: 42, NumpadEnter: 38,
    },
    defaultVelocity: 100,
    accentVelocity: 120,
  };
}

export function createTrack(partial: Partial<MidiTrack> & { name: string }, index = 0): MidiTrack {
  return {
    id: newId('trk'),
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    port: 'A',
    channel: 0,
    displayMode: 'melodic',
    mute: false,
    solo: false,
    events: [],
    ...partial,
  };
}

/**
 * @param opts.defaultProgram when set, the first track starts with this Program Change at tick 0
 *   (the app passes 0 = GM "Acoustic Grand Piano" so a new song can be played right away).
 */
export function createEmptyProject(opts: { title?: string; ppq?: number; defaultProgram?: number } = {}): MidiProject {
  const ppq = opts.ppq ?? DEFAULT_PPQ;
  return {
    schemaVersion: 1,
    id: newId('prj'),
    title: opts.title ?? t('無題'),
    ppq,
    conductor: [
      { id: newId('evt'), kind: 'tempo', tick: 0, usPerQuarter: DEFAULT_TEMPO_US, originOrder: 0 },
      { id: newId('evt'), kind: 'time-signature', tick: 0, numerator: 4, denominator: 4, originOrder: 1 },
    ],
    conductorMeta: [],
    tracks: [
      createTrack(
        {
          name: 'Track 1',
          events: opts.defaultProgram === undefined ? [] : [{ id: newId('evt'), kind: 'program', tick: 0, program: opts.defaultProgram, originOrder: 2 }],
        },
        0,
      ),
    ],
    clips: [],
    loop: { enabled: false, startTick: 0, endTick: ppq * 4 * 4 },
    settings: defaultViewSettings(ppq),
    inputPresets: defaultInputPresets(),
    nextOriginOrder: 3,
  };
}

/** Tracks of the song the app starts with: GM program per track, drums on channel 10 (ADR-046). */
export const STARTER_TRACKS: readonly { name: string; channel: number; program: number | null }[] = [
  { name: 'ピアノ', channel: 0, program: 0 }, // Acoustic Grand Piano
  { name: 'ベース', channel: 1, program: 33 }, // Electric Bass (finger)
  { name: 'ギター', channel: 2, program: 25 }, // Acoustic Guitar (steel)
  { name: 'ドラム', channel: 9, program: 0 }, // GM drum channel, Standard Kit
];

/** The song shown at the first start and by ファイル › 新規: piano, bass, guitar and drums, ready to play. */
export function createStarterProject(opts: { title?: string; ppq?: number } = {}): MidiProject {
  const p = createEmptyProject(opts);
  let order = p.nextOriginOrder;
  const tracks = STARTER_TRACKS.map((s, i) =>
    createTrack(
      {
        name: t(s.name),
        channel: s.channel,
        displayMode: s.channel === 9 ? 'drum' : 'melodic',
        events: s.program === null ? [] : [{ id: newId('evt'), kind: 'program', tick: 0, program: s.program, originOrder: order++ }],
      },
      i,
    ),
  );
  return { ...p, tracks, nextOriginOrder: order };
}
