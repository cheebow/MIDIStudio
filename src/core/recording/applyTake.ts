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
  /** loop recording: an onset quantized onto the loop end is the downbeat of the next pass, i.e. the loop start */
  loop?: { startTick: number; endTick: number };
}

export function takeToCommand(project: MidiProject, trackId: string, take: TakeResult, opts: ApplyOptions): { command: Command; ids: string[] } | null {
  const takes = opts.loopChoice === 'last' ? take.takes.slice(-1) : take.takes;
  let events: NewEvent[] = takes.flatMap((t) => t.events);
  if (opts.quantize) {
    const g = opts.quantize;
    const place = (tick: number): number => {
      const q = snapTick(tick, g).tick;
      // the loop end is never played in the loop: a note snapped onto it belongs to the loop start
      if (opts.loop && q >= opts.loop.endTick) return opts.loop.startTick;
      // punch: a note stays inside the punch range it was recorded in
      if (opts.replaceRange && (q < opts.replaceRange.startTick || q >= opts.replaceRange.endTick)) return tick;
      return q;
    };
    events = events.map((e) => (e.kind === 'note' ? { ...e, tick: place(e.tick) } : e));
  }
  let base = project;
  let patch = {};
  if (opts.mode === 'replace') {
    // the range of the take as played, widened to the quantized onsets: an old note under a note that
    // was snapped just outside it would otherwise stay and double the new one
    const onsets = events.map((e) => e.tick);
    const r = opts.replaceRange ?? { startTick: Math.min(take.range.startTick, ...onsets), endTick: Math.max(take.range.endTick, ...onsets.map((x) => x + 1)) };
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
  const added = events.length ? addEvents(base, trackId, events, { label: '録音', separateClip: true }) : null;
  if (!added && opts.mode !== 'replace') return null;
  return { command: { label: opts.mode === 'replace' ? '録音（置き換え）' : '録音', patch: { ...patch, ...(added?.command.patch ?? {}) } }, ids: added?.ids ?? [] };
}
