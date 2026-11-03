// Kind conversion of list rows (ADR-066): "CC7" typed on a note row turns that event into a
// Control Change at the same tick, keeping its id / originOrder / channel. What can be carried
// over is carried (the 7-bit value, the pitch between note and poly pressure); the rest gets the
// same defaults as a freshly inserted event. Raw events are never converted (rule 3: bytes that
// could not be interpreted are kept verbatim).
import type { Command } from '../editing/history';
import { EditError, rewriteEvents, updateEvents, type NewEvent } from '../editing/operations';
import type { MidiEvent, MidiProject, MidiTrack } from '../model/types';
import { bytesToBase64 } from '../model/base64';
import { eventDefaults } from './listInsert';
import type { NameInput } from './listName';
import { t } from '../../i18n';

export type ConvertTarget =
  | { kind: 'note'; pitch?: number }
  | { kind: 'cc'; controller?: number }
  | { kind: 'program'; program?: number }
  | { kind: 'pitch-bend' }
  | { kind: 'channel-pressure' }
  | { kind: 'poly-pressure'; pitch?: number }
  | { kind: 'sysex'; status: 'F0' | 'F7'; bytes: number[] }
  | { kind: 'meta'; metaType: number; bytes: number[] };

/** 7-bit value an event carries into another kind (velocity / value / pressure), or null. */
function carriedValue(e: MidiEvent): number | null {
  switch (e.kind) {
    case 'note':
      return e.velocity;
    case 'cc':
      return e.value;
    case 'channel-pressure':
    case 'poly-pressure':
      return e.pressure;
    default:
      return null;
  }
}

function carriedPitch(e: MidiEvent): number | null {
  return e.kind === 'note' || e.kind === 'poly-pressure' ? e.pitch : null;
}

/** New body for `e` converted to `target` (pure; see convertEventKind). */
export function convertedBody(project: MidiProject, track: MidiTrack, e: MidiEvent, target: ConvertTarget): NewEvent {
  if (e.kind === 'raw') throw new EditError(t('raw イベントは種類を変更できません（内容をそのまま保持します）。'));
  const ch = 'channelOverride' in e && e.channelOverride !== undefined ? { channelOverride: e.channelOverride } : {};
  const value = carriedValue(e);
  const pitch = carriedPitch(e);
  const d = eventDefaults(project, track, e.tick);
  switch (target.kind) {
    case 'note':
      return { kind: 'note', tick: e.tick, ...ch, pitch: target.pitch ?? pitch ?? d.pitch, velocity: Math.max(1, value ?? d.velocity), durationTicks: d.durationTicks, releaseVelocity: 64 };
    case 'cc': {
      const controller = target.controller ?? (e.kind === 'cc' ? e.controller : d.controller);
      return { kind: 'cc', tick: e.tick, ...ch, controller, value: e.kind === 'cc' && target.controller === undefined ? e.value : (value ?? d.ccValue(controller)) };
    }
    case 'program':
      return { kind: 'program', tick: e.tick, ...ch, program: target.program ?? (e.kind === 'program' ? e.program : d.program) };
    case 'pitch-bend':
      return { kind: 'pitch-bend', tick: e.tick, ...ch, value: e.kind === 'pitch-bend' ? e.value : 0 };
    case 'channel-pressure':
      return { kind: 'channel-pressure', tick: e.tick, ...ch, pressure: value ?? 64 };
    case 'poly-pressure':
      return { kind: 'poly-pressure', tick: e.tick, ...ch, pitch: target.pitch ?? pitch ?? d.pitch, pressure: value ?? 64 };
    case 'sysex':
      return { kind: 'sysex', tick: e.tick, status: target.status, dataBase64: bytesToBase64(target.bytes) };
    case 'meta':
      return { kind: 'meta', tick: e.tick, metaType: target.metaType, dataBase64: bytesToBase64(target.bytes) };
  }
}

/** Converts the rows (same ids) to another kind. Rows already of that kind are left alone. */
export function convertEventKinds(project: MidiProject, ids: Iterable<string>, target: ConvertTarget, label = '種類を変更'): Command | null {
  return rewriteEvents(project, ids, (e, track) => (e.kind === target.kind ? null : convertedBody(project, track, e, target)), label);
}

export function convertEventKind(project: MidiProject, id: string, target: ConvertTarget): Command | null {
  return convertEventKinds(project, [id], target);
}

/**
 * NOTE-column commit: the same kind edits the row's own field (pitch / controller / program);
 * another kind converts the event.
 */
export function applyNameInput(project: MidiProject, id: string, input: NameInput): Command | null {
  const e = project.tracks.flatMap((tr) => tr.events).find((x) => x.id === id);
  if (!e) throw new EditError('event not found');
  if (e.kind === input.kind) {
    switch (input.kind) {
      case 'note':
        return e.kind === 'note' && e.pitch === input.pitch ? null : updateEvents(project, [{ id, changes: { pitch: input.pitch } }], 'ノート番号を変更');
      case 'cc':
        return e.kind === 'cc' && e.controller === input.controller ? null : updateEvents(project, [{ id, changes: { controller: input.controller } }], 'コントローラー番号を変更');
      case 'program':
        return e.kind === 'program' && e.program === input.program ? null : updateEvents(project, [{ id, changes: { program: input.program } }], '音色を変更');
      case 'poly-pressure':
        return input.pitch === null || (e.kind === 'poly-pressure' && e.pitch === input.pitch) ? null : updateEvents(project, [{ id, changes: { pitch: input.pitch } }], 'ノート番号を変更');
      default:
        return null;
    }
  }
  const target: ConvertTarget = input.kind === 'poly-pressure' ? { kind: 'poly-pressure', ...(input.pitch === null ? {} : { pitch: input.pitch }) } : input;
  return convertEventKind(project, id, target);
}
