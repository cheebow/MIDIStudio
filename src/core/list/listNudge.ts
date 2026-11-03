// +/- and drag increments of list cells (ADR-066). One unit is 1 for numbers, 1 tick in the
// Native Tick display and ppq/48 ticks in the Classic 48 display (refused, never rounded, when
// the PPQ is not a multiple of 48). Values are clamped to the cell's range; a press at the bound
// does nothing. The resulting command is the same as typing the value, so undo labels are shared.
import type { Command } from '../editing/history';
import { EditError } from '../editing/operations';
import type { MidiProject } from '../model/types';
import { hasChannel } from '../events/order';
import { eventValueRange } from './eventValue';
import { setTempo } from '../editing/conductorOps';
import { setAbsoluteTick, setGateTime, setRowChannel, setRowKey, setRowValue, setStepTime } from './listEdit';
import { isConductorEvent, type ListRow, type ListUnit } from './listRows';
import { t } from '../../i18n';

export type NudgeCol = 'key' | 'st' | 'gt' | 'vel' | 'tick' | 'ch';

export interface NudgeOpts {
  /** signed number of units (±1, ±10, ±12 …) */
  steps: number;
  unit: ListUnit;
  ppq: number;
}

export type NudgeResult = { ok: true; value: number } | { ok: false; message: string } | null;

/** Value range of a cell: [min, max], or null when the cell has no number. */
export function cellRange(row: ListRow, col: NudgeCol): [number, number] | null {
  const e = row.event;
  if (isConductorEvent(e)) return col === 'vel' && e.kind === 'tempo' ? [1, 999] : null; // BPM; the rest is edited in the conductor tab
  switch (col) {
    case 'key':
      return e.kind === 'note' || e.kind === 'poly-pressure' ? [0, 127] : null;
    case 'vel':
      return eventValueRange(e);
    case 'st':
      return row.stTicks === null ? null : [0, Number.MAX_SAFE_INTEGER];
    case 'gt':
      return e.kind === 'note' ? [1, Number.MAX_SAFE_INTEGER] : null;
    case 'tick':
      return [0, Number.MAX_SAFE_INTEGER];
    case 'ch':
      return hasChannel(e) ? [0, 15] : null;
  }
}

function currentValue(row: ListRow, col: NudgeCol, trackChannel: number): number | null {
  switch (col) {
    case 'key':
      return row.key;
    case 'vel':
      return row.value;
    case 'st':
      return row.stTicks;
    case 'gt':
      return row.gtTicks;
    case 'tick':
      return row.tick;
    case 'ch':
      return !isConductorEvent(row.event) && hasChannel(row.event) ? (row.event.channelOverride ?? trackChannel) : null;
  }
}

/** New value of the cell after `steps` units, clamped; null when nothing would change. */
export function nudgedValue(row: ListRow, col: NudgeCol, opts: NudgeOpts, trackChannel: number): NudgeResult {
  const range = cellRange(row, col);
  const cur = currentValue(row, col, trackChannel);
  if (!range || cur === null) return null;
  let delta = opts.steps;
  if (col === 'st' || col === 'gt' || col === 'tick') {
    if (opts.unit === 'classic48') {
      if (opts.ppq % 48 !== 0) return { ok: false, message: t('PPQ {ppq} では Classic 48 の 1 単位が整数 Tick になりません。Native Tick 表示で増減してください。', { ppq: opts.ppq }) };
      delta = opts.steps * (opts.ppq / 48);
    }
  } else if (col === 'vel' && row.event.kind === 'pitch-bend' && Math.abs(opts.steps) >= 10) delta = Math.sign(opts.steps) * 128; // big step on a 14-bit value
  const value = Math.max(range[0], Math.min(range[1], cur + delta));
  return value === cur ? null : { ok: true, value };
}

/** The edit command for the nudged cell (same operations as typing the value). */
export function nudgeCell(project: MidiProject, trackId: string, row: ListRow, col: NudgeCol, opts: NudgeOpts): { command: Command | null } | { message: string } | null {
  const track = project.tracks.find((x) => x.id === trackId);
  if (!track) throw new EditError('track not found');
  const r = nudgedValue(row, col, opts, track.channel);
  if (r === null) return null;
  if (!r.ok) return { message: r.message };
  if (isConductorEvent(row.event)) return { command: setTempo(project, row.tick, r.value) };
  switch (col) {
    case 'key':
      return { command: setRowKey(project, row.id, r.value) };
    case 'vel':
      return { command: setRowValue(project, row.id, r.value) };
    case 'st':
      return { command: setStepTime(project, trackId, row.id, r.value) };
    case 'gt':
      return { command: setGateTime(project, row.id, r.value) };
    case 'tick':
      return { command: setAbsoluteTick(project, row.id, r.value) };
    case 'ch':
      return { command: setRowChannel(project, [row.id], r.value) };
  }
}
