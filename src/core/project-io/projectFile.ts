// `.midstudio` project file: versioned UTF-8 JSON (ARCHITECTURE I, REQ-PRJ-02).
// Parsing never mutates or replaces the caller's current project: it returns a result object and
// the caller decides (O04).
import { base64ToBytes } from '../model/base64';
import { isValidPort } from '../model/ports';
import { defaultInputPresets, defaultViewSettings } from '../model/defaults';
import type { HumanizeSettings, MidiProject, ProjectViewSettings, QuantizeSettings, RecordingSettings, TmSettings } from '../model/types';
import { SMF_LIMITS } from '../smf/types';

export const PROJECT_FILE_FORMAT = 'midi-studio-project';
export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_PROJECT_FILE_CHARS = 256 * 1024 * 1024;

export interface ProjectFileEnvelope {
  format: typeof PROJECT_FILE_FORMAT;
  schemaVersion: number;
  savedAt?: string;
  app?: string;
  project: MidiProject;
}

export function serializeProject(project: MidiProject, opts: { savedAt?: string; pretty?: boolean } = {}): string {
  const env: ProjectFileEnvelope = {
    format: PROJECT_FILE_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...(opts.savedAt ? { savedAt: opts.savedAt } : {}),
    app: 'MIDI Studio',
    project,
  };
  return JSON.stringify(env, null, opts.pretty ? 2 : undefined);
}

export type ProjectParseResult = { ok: true; project: MidiProject; migratedFrom?: number } | { ok: false; errors: string[] };

/**
 * Migration chain: MIGRATIONS[n] upgrades a raw schema-n envelope to schema n+1. Empty while only
 * schema 1 exists; new versions add a step here and a fixture test.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export function parseProjectFile(text: string): ProjectParseResult {
  if (text.length > MAX_PROJECT_FILE_CHARS) return { ok: false, errors: ['プロジェクトファイルが大きすぎます。'] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`JSON として読み込めません: ${(e as Error).message}`] };
  }
  if (!isObject(raw) || raw.format !== PROJECT_FILE_FORMAT) {
    return { ok: false, errors: ['MIDI Studio のプロジェクトファイル（.midstudio）ではありません。'] };
  }
  let version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, errors: ['schemaVersion が不正です。'] };
  if (version > CURRENT_SCHEMA_VERSION) {
    return { ok: false, errors: [`このファイルは新しい版の MIDI Studio で保存されています（schema ${version}）。この版では schema ${CURRENT_SCHEMA_VERSION} までしか開けません。`] };
  }
  const from = version;
  let env: Record<string, unknown> = raw;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { ok: false, errors: [`schema ${version} からの移行処理がありません。`] };
    env = step(env);
    version++;
  }
  const errors = validateProject(env.project);
  if (errors.length > 0) return { ok: false, errors };
  const loaded = env.project as MidiProject;
  // Settings and key maps gain fields over time; missing ones fall back to defaults.
  const project: MidiProject = {
    ...loaded,
    settings: sanitizeSettings(loaded.settings as unknown, defaultViewSettings(loaded.ppq), new Set(loaded.tracks.map((t) => t.id))),
    inputPresets: { ...defaultInputPresets(), ...loaded.inputPresets },
  };
  return { ok: true, project, ...(from !== CURRENT_SCHEMA_VERSION ? { migratedFrom: from } : {}) };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * View settings are not part of the song, so a bad value falls back to the default instead of
 * rejecting the file: a NaN zoom, a grid division of 0 or a selected track that no longer exists
 * would otherwise crash the editors later.
 */
function sanitizeSettings(raw: unknown, d: ProjectViewSettings, trackIds: ReadonlySet<string>): ProjectViewSettings {
  const r: Record<string, unknown> = isObject(raw) ? raw : {};
  const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  const gridOf = (v: unknown, fallback: ProjectViewSettings['grid']) => (isObject(v) && isInt(v.division, 1, 128) && ['straight', 'triplet', 'dotted'].includes(v.kind as string) ? { division: v.division as number, kind: v.kind as ProjectViewSettings['grid']['kind'] } : fallback);
  const grid = gridOf(r.grid, d.grid);
  const qRaw = isObject(r.quantize) ? r.quantize : {};
  const quantize: QuantizeSettings = {
    grid: gridOf(qRaw.grid, d.quantize.grid),
    strength: num(qRaw.strength, 0, 100, d.quantize.strength),
    swing: num(qRaw.swing, 50, 75, d.quantize.swing),
    lengths: oneOf(qRaw.lengths, ['keep', 'ends', 'grid'] as const, d.quantize.lengths),
  };
  const hRaw = isObject(r.humanize) ? r.humanize : {};
  const humanize: HumanizeSettings = { timingTicks: num(hRaw.timingTicks, 0, 100000, d.humanize.timingTicks), velocity: num(hRaw.velocity, 0, 127, d.humanize.velocity), lengthPercent: num(hRaw.lengthPercent, 0, 100, d.humanize.lengthPercent) };
  const lane = r.controllerLane === 'velocity' || r.controllerLane === 'pitch-bend' || isInt(r.controllerLane, 0, 127) ? (r.controllerLane as ProjectViewSettings['controllerLane']) : d.controllerLane;
  const tmRaw = isObject(r.tm) ? r.tm : {};
  const pane = Array.isArray(tmRaw.paneTracks) ? tmRaw.paneTracks.slice(0, 4).map((id) => (typeof id === 'string' && trackIds.has(id) ? id : null)) : [];
  while (pane.length < 4) pane.push(null);
  const tm: TmSettings = {
    ...(tmRaw.view !== undefined ? { view: oneOf(tmRaw.view, ['list', 'roll', 'keys'] as const, 'list') } : {}),
    layout: oneOf(tmRaw.layout, ['single', 'columns-2', 'rows-2', 'quad'] as const, d.tm.layout),
    paneTracks: pane,
    mode: oneOf(tmRaw.mode, ['fixed-cursor', 'page-turn', 'smooth'] as const, d.tm.mode),
    theme: oneOf(tmRaw.theme, ['rcm', 'retro-blue', 'retro-green', 'modern'] as const, d.tm.theme),
    fontSize: num(tmRaw.fontSize, 8, 96, d.tm.fontSize),
    unit: oneOf(tmRaw.unit, ['native', 'classic48'] as const, d.tm.unit),
  };
  const recRaw = isObject(r.recording) ? r.recording : {};
  const recording: RecordingSettings = {
    mode: oneOf(recRaw.mode, ['overdub', 'replace'] as const, d.recording.mode),
    loopTakes: oneOf(recRaw.loopTakes, ['merge', 'last'] as const, d.recording.loopTakes),
    punch: bool(recRaw.punch, d.recording.punch),
    countInBars: ([0, 1, 2, 4] as const).includes(recRaw.countInBars as 0 | 1 | 2 | 4) ? (recRaw.countInBars as RecordingSettings['countInBars']) : d.recording.countInBars,
    armFollowsSelection: bool(recRaw.armFollowsSelection, d.recording.armFollowsSelection),
    quantize: bool(recRaw.quantize, d.recording.quantize),
    latencyMs: num(recRaw.latencyMs, -500, 500, d.recording.latencyMs),
    stepTicks: isInt(recRaw.stepTicks, 1, MAX_TICK) ? recRaw.stepTicks : d.recording.stepTicks,
    gatePercent: num(recRaw.gatePercent, 1, 100, d.recording.gatePercent),
    drumAutoAdvance: bool(recRaw.drumAutoAdvance, d.recording.drumAutoAdvance),
  };
  return {
    ...(typeof r.selectedTrackId === 'string' && trackIds.has(r.selectedTrackId) ? { selectedTrackId: r.selectedTrackId } : {}),
    activePanel: oneOf(r.activePanel, ['piano-roll', 'drum', 'list', 'mixer', 'tempo'] as const, d.activePanel),
    listDisplayUnit: oneOf(r.listDisplayUnit, ['native', 'classic48'] as const, d.listDisplayUnit),
    snapTicks: isInt(r.snapTicks, 0, MAX_TICK) ? r.snapTicks : d.snapTicks,
    horizontalZoom: num(r.horizontalZoom, 2, 400, d.horizontalZoom),
    followPlayback: bool(r.followPlayback, d.followPlayback),
    metronome: bool(r.metronome, d.metronome),
    pianoRollZoom: num(r.pianoRollZoom, 10, 800, d.pianoRollZoom),
    pianoRollScrollPitch: num(r.pianoRollScrollPitch, 0, 127, d.pianoRollScrollPitch),
    controllerLane: lane,
    showGhostNotes: bool(r.showGhostNotes, d.showGhostNotes),
    grid,
    snapEnabled: bool(r.snapEnabled, d.snapEnabled),
    tm,
    recording,
    quantize,
    humanize,
    editorHeight: typeof r.editorHeight === 'number' && Number.isFinite(r.editorHeight) && r.editorHeight >= 80 ? r.editorHeight : null,
    editorCollapsed: bool(r.editorCollapsed, d.editorCollapsed),
    laneHeight: num(r.laneHeight, 40, 320, d.laneHeight),
    laneCollapsed: bool(r.laneCollapsed, d.laneCollapsed),
  };
}

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const MAX_TICK = SMF_LIMITS.maxTick;

/** Structural validation of a project. Returns human-readable errors (at most 50). */
export function validateProject(p: unknown): string[] {
  const errors: string[] = [];
  const err = (m: string) => {
    if (errors.length < 50) errors.push(m);
  };
  if (!isObject(p)) return ['project がありません。'];
  if (p.schemaVersion !== 1) err('project.schemaVersion が 1 ではありません。');
  if (typeof p.id !== 'string' || p.id === '') err('project.id が不正です。');
  if (typeof p.title !== 'string') err('project.title が不正です。');
  if (!isInt(p.ppq, 1, 0x7fff)) err(`PPQ が不正です（${String(p.ppq)}）。`);
  if (!isInt(p.nextOriginOrder, 0, Number.MAX_SAFE_INTEGER)) err('nextOriginOrder が不正です。');
  const ids = new Set<string>();
  const uniqueId = (id: unknown, where: string) => {
    if (typeof id !== 'string' || id === '') return err(`${where}: id が不正です。`);
    if (ids.has(id)) err(`${where}: id "${id}" が重複しています。`);
    ids.add(id);
  };
  const tickOk = (e: Record<string, unknown>, where: string) => {
    if (!isInt(e.tick, 0, MAX_TICK)) err(`${where}: tick が不正です。`);
    if (typeof e.originOrder !== 'number' || !Number.isSafeInteger(e.originOrder)) err(`${where}: originOrder が不正です。`);
  };
  const b64Ok = (v: unknown, where: string) => {
    if (typeof v !== 'string' || base64ToBytes(v) === null) err(`${where}: Base64 データが不正です。`);
  };

  if (!Array.isArray(p.conductor)) err('conductor が配列ではありません。');
  else
    p.conductor.forEach((c, i) => {
      const w = `conductor[${i}]`;
      if (!isObject(c)) return err(`${w}: オブジェクトではありません。`);
      uniqueId(c.id, w);
      tickOk(c, w);
      switch (c.kind) {
        case 'tempo':
          if (!isInt(c.usPerQuarter, 1, 0xffffff)) err(`${w}: テンポ値が不正です。`);
          break;
        case 'time-signature':
          if (!isInt(c.numerator, 1, 255) || !isInt(c.denominator, 1, 128) || (c.denominator & (c.denominator - 1)) !== 0) err(`${w}: 拍子が不正です。`);
          break;
        case 'key-signature':
          if (!isInt(c.sharpsFlats, -7, 7) || typeof c.minor !== 'boolean') err(`${w}: 調号が不正です。`);
          break;
        case 'marker':
          if (typeof c.text !== 'string') err(`${w}: マーカー文字列が不正です。`);
          if (c.rawBase64 !== undefined) b64Ok(c.rawBase64, w);
          break;
        default:
          err(`${w}: 未知の種類 "${String(c.kind)}" です。`);
      }
    });

  if (!Array.isArray(p.conductorMeta)) err('conductorMeta が配列ではありません。');
  else
    p.conductorMeta.forEach((m, i) => {
      const w = `conductorMeta[${i}]`;
      if (!isObject(m) || m.kind !== 'meta') return err(`${w}: メタイベントではありません。`);
      uniqueId(m.id, w);
      tickOk(m, w);
      if (!isInt(m.metaType, 0, 127)) err(`${w}: metaType が不正です。`);
      b64Ok(m.dataBase64, w);
    });

  const eventTrack = new Map<string, string>();
  if (!Array.isArray(p.tracks)) err('tracks が配列ではありません。');
  else
    p.tracks.forEach((t, ti) => {
      const w = `tracks[${ti}]`;
      if (!isObject(t)) return err(`${w}: オブジェクトではありません。`);
      uniqueId(t.id, w);
      if (typeof t.name !== 'string') err(`${w}: name が不正です。`);
      if (typeof t.color !== 'string') err(`${w}: color が不正です。`);
      if (!isValidPort(t.port)) err(`${w}: port が不正です。`);
      if (!isInt(t.channel, 0, 15)) err(`${w}: channel が不正です（0..15）。`);
      if (t.displayMode !== 'melodic' && t.displayMode !== 'drum') err(`${w}: displayMode が不正です。`);
      for (const k of ['mute', 'solo', 'recordArm'] as const) if (typeof t[k] !== 'boolean') err(`${w}: ${k} が不正です。`);
      if (t.endOfTrackTick !== undefined && !isInt(t.endOfTrackTick, 0, MAX_TICK)) err(`${w}: endOfTrackTick が不正です。`);
      if (!Array.isArray(t.events)) return err(`${w}: events が配列ではありません。`);
      t.events.forEach((e, ei) => {
        const we = `${w}.events[${ei}]`;
        if (!isObject(e)) return err(`${we}: オブジェクトではありません。`);
        uniqueId(e.id, we);
        if (typeof e.id === 'string') eventTrack.set(e.id, String(t.id));
        tickOk(e, we);
        if (e.channelOverride !== undefined && !isInt(e.channelOverride, 0, 15)) err(`${we}: channelOverride が不正です。`);
        const d7 = (v: unknown) => isInt(v, 0, 127);
        switch (e.kind) {
          case 'note':
            if (!d7(e.pitch) || !isInt(e.velocity, 1, 127) || !d7(e.releaseVelocity) || !isInt(e.durationTicks, 1, MAX_TICK)) err(`${we}: ノートの値が不正です。`);
            if (e.releaseOrder !== undefined && !Number.isSafeInteger(e.releaseOrder)) err(`${we}: releaseOrder が不正です。`);
            break;
          case 'cc':
            if (!d7(e.controller) || !d7(e.value)) err(`${we}: CC の値が不正です。`);
            break;
          case 'program':
            if (!d7(e.program)) err(`${we}: Program の値が不正です。`);
            break;
          case 'pitch-bend':
            if (!isInt(e.value, -8192, 8191)) err(`${we}: Pitch Bend の値が不正です。`);
            break;
          case 'channel-pressure':
            if (!d7(e.pressure)) err(`${we}: Pressure の値が不正です。`);
            break;
          case 'poly-pressure':
            if (!d7(e.pitch) || !d7(e.pressure)) err(`${we}: Poly Pressure の値が不正です。`);
            break;
          case 'sysex':
            if (e.status !== 'F0' && e.status !== 'F7') err(`${we}: SysEx status が不正です。`);
            b64Ok(e.dataBase64, we);
            break;
          case 'raw':
            b64Ok(e.rawBase64, we);
            if (typeof e.reason !== 'string') err(`${we}: reason が不正です。`);
            break;
          case 'meta':
            if (!isInt(e.metaType, 0, 127)) err(`${we}: metaType が不正です。`);
            b64Ok(e.dataBase64, we);
            break;
          default:
            err(`${we}: 未知のイベント種類 "${String(e.kind)}" です。`);
        }
      });
    });

  if (!Array.isArray(p.clips)) err('clips が配列ではありません。');
  else {
    const trackIds = new Set(Array.isArray(p.tracks) ? p.tracks.map((t) => (isObject(t) ? t.id : null)) : []);
    p.clips.forEach((c, i) => {
      const w = `clips[${i}]`;
      if (!isObject(c)) return err(`${w}: オブジェクトではありません。`);
      uniqueId(c.id, w);
      if (!trackIds.has(c.trackId)) err(`${w}: 存在しないトラックを参照しています。`);
      if (!isInt(c.startTick, 0, MAX_TICK) || !isInt(c.endTick, 1, MAX_TICK) || (c.endTick as number) <= (c.startTick as number)) err(`${w}: 範囲が不正です。`);
      if (!Array.isArray(c.eventIds)) return err(`${w}: eventIds が配列ではありません。`);
      for (const id of c.eventIds) if (eventTrack.get(id as string) !== c.trackId) err(`${w}: 同じトラックに存在しないイベント "${String(id)}" を参照しています。`);
    });
  }

  if (!isObject(p.loop) || typeof p.loop.enabled !== 'boolean' || !isInt(p.loop.startTick, 0, MAX_TICK) || !isInt(p.loop.endTick, 0, MAX_TICK)) err('loop が不正です。');
  if (!isObject(p.settings)) err('settings がありません。');
  if (!isObject(p.inputPresets)) err('inputPresets がありません。');
  return errors;
}
