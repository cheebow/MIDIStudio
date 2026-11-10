// The single editing state shared by every editor (CLAUDE.md rule 5): one MidiProject, one
// history, one selection. React components subscribe with useEditor().
import { applyCommand, createHistory, execute, redo, undo, canRedo, canUndo, type Command, type History } from '../../core/editing/history';
import { EMPTY_SELECTION, pruneSelection, type Selection } from '../../core/editing/selection';
import type { ClipboardData } from '../../core/editing/clipboard';
import type { MidiProject, ProjectViewSettings } from '../../core/model/types';
import { t } from '../../i18n';

/** scissors / glue: cut and join notes in the piano roll, clips in the track view (ADR-095) */
export type Tool = 'select' | 'draw' | 'scissors' | 'glue';

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
  /**
   * One-shot request to show a position in the note editors (double-click on a clip, ADR-085).
   * Not saved; the editor of `trackId` scrolls to `tick` and clears it with takeReveal().
   */
  reveal: { trackId: string; tick: number } | null;
  /**
   * While a dialog previews a transform (ADR-077), `project` shows the result and this holds the
   * real (committed) project. null = no preview. Autosave and the dialogs read `committedProject`.
   */
  previewBase: MidiProject | null;
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
      reveal: null,
      previewBase: null,
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

  /**
   * The real (committed) project: what every edit, the recorder and saving work on. While a dialog
   * previews a transform, the views and the Transport show `getState().project` (the preview) and
   * this still returns the song without it, so a command built from it never carries the preview
   * into the history (ADR-092 review).
   */
  get project(): MidiProject {
    return this.state.previewBase ?? this.state.project;
  }

  /** Same as `project` (kept for the callers that say "committed" explicitly). */
  get committedProject(): MidiProject {
    return this.project;
  }

  // ---------------------------------------------------------------- preview (ADR-077)

  /**
   * Shows `build(base)` applied to the committed project in every view and the transport, without
   * touching the history, the unsaved flag or the selection. Calling it again replaces the preview
   * (always computed from the same base, so nothing accumulates). A null command shows the base.
   */
  preview(build: (base: MidiProject) => Command | null): void {
    const base = this.committedProject;
    const cmd = build(base);
    const project = cmd ? applyCommand(base, cmd).project : base;
    this.set({ project, previewBase: base, revision: this.state.revision + 1 });
  }

  /** Removes the preview; the committed project shows again. No-op without a preview. */
  cancelPreview(): void {
    if (!this.state.previewBase) return;
    this.set({ project: this.state.previewBase, previewBase: null, revision: this.state.revision + 1 });
  }

  /** Drops the preview and applies `build(base)` as one undo step (selecting `select` if given). */
  commitPreview(build: (base: MidiProject) => { command: Command | null; select?: Iterable<string> }): void {
    this.dropPreview();
    const r = build(this.state.project);
    this.run(r.command, { select: r.select });
  }

  /**
   * Any other change of the project ends a preview first, so a stale preview never overwrites it.
   * Listeners are told and the revision moves, so the views and the Transport (which follows the
   * revision) go back to the real song even when nothing else changes afterwards (ADR-092 review).
   */
  private dropPreview(): void {
    if (this.state.previewBase) this.set({ project: this.state.previewBase, previewBase: null, revision: this.state.revision + 1 });
  }

  /** Applies an editing command as one undo step (or merged into the previous one by mergeKey). */
  run(cmd: Command | null | undefined, opts: { mergeKey?: string; select?: Iterable<string> } = {}): void {
    if (!cmd) return;
    this.dropPreview();
    const r = execute(this.state.project, this.state.history, cmd, { mergeKey: opts.mergeKey });
    if (r.project === this.state.project) return;
    this.forgetFlagEdits(this.state.project, r.project);
    let selection = pruneSelection(this.state.selection, r.project);
    if (opts.select) selection = { ...selection, eventIds: new Set(opts.select) };
    this.set({ project: r.project, history: r.history, selection, dirty: true, lastAction: cmd.label, revision: this.state.revision + 1 });
  }

  /**
   * Mute / solo set with setTrackFlags since the edit that last changed them. They are not undo
   * steps, but an undo / redo patch restores whole track objects captured before the flag change.
   */
  private flagEdits = new Map<string, Partial<Pick<MidiProject['tracks'][number], 'mute' | 'solo'>>>();

  /**
   * Keeps the flags the user set (setTrackFlags) on the tracks an undo / redo restores, so Undo never
   * silently unmutes a track (ADR-082). Flags that an edit itself set (a track merge) are left to
   * the patch, so undoing that edit restores them (ADR-086).
   */
  private keepTrackFlags(project: MidiProject): MidiProject {
    if (project.tracks === this.state.project.tracks || this.flagEdits.size === 0) return project;
    let changed = false;
    const tracks = project.tracks.map((t) => {
      const f = this.flagEdits.get(t.id);
      if (!f || ((f.mute === undefined || f.mute === t.mute) && (f.solo === undefined || f.solo === t.solo))) return t;
      changed = true;
      return { ...t, ...f };
    });
    return changed ? { ...project, tracks } : project;
  }

  /** an edit that sets a track's mute / solo itself takes over from the earlier setTrackFlags */
  private forgetFlagEdits(before: MidiProject, after: MidiProject) {
    if (this.flagEdits.size === 0 || before.tracks === after.tracks) return;
    const old = new Map(before.tracks.map((t) => [t.id, t]));
    for (const t of after.tracks) {
      const o = old.get(t.id);
      const f = this.flagEdits.get(t.id);
      if (!o || !f) continue;
      if (o.mute !== t.mute) delete f.mute;
      if (o.solo !== t.solo) delete f.solo;
      if (f.mute === undefined && f.solo === undefined) this.flagEdits.delete(t.id);
    }
  }

  undo(): void {
    if (!canUndo(this.state.history)) return;
    this.dropPreview();
    const r = undo(this.state.project, this.state.history);
    this.set({ project: this.keepTrackFlags(r.project), history: r.history, selection: pruneSelection(this.state.selection, r.project), dirty: true, lastAction: r.label ? t('元に戻す: {label}', { label: t(r.label) }) : null, revision: this.state.revision + 1 });
  }

  redo(): void {
    if (!canRedo(this.state.history)) return;
    this.dropPreview();
    const r = redo(this.state.project, this.state.history);
    this.set({ project: this.keepTrackFlags(r.project), history: r.history, selection: pruneSelection(this.state.selection, r.project), dirty: true, lastAction: r.label ? t('やり直し: {label}', { label: t(r.label) }) : null, revision: this.state.revision + 1 });
  }

  /** Replaces the whole project (new / open / import). Clears history and selection. */
  load(project: MidiProject, opts: { dirty?: boolean } = {}): void {
    this.flagEdits.clear();
    this.set({ project, previewBase: null, history: createHistory(), selection: EMPTY_SELECTION, dirty: opts.dirty ?? false, lastAction: null, revision: this.state.revision + 1 });
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

  /** Asks the note editor of `trackId` to scroll to `tick` (ADR-085). */
  revealTick(trackId: string, tick: number): void {
    this.set({ reveal: { trackId, tick } });
  }

  /** The editor of `trackId` takes the pending reveal request (null when there is none for it). */
  takeReveal(trackId: string): number | null {
    const r = this.state.reveal;
    if (!r || r.trackId !== trackId) return null;
    this.state = { ...this.state, reveal: null }; // no notify: nothing else draws from it
    return r.tick;
  }

  setClipboard(clipboard: ClipboardData | null): void {
    this.set({ clipboard });
  }

  /**
   * View settings (zoom, panel, snap, selected track) are saved with the project (O01) but are
   * not undo steps and do not mark the song as edited.
   */
  updateSettings(patch: Partial<ProjectViewSettings>): void {
    this.dropPreview();
    const prev = this.state.project;
    const settings = { ...prev.settings, ...patch };
    this.set({ project: { ...prev, settings } });
  }

  /** Mute / solo: saved with the project (so the song becomes unsaved) but not undo steps. */
  setTrackFlags(trackId: string, flags: Partial<Pick<MidiProject['tracks'][number], 'mute' | 'solo'>>): void {
    this.dropPreview();
    const tracks = this.state.project.tracks.map((t) => (t.id === trackId ? { ...t, ...flags } : t));
    this.flagEdits.set(trackId, { ...this.flagEdits.get(trackId), ...flags });
    this.set({ project: { ...this.state.project, tracks }, dirty: true, revision: this.state.revision + 1 });
  }

  /** Key maps / velocities: saved with the project (unsaved flag), not undo steps. */
  setInputPresets(inputPresets: MidiProject['inputPresets']): void {
    this.dropPreview();
    this.set({ project: { ...this.state.project, inputPresets }, dirty: true });
  }

  /** Loop range: saved with the project, not an undo step. */
  setLoop(loop: MidiProject['loop']): void {
    this.dropPreview();
    this.set({ project: { ...this.state.project, loop }, dirty: true, revision: this.state.revision + 1 });
  }
}
