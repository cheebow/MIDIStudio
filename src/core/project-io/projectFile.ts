// `.midstudio` project file: versioned UTF-8 JSON (ARCHITECTURE I, REQ-PRJ-02).
// Parsing never mutates or replaces the caller's current project: it returns a result object and
// the caller decides (O04).
import { base64ToBytes } from '../model/base64';
import { isValidPort } from '../model/ports';
import { defaultInputPresets, defaultViewSettings } from '../model/defaults';
import type { HumanizeSettings, MidiProject, ProjectViewSettings, QuantizeSettings, RecordingSettings, TmSettings } from '../model/types';
import { SMF_LIMITS } from '../smf/types';
import { t } from '../../i18n';

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
  if (text.length > MAX_PROJECT_FILE_CHARS) return { ok: false, errors: [t('プロジェクトファイルが大きすぎます。')] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [t('JSON として読み込めません: {message}', { message: (e as Error).message })] };
  }
  if (!isObject(raw) || raw.format !== PROJECT_FILE_FORMAT) {
    return { ok: false, errors: [t('MIDI Studio のプロジェクトファイル（.midstudio）ではありません。')] };
  }
  let version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, errors: [t('schemaVersion が不正です。')] };
  if (version > CURRENT_SCHEMA_VERSION) {
    return { ok: false, errors: [t('このファイルは新しい版の MIDI Studio で保存されています（schema {version}）。この版では schema {current} までしか開けません。', { version, current: CURRENT_SCHEMA_VERSION })] };
  }
  const from = version;
  let env: Record<string, unknown> = raw;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { ok: false, errors: [t('schema {version} からの移行処理がありません。', { version })] };
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
  if (!isObject(p)) return [t('project がありません。')];
  if (p.schemaVersion !== 1) err(t('project.schemaVersion が 1 ではありません。'));
  if (typeof p.id !== 'string' || p.id === '') err(t('project.id が不正です。'));
  if (typeof p.title !== 'string') err(t('project.title が不正です。'));
  if (!isInt(p.ppq, 1, 0x7fff)) err(t('PPQ が不正です（{ppq}）。', { ppq: String(p.ppq) }));
  if (!isInt(p.nextOriginOrder, 0, Number.MAX_SAFE_INTEGER)) err(t('nextOriginOrder が不正です。'));
  const ids = new Set<string>();
  const uniqueId = (id: unknown, where: string) => {
    if (typeof id !== 'string' || id === '') return err(t('{where}: id が不正です。', { where }));
    if (ids.has(id)) err(t('{where}: id "{id}" が重複しています。', { where, id }));
    ids.add(id);
  };
  const tickOk = (e: Record<string, unknown>, where: string) => {
    if (!isInt(e.tick, 0, MAX_TICK)) err(t('{where}: tick が不正です。', { where }));
    if (typeof e.originOrder !== 'number' || !Number.isSafeInteger(e.originOrder)) err(t('{where}: originOrder が不正です。', { where }));
  };
  const b64Ok = (v: unknown, where: string) => {
    if (typeof v !== 'string' || base64ToBytes(v) === null) err(t('{where}: Base64 データが不正です。', { where }));
  };

  if (!Array.isArray(p.conductor)) err(t('conductor が配列ではありません。'));
  else
    p.conductor.forEach((c, i) => {
      const w = `conductor[${i}]`;
      if (!isObject(c)) return err(t('{w}: オブジェクトではありません。', { w }));
      uniqueId(c.id, w);
      tickOk(c, w);
      switch (c.kind) {
        case 'tempo':
          if (!isInt(c.usPerQuarter, 1, 0xffffff)) err(t('{w}: テンポ値が不正です。', { w }));
          break;
        case 'time-signature':
          if (!isInt(c.numerator, 1, 255) || !isInt(c.denominator, 1, 128) || (c.denominator & (c.denominator - 1)) !== 0) err(t('{w}: 拍子が不正です。', { w }));
          break;
        case 'key-signature':
          if (!isInt(c.sharpsFlats, -7, 7) || typeof c.minor !== 'boolean') err(t('{w}: 調号が不正です。', { w }));
          break;
        case 'marker':
          if (typeof c.text !== 'string') err(t('{w}: マーカー文字列が不正です。', { w }));
          if (c.rawBase64 !== undefined) b64Ok(c.rawBase64, w);
          break;
        default:
          err(t('{w}: 未知の種類 "{kind}" です。', { w, kind: String(c.kind) }));
      }
    });

  if (!Array.isArray(p.conductorMeta)) err(t('conductorMeta が配列ではありません。'));
  else
    p.conductorMeta.forEach((m, i) => {
      const w = `conductorMeta[${i}]`;
      if (!isObject(m) || m.kind !== 'meta') return err(t('{w}: メタイベントではありません。', { w }));
      uniqueId(m.id, w);
      tickOk(m, w);
      if (!isInt(m.metaType, 0, 127)) err(t('{w}: metaType が不正です。', { w }));
      b64Ok(m.dataBase64, w);
    });

  const eventTrack = new Map<string, string>();
  if (!Array.isArray(p.tracks)) err(t('tracks が配列ではありません。'));
  else
    p.tracks.forEach((tr, ti) => {
      const w = `tracks[${ti}]`;
      if (!isObject(tr)) return err(t('{w}: オブジェクトではありません。', { w }));
      uniqueId(tr.id, w);
      if (typeof tr.name !== 'string') err(t('{w}: name が不正です。', { w }));
      if (typeof tr.color !== 'string') err(t('{w}: color が不正です。', { w }));
      if (!isValidPort(tr.port)) err(t('{w}: port が不正です。', { w }));
      if (!isInt(tr.channel, 0, 15)) err(t('{w}: channel が不正です（0..15）。', { w }));
      if (tr.displayMode !== 'melodic' && tr.displayMode !== 'drum') err(t('{w}: displayMode が不正です。', { w }));
      for (const k of ['mute', 'solo', 'recordArm'] as const) if (typeof tr[k] !== 'boolean') err(t('{w}: {k} が不正です。', { w, k }));
      if (tr.endOfTrackTick !== undefined && !isInt(tr.endOfTrackTick, 0, MAX_TICK)) err(t('{w}: endOfTrackTick が不正です。', { w }));
      if (!Array.isArray(tr.events)) return err(t('{w}: events が配列ではありません。', { w }));
      tr.events.forEach((e, ei) => {
        const we = `${w}.events[${ei}]`;
        if (!isObject(e)) return err(t('{we}: オブジェクトではありません。', { we }));
        uniqueId(e.id, we);
        if (typeof e.id === 'string') eventTrack.set(e.id, String(tr.id));
        tickOk(e, we);
        if (e.channelOverride !== undefined && !isInt(e.channelOverride, 0, 15)) err(t('{we}: channelOverride が不正です。', { we }));
        const d7 = (v: unknown) => isInt(v, 0, 127);
        switch (e.kind) {
          case 'note':
            if (!d7(e.pitch) || !isInt(e.velocity, 1, 127) || !d7(e.releaseVelocity) || !isInt(e.durationTicks, 1, MAX_TICK)) err(t('{we}: ノートの値が不正です。', { we }));
            if (e.releaseOrder !== undefined && !Number.isSafeInteger(e.releaseOrder)) err(t('{we}: releaseOrder が不正です。', { we }));
            break;
          case 'cc':
            if (!d7(e.controller) || !d7(e.value)) err(t('{we}: CC の値が不正です。', { we }));
            break;
          case 'program':
            if (!d7(e.program)) err(t('{we}: Program の値が不正です。', { we }));
            break;
          case 'pitch-bend':
            if (!isInt(e.value, -8192, 8191)) err(t('{we}: Pitch Bend の値が不正です。', { we }));
            break;
          case 'channel-pressure':
            if (!d7(e.pressure)) err(t('{we}: Pressure の値が不正です。', { we }));
            break;
          case 'poly-pressure':
            if (!d7(e.pitch) || !d7(e.pressure)) err(t('{we}: Poly Pressure の値が不正です。', { we }));
            break;
          case 'sysex':
            if (e.status !== 'F0' && e.status !== 'F7') err(t('{we}: SysEx status が不正です。', { we }));
            b64Ok(e.dataBase64, we);
            break;
          case 'raw':
            b64Ok(e.rawBase64, we);
            if (typeof e.reason !== 'string') err(t('{we}: reason が不正です。', { we }));
            break;
          case 'meta':
            if (!isInt(e.metaType, 0, 127)) err(t('{we}: metaType が不正です。', { we }));
            b64Ok(e.dataBase64, we);
            break;
          default:
            err(t('{we}: 未知のイベント種類 "{kind}" です。', { we, kind: String(e.kind) }));
        }
      });
    });

  if (!Array.isArray(p.clips)) err(t('clips が配列ではありません。'));
  else {
    const trackIds = new Set(Array.isArray(p.tracks) ? p.tracks.map((t) => (isObject(t) ? t.id : null)) : []);
    p.clips.forEach((c, i) => {
      const w = `clips[${i}]`;
      if (!isObject(c)) return err(t('{w}: オブジェクトではありません。', { w }));
      uniqueId(c.id, w);
      if (!trackIds.has(c.trackId)) err(t('{w}: 存在しないトラックを参照しています。', { w }));
      if (!isInt(c.startTick, 0, MAX_TICK) || !isInt(c.endTick, 1, MAX_TICK) || (c.endTick as number) <= (c.startTick as number)) err(t('{w}: 範囲が不正です。', { w }));
      if (!Array.isArray(c.eventIds)) return err(t('{w}: eventIds が配列ではありません。', { w }));
      for (const id of c.eventIds) if (eventTrack.get(id as string) !== c.trackId) err(t('{w}: 同じトラックに存在しないイベント "{id}" を参照しています。', { w, id: String(id) }));
    });
  }

  if (!isObject(p.loop) || typeof p.loop.enabled !== 'boolean' || !isInt(p.loop.startTick, 0, MAX_TICK) || !isInt(p.loop.endTick, 0, MAX_TICK)) err(t('loop が不正です。'));
  if (!isObject(p.settings)) err(t('settings がありません。'));
  if (!isObject(p.inputPresets)) err(t('inputPresets がありません。'));
  return errors;
}
