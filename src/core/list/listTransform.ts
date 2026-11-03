// Batch changes over the selected list rows (ADR-066): position shift, gate time, channel, value,
// note number. Rows of other kinds are left alone (a mixed selection of notes and CC is normal in
// a list). Transpose / quantize / humanize / velocity ratios use the existing editing modules.
import type { Command } from '../editing/history';
import { EditError, moveEvents, updateEvents } from '../editing/operations';
import { editVelocities } from '../editing/velocity';
import type { MidiEvent, MidiProject } from '../model/types';
import { base64ToBytes } from '../model/base64';
import { decodeGs } from '../gs/gsSysex';
import { setRowChannel, setRowValue } from './listEdit';
import { t } from '../../i18n';

export type ListBatchOp =
  | { kind: 'shift'; deltaTicks: number }
  | { kind: 'gate-set'; ticks: number }
  | { kind: 'gate-percent'; percent: number }
  /** 0..15, or null to follow the track */
  | { kind: 'channel'; channel: number | null }
  | { kind: 'value-set'; value: number }
  | { kind: 'value-add'; delta: number }
  | { kind: 'key-set'; pitch: number };

export interface BatchSummary {
  total: number;
  notes: number;
  /** rows with a VEL / value cell (notes, CC, pressure, pitch bend, program, GS value) */
  valued: number;
  /** rows with a channel */
  channel: number;
  /** rows with a note number (notes, poly pressure) */
  keyed: number;
}

const hasValue = (e: MidiEvent) => e.kind === 'note' || e.kind === 'cc' || e.kind === 'program' || e.kind === 'pitch-bend' || e.kind === 'channel-pressure' || e.kind === 'poly-pressure' || (e.kind === 'sysex' && gsRange(e) !== null);
const hasChannel = (e: MidiEvent) => !(e.kind === 'sysex' || e.kind === 'meta' || e.kind === 'raw');

function gsRange(e: MidiEvent): [number, number] | null {
  if (e.kind !== 'sysex') return null;
  const d = decodeGs(base64ToBytes(e.dataBase64) ?? []);
  return d?.param && d.param.max > d.param.min ? [d.param.min, d.param.max] : null;
}

function valueRange(e: MidiEvent): [number, number] | null {
  switch (e.kind) {
    case 'note':
      return [1, 127];
    case 'cc':
    case 'channel-pressure':
    case 'poly-pressure':
      return [0, 127];
    case 'program':
      return [1, 128];
    case 'pitch-bend':
      return [-8192, 8191];
    case 'sysex':
      return gsRange(e);
    default:
      return null;
  }
}

function rowValue(e: MidiEvent): number | null {
  switch (e.kind) {
    case 'note':
      return e.velocity;
    case 'cc':
    case 'pitch-bend':
      return e.value;
    case 'program':
      return e.program + 1;
    case 'channel-pressure':
    case 'poly-pressure':
      return e.pressure;
    case 'sysex':
      return decodeGs(base64ToBytes(e.dataBase64) ?? [])?.data[0] ?? null;
    default:
      return null;
  }
}

export function batchSummary(project: MidiProject, ids: Iterable<string>): BatchSummary {
  const sel = new Set(ids);
  const s: BatchSummary = { total: 0, notes: 0, valued: 0, channel: 0, keyed: 0 };
  for (const tr of project.tracks)
    for (const e of tr.events) {
      if (!sel.has(e.id)) continue;
      s.total++;
      if (e.kind === 'note') s.notes++;
      if (hasValue(e)) s.valued++;
      if (hasChannel(e)) s.channel++;
      if (e.kind === 'note' || e.kind === 'poly-pressure') s.keyed++;
    }
  return s;
}

const clamp = (v: number, r: [number, number]) => Math.max(r[0], Math.min(r[1], Math.round(v)));

/** Applies one op to the rows; returns null when nothing changes. */
export function batchEditRows(project: MidiProject, ids: Iterable<string>, op: ListBatchOp): Command | null {
  const sel = new Set(ids);
  const events = project.tracks.flatMap((tr) => tr.events.filter((e) => sel.has(e.id)));
  if (events.length === 0) return null;
  switch (op.kind) {
    case 'shift':
      if (!Number.isSafeInteger(op.deltaTicks)) throw new EditError(t('移動量は整数 Tick です。'));
      if (op.deltaTicks === 0) return null;
      return moveEvents(project, sel, op.deltaTicks, 0, '位置をずらす');
    case 'gate-set': {
      if (!Number.isSafeInteger(op.ticks) || op.ticks < 1) throw new EditError(t('GT は 1 以上の整数 Tick です。'));
      const updates = events.filter((e) => e.kind === 'note' && e.durationTicks !== op.ticks).map((e) => ({ id: e.id, changes: { durationTicks: op.ticks } }));
      return updates.length ? updateEvents(project, updates, 'GT を一括変更') : null;
    }
    case 'gate-percent': {
      if (!(op.percent > 0)) throw new EditError(t('GT の比率は 1% 以上です。'));
      const updates = events
        .filter((e): e is Extract<MidiEvent, { kind: 'note' }> => e.kind === 'note')
        .map((e) => ({ id: e.id, changes: { durationTicks: Math.max(1, Math.round((e.durationTicks * op.percent) / 100)) }, was: e.durationTicks }))
        .filter((u) => u.changes.durationTicks !== u.was);
      return updates.length ? updateEvents(project, updates, 'GT を一括変更') : null;
    }
    case 'channel':
      return setRowChannel(project, sel, op.channel);
    case 'value-set':
    case 'value-add': {
      // notes keep the velocity module (same clamping as the velocity dialog); the other kinds go one by one
      const noteIds = events.filter((e) => e.kind === 'note').map((e) => e.id);
      let p = project;
      const patches: Command[] = [];
      const noteCmd = noteIds.length ? editVelocities(p, noteIds, op.kind === 'value-set' ? { kind: 'set', value: clamp(op.value, [1, 127]) } : { kind: 'add', delta: op.delta }) : null;
      if (noteCmd) {
        patches.push(noteCmd);
        p = { ...p, ...noteCmd.patch };
      }
      for (const e of events) {
        if (e.kind === 'note') continue;
        const r = valueRange(e);
        const cur = rowValue(e);
        if (!r || cur === null) continue;
        const v = clamp(op.kind === 'value-set' ? op.value : cur + op.delta, r);
        if (v === cur) continue;
        const c = setRowValue(p, e.id, v);
        if (c) {
          patches.push(c);
          p = { ...p, ...c.patch };
        }
      }
      if (patches.length === 0) return null;
      const patch: Record<string, unknown> = {};
      for (const c of patches) for (const k of Object.keys(c.patch)) patch[k] = (p as unknown as Record<string, unknown>)[k];
      return { label: '値を一括変更', patch };
    }
    case 'key-set': {
      if (!Number.isInteger(op.pitch) || op.pitch < 0 || op.pitch > 127) throw new EditError(t('ノート番号は 0〜127 です。'));
      const updates = events.filter((e) => (e.kind === 'note' || e.kind === 'poly-pressure') && e.pitch !== op.pitch).map((e) => ({ id: e.id, changes: { pitch: op.pitch } }));
      return updates.length ? updateEvents(project, updates, 'ノート番号を一括変更') : null;
    }
  }
}
