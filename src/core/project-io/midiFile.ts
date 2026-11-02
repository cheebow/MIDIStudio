// Opening an SMF: read + import in one step. Returns a result; the caller's current project is
// never touched on failure (C14 / O04).
import { readSmf } from '../smf/reader';
import type { ImportIssue } from '../smf/types';
import { importSmf, type ImportOptions } from './importSmf';
import type { MidiProject } from '../model/types';
import { applyGsRhythmDisplay } from '../gs/gsProject';
import { tracksInChannelOrder } from '../editing/operations';
import { mergeControllerTracks, mergeDrumTracks } from '../editing/trackMerge';

export type OpenMidiResult = { ok: true; project: MidiProject; issues: ImportIssue[] } | { ok: false; errors: ImportIssue[] };

/** `trackOrder: 'channel'` (default) sorts tracks by port, then channel; 'file' keeps the SMF order. */
export function openMidiFile(bytes: Uint8Array, options: ImportOptions & { trackOrder?: 'channel' | 'file'; mergeDrums?: boolean; mergeControllers?: boolean } = {}): OpenMidiResult {
  const r = readSmf(bytes);
  if (!r.ok) return { ok: false, errors: r.errors };
  const { project, issues } = importSmf(r.smf, r.warnings, options);
  // GS "Use for Rhythm Part" makes non-Ch10 parts drums (REQ-EDT-08); display only, events unchanged.
  const gs = applyGsRhythmDisplay(project);
  if (gs.changed.length) issues.push({ code: 'I_GS_RHYTHM_PART', severity: 'info', message: `GS の「Use for Rhythm Part」設定により、${gs.changed.join('、')} をドラム表示にしました（MIDI データは変更していません）。` });
  let merged = gs.project;
  // One MTrk per drum instrument (BD / SD / HH ...) on the same port + channel becomes one drum track.
  if (options.mergeDrums !== false) {
    const m = mergeDrumTracks(merged);
    if (m) {
      merged = { ...merged, ...m.command.patch };
      issues.push({ code: 'I_IMPORT_DRUMS_MERGED', severity: 'info', message: `同じチャンネルのドラムトラック（${m.merged.map((g) => g.join('・')).join(' / ')}）を1つのトラックにまとめました。MIDI の内容は変わりません。` });
    }
  }
  // Controller-only tracks (mod wheel / pitch bend ...) join the note track of their channel.
  if (options.mergeControllers !== false) {
    const m = mergeControllerTracks(merged);
    if (m) {
      merged = { ...merged, ...m.command.patch };
      issues.push({ code: 'I_IMPORT_CONTROLLERS_MERGED', severity: 'info', message: `ノートの無いコントローラーだけのトラックを、同じチャンネルのトラックにまとめました（${m.merged.map((g) => `${g[0]} ← ${g.slice(1).join('・')}`).join(' / ')}）。MIDI の内容は変わりません。` });
    }
  }
  const ordered = options.trackOrder === 'file' ? merged : { ...merged, tracks: tracksInChannelOrder(merged.tracks) };
  return { ok: true, project: ordered, issues };
}
