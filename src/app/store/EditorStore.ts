// The single editing state shared by every editor (CLAUDE.md rule 5): one MidiProject, one
// history, one selection. React components subscribe with useEditor().
import { createHistory, execute, redo, undo, canRedo, canUndo, type Command, type History } from '../../core/editing/history';
import { EMPTY_SELECTION, pruneSelection, type Selection } from '../../core/editing/selection';
import type { ClipboardData } from '../../core/editing/clipboard';
import type { MidiProject, ProjectViewSettings } from '../../core/model/types';

export type Tool = 'select' | 'draw';

export interface EditorState {
  project: MidiProject;
  history: History;
  selection: Selection;
  /** true when there are changes since the last save / load */
  dirty: boolean;
  /** last action label (status bar) */
  lastAction: string | null;
  tool: Tool;
  clipboard: ClipboardData | null;
  /** project revision counter: increments on every content change (not on view settings) */
  revision: number;
}

type Listener = () => void;

export class EditorStore {
  private state: EditorState;
  private listeners = new Set<Listener>();

  constructor(project: MidiProject) {
    this.state = {
      project,
      history: createHistory(),
      selection: EMPTY_SELECTION,
      dirty: false,
      lastAction: null,
      tool: 'select',
      clipboard: null,
      revision: 0,
    };
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): EditorState => this.state;

  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  get project(): MidiProject {
    return this.state.project;
  }

  /** Applies an editing command as one undo step (or merged into the previous one by mergeKey). */
  run(cmd: Command | null | undefined, opts: { mergeKey?: string; select?: Iterable<string> } = {}): void {
    if (!cmd) return;
    const r = execute(this.state.project, this.state.history, cmd, { mergeKey: opts.mergeKey });
    if (r.project === this.state.project) return;
    let selection = pruneSelection(this.state.selection, r.project);
    if (opts.select) selection = { ...selection, eventIds: new Set(opts.select) };
    this.set({ project: r.project, history: r.history, selection, dirty: true, lastAction: cmd.label, revision: this.state.revision + 1 });
  }

  undo(): void {
    if (!canUndo(this.state.history)) return;
    const r = undo(this.state.project, this.state.history);
    this.set({ project: r.project, history: r.history, selection: pruneSelection(this.state.selection, r.project), dirty: true, lastAction: r.label ? `元に戻す: ${r.label}` : null, revision: this.state.revision + 1 });
  }

  redo(): void {
    if (!canRedo(this.state.history)) return;
    const r = redo(this.state.project, this.state.history);
    this.set({ project: r.project, history: r.history, selection: pruneSelection(this.state.selection, r.project), dirty: true, lastAction: r.label ? `やり直し: ${r.label}` : null, revision: this.state.revision + 1 });
  }

  /** Replaces the whole project (new / open / import). Clears history and selection. */
  load(project: MidiProject, opts: { dirty?: boolean } = {}): void {
    this.set({ project, history: createHistory(), selection: EMPTY_SELECTION, dirty: opts.dirty ?? false, lastAction: null, revision: this.state.revision + 1 });
  }

  markSaved(): void {
    this.set({ dirty: false });
  }

  setSelection(selection: Selection): void {
    this.set({ selection });
  }

  selectEvents(ids: Iterable<string>): void {
    this.set({ selection: { ...this.state.selection, eventIds: new Set(ids) } });
  }

  setTool(tool: Tool): void {
    this.set({ tool });
  }

  setClipboard(clipboard: ClipboardData | null): void {
    this.set({ clipboard });
  }

  /**
   * View settings (zoom, panel, snap, selected track) are saved with the project (O01) but are
   * not undo steps and do not mark the song as edited.
   */
  updateSettings(patch: Partial<ProjectViewSettings>): void {
    const prev = this.state.project;
    const settings = { ...prev.settings, ...patch };
    const id = patch.selectedTrackId;
    // ADR-040: with "arm follows selection" on, selecting another track makes it the only armed
    // track (unambiguous record target). Arm flags are saved data, so the song becomes unsaved.
    if (id !== undefined && id !== prev.settings.selectedTrackId && settings.recording.armFollowsSelection && prev.tracks.some((t) => t.id === id) && prev.tracks.some((t) => t.recordArm !== (t.id === id))) {
      const tracks = prev.tracks.map((t) => (t.recordArm === (t.id === id) ? t : { ...t, recordArm: t.id === id }));
      this.set({ project: { ...prev, settings, tracks }, dirty: true, revision: this.state.revision + 1 });
      return;
    }
    this.set({ project: { ...prev, settings } });
  }

  /** Mute / solo / arm: saved with the project (so the song becomes unsaved) but not undo steps. */
  setTrackFlags(trackId: string, flags: Partial<Pick<MidiProject['tracks'][number], 'mute' | 'solo' | 'recordArm'>>): void {
    const tracks = this.state.project.tracks.map((t) => (t.id === trackId ? { ...t, ...flags } : t));
    this.set({ project: { ...this.state.project, tracks }, dirty: true, revision: this.state.revision + 1 });
  }

  /** Key maps / velocities: saved with the project (unsaved flag), not undo steps. */
  setInputPresets(inputPresets: MidiProject['inputPresets']): void {
    this.set({ project: { ...this.state.project, inputPresets }, dirty: true });
  }

  /** Loop range: saved with the project, not an undo step. */
  setLoop(loop: MidiProject['loop']): void {
    this.set({ project: { ...this.state.project, loop }, dirty: true, revision: this.state.revision + 1 });
  }
}
