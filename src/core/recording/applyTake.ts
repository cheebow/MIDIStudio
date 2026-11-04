// Turns a finished take into ONE undoable command (Undo restores the state before recording).
import type { Command } from '../editing/history';
import { addEvents, type NewEvent } from '../editing/operations';
import type { MidiEvent, MidiProject } from '../model/types';
import { snapTick } from '../timing/grid';
import type { Rational } from '../timing/rational';
import type { TakeResult } from './liveTake';

export type RecordMode = 'overdub' | 'replace';
export type LoopTakeChoice = 'merge' | 'last';

export interface ApplyOptions {
  mode: RecordMode;
  loopChoice?: LoopTakeChoice;
  /** quantize note onsets of the new material (applied to the recording only, INPUT_RECORDING 5-7) */
  quantize?: Rational | null;
  /** Replace range: defaults to the recorded range (punch range when punching) */
  replaceRange?: { startTick: number; endTick: number };
}

export function takeToCommand(project: MidiProject, trackId: string, take: TakeResult, opts: ApplyOptions): { command: Command; ids: string[] } | null {
  const takes = opts.loopChoice === 'last' ? take.takes.slice(-1) : take.takes;
  let events: NewEvent[] = takes.flatMap((t) => t.events);
  if (opts.quantize) {
    const g = opts.quantize;
    events = events.map((e) => (e.kind === 'note' ? { ...e, tick: snapTick(e.tick, g).tick } : e));
  }
  let base = project;
  let patch = {};
  if (opts.mode === 'replace') {
    const r = opts.replaceRange ?? take.range;
    const track = project.tracks.find((t) => t.id === trackId);
    if (track) {
      // Replace removes the notes whose onset is in the range, plus only the controller data the take
      // itself recorded (same CC numbers / bend / pressure). Program, bank select, mixer values and
      // other set-up the player did not play stay (ADR-082); SysEx / meta / raw always stay.
      const recordedCc = new Set(events.flatMap((e) => (e.kind === 'cc' && e.controller !== 0 && e.controller !== 32 ? [e.controller] : [])));
      const recordedKinds = new Set(events.map((e) => e.kind));
      const replaces = (e: MidiEvent): boolean => {
        if (e.kind === 'note') return true;
        if (e.kind === 'cc') return recordedCc.has(e.controller);
        return (e.kind === 'pitch-bend' || e.kind === 'channel-pressure' || e.kind === 'poly-pressure') && recordedKinds.has(e.kind);
      };
      const removable = new Set(track.events.filter((e) => e.tick >= r.startTick && e.tick < r.endTick && replaces(e)).map((e) => e.id));
      const tracks = project.tracks.map((t) => (t.id === trackId ? { ...t, events: t.events.filter((e) => !removable.has(e.id)) } : t));
      const clips = project.clips.map((c) => (c.trackId === trackId ? { ...c, eventIds: c.eventIds.filter((id) => !removable.has(id)) } : c));
      base = { ...project, tracks, clips };
      patch = { tracks, clips };
    }
  }
  const added = events.length ? addEvents(base, trackId, events, { label: '録音' }) : null;
  if (!added && opts.mode !== 'replace') return null;
  return { command: { label: opts.mode === 'replace' ? '録音（置き換え）' : '録音', patch: { ...patch, ...(added?.command.patch ?? {}) } }, ids: added?.ids ?? [] };
}
