// Inserting events from the list (ADR-066): one event of any kind at the cursor tick with
// sensible defaults, common GS / GM sets (Bank + Program, RPN, NRPN), GS DT1 SysEx from the
// parameter table, and track-level meta events. Pure: everything returns a Command via addEvents.
import type { Command } from '../editing/history';
import { addEvents, EditError, rewriteEvents, type NewEvent } from '../editing/operations';
import { controllerAt, programAt } from '../editing/channelSetup';
import type { MidiProject, MidiTrack } from '../model/types';
import { bytesToBase64 } from '../model/base64';
import { decodeMetaText, encodeUtf8 } from '../model/text';
import { gridTicks } from '../timing/grid';
import { encodeGsDt1, gsResetPayload, partAddress, type GsParamDef } from '../gs/gsSysex';
import { t } from '../../i18n';

export type InsertKind = 'note' | 'cc' | 'program' | 'pitch-bend' | 'channel-pressure' | 'poly-pressure';
export type InsertSet = 'bank-program' | 'rpn-bend-range' | 'rpn-fine-tune' | 'rpn-coarse-tune' | 'nrpn' | 'gs-reset';
export const INSERT_SETS: readonly InsertSet[] = ['bank-program', 'rpn-bend-range', 'rpn-fine-tune', 'rpn-coarse-tune', 'nrpn', 'gs-reset'];

export interface InsertContext {
  tick: number;
  /** pitch of the current row (new notes start there) */
  pitchHint?: number | null;
}

/** Usual starting values for controllers that have one; others start at 0. */
const CC_DEFAULTS: Record<number, number> = { 0: 0, 1: 0, 7: 100, 10: 64, 11: 127, 32: 0, 64: 0, 91: 40, 93: 0 };

/** Defaults shared by insertion and kind conversion, taken from the track's state at the tick. */
export function eventDefaults(project: MidiProject, track: MidiTrack, tick: number) {
  const g = gridTicks(project.ppq, project.settings.grid);
  const before = [...track.events].filter((e) => e.kind === 'cc' && e.tick <= tick).sort((a, b) => a.tick - b.tick || a.originOrder - b.originOrder);
  const lastCc = before[before.length - 1];
  return {
    pitch: 60,
    velocity: project.inputPresets.defaultVelocity,
    durationTicks: g.den === 1 && g.num >= 1 ? g.num : project.ppq,
    controller: lastCc && lastCc.kind === 'cc' ? lastCc.controller : 7,
    ccValue: (controller: number) => controllerAt(track, controller, tick).event?.value ?? CC_DEFAULTS[controller] ?? 0,
    program: programAt(track, tick).event?.program ?? 0,
  };
}

/** A new event of `kind` at the tick with the track's current values as defaults. */
export function insertTemplate(project: MidiProject, track: MidiTrack, kind: InsertKind, ctx: InsertContext): NewEvent {
  const d = eventDefaults(project, track, ctx.tick);
  const pitch = ctx.pitchHint ?? d.pitch;
  switch (kind) {
    case 'note':
      return { kind: 'note', tick: ctx.tick, pitch, velocity: d.velocity, durationTicks: d.durationTicks, releaseVelocity: 64 };
    case 'cc':
      return { kind: 'cc', tick: ctx.tick, controller: d.controller, value: d.ccValue(d.controller) };
    case 'program':
      return { kind: 'program', tick: ctx.tick, program: d.program };
    case 'pitch-bend':
      return { kind: 'pitch-bend', tick: ctx.tick, value: 0 };
    case 'channel-pressure':
      return { kind: 'channel-pressure', tick: ctx.tick, pressure: 64 };
    case 'poly-pressure':
      return { kind: 'poly-pressure', tick: ctx.tick, pitch, pressure: 64 };
  }
}

const INSERT_LABEL: Record<InsertKind | 'sysex' | 'meta', string> = {
  note: 'ノートを挿入',
  cc: 'CC を挿入',
  program: 'プログラムチェンジを挿入',
  'pitch-bend': 'ピッチベンドを挿入',
  'channel-pressure': 'チャンネルプレッシャーを挿入',
  'poly-pressure': 'ポリプレッシャーを挿入',
  sysex: 'SysEx を挿入',
  meta: 'Meta を挿入',
};

/** Adds one event (joins the clip at that position like every other insertion, ADR-059). */
export function insertListEvent(project: MidiProject, trackId: string, ev: NewEvent): { command: Command; ids: string[] } | null {
  const label = INSERT_LABEL[ev.kind as keyof typeof INSERT_LABEL] ?? 'イベントを追加';
  return addEvents(project, trackId, [ev], { label });
}

/** The events of a set, in the order they must be sent (Bank -> Program; RPN MSB -> LSB -> Data). */
export function insertSetEvents(track: MidiTrack, set: InsertSet, ctx: InsertContext): NewEvent[] {
  const tick = ctx.tick;
  const cc = (controller: number, value: number): NewEvent => ({ kind: 'cc', tick, controller, value });
  switch (set) {
    case 'bank-program': {
      const p = programAt(track, tick);
      return [cc(0, p.msb ?? 0), cc(32, p.lsb ?? 0), { kind: 'program', tick, program: p.event?.program ?? 0 }];
    }
    case 'rpn-bend-range':
      return [cc(101, 0), cc(100, 0), cc(6, 2), cc(38, 0)];
    case 'rpn-fine-tune':
      return [cc(101, 0), cc(100, 1), cc(6, 64), cc(38, 0)];
    case 'rpn-coarse-tune':
      return [cc(101, 0), cc(100, 2), cc(6, 64), cc(38, 0)];
    case 'nrpn':
      return [cc(99, 1), cc(98, 8), cc(6, 64), cc(38, 0)];
    case 'gs-reset':
      return [{ kind: 'sysex', tick, status: 'F0', dataBase64: bytesToBase64(gsResetPayload()) }];
  }
}

const SET_LABEL: Record<InsertSet, string> = {
  'bank-program': 'バンクと音色を挿入',
  'rpn-bend-range': 'RPN ピッチベンドレンジを挿入',
  'rpn-fine-tune': 'RPN ファインチューンを挿入',
  'rpn-coarse-tune': 'RPN コースチューンを挿入',
  nrpn: 'NRPN を挿入',
  'gs-reset': 'GS Reset を挿入',
};

/** Inserts a whole set as one undo step; the ids come back in send order. */
export function insertSet(project: MidiProject, trackId: string, set: InsertSet, ctx: InsertContext): { command: Command; ids: string[] } | null {
  const track = project.tracks.find((x) => x.id === trackId);
  if (!track) throw new EditError('track not found');
  return addEvents(project, trackId, insertSetEvents(track, set, ctx), { label: SET_LABEL[set] });
}

/** GS DT1 SysEx for a parameter of the table (part parameters take the MIDI channel 0..15). */
export function gsSysExTemplate(param: GsParamDef, value: number, tick: number, channel?: number, deviceId = 0x10): NewEvent {
  if (!Number.isInteger(value) || value < param.min || value > param.max) throw new EditError(t('{name} の範囲は {min}〜{max} です。', { name: param.name, min: param.min, max: param.max }));
  const address = param.category === 'part' ? partAddress(param.address[2], channel ?? 0) : param.address;
  return { kind: 'sysex', tick, status: 'F0', dataBase64: bytesToBase64(encodeGsDt1(address, [value], deviceId)) };
}

/** Meta types that belong to the conductor (tempo / time / key signature / marker) or are structural (End of Track): never track rows. */
export const RESERVED_META = new Set([0x2f, 0x51, 0x58, 0x59, 0x06]);

export function metaTemplate(metaType: number, bytes: number[], tick: number): NewEvent {
  assertMeta(metaType, bytes);
  return { kind: 'meta', tick, metaType, dataBase64: bytesToBase64(bytes) };
}

function assertMeta(metaType: number, bytes: number[]) {
  if (!Number.isInteger(metaType) || metaType < 0 || metaType > 127) throw new EditError(t('メタイベントの種類は 0〜127 です。'));
  if (RESERVED_META.has(metaType)) throw new EditError(t('テンポ・拍子・調号・マーカーはコンダクタートラックで編集します（リストには置けません）。'));
  if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 0xff)) throw new EditError(t('不正なバイトがあります。'));
}

export function textToMetaBytes(text: string): number[] {
  return Array.from(encodeUtf8(text));
}

/** UTF-8 text of a meta payload; null when the bytes are not valid UTF-8 (edit them as hex then). */
export function metaBytesToText(bytes: ArrayLike<number>): string | null {
  const r = decodeMetaText(Uint8Array.from(Array.from(bytes)));
  return r.exact ? r.text : null;
}

export function setMetaEvent(project: MidiProject, id: string, v: { metaType: number; bytes: number[] }): Command | null {
  assertMeta(v.metaType, v.bytes);
  const data = bytesToBase64(v.bytes);
  return rewriteEvents(project, [id], (e) => (e.kind === 'meta' && e.metaType === v.metaType && e.dataBase64 === data ? null : { kind: 'meta', tick: e.tick, metaType: v.metaType, dataBase64: data }), 'Meta を編集');
}

/** Same byte rules as setSysExPayload (gsProject.ts); also lets the status (F0 / F7) change. */
export function setSysExEvent(project: MidiProject, id: string, v: { status: 'F0' | 'F7'; bytes: number[] }): Command | null {
  if (v.bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 0xff)) throw new EditError(t('不正なバイトがあります。'));
  if (v.bytes.slice(0, -1).some((b) => b >= 0x80)) throw new EditError(t('SysEx の途中に 0x80 以上のバイトは置けません（最後の F7 を除く）。'));
  const data = bytesToBase64(v.bytes);
  return rewriteEvents(project, [id], (e) => (e.kind === 'sysex' && e.status === v.status && e.dataBase64 === data ? null : { kind: 'sysex', tick: e.tick, status: v.status, dataBase64: data }), 'SysEx を編集');
}
