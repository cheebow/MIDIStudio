import { createContext, useContext, useSyncExternalStore } from 'react';
import type { EditorState, EditorStore } from './EditorStore';
import type { Transport } from '../../playback/Transport';
import type { SpessaAdapter } from '../../playback/SpessaAdapter';
import type { InputController } from '../../input/InputController';
import type { StepController } from '../recording/StepController';
import type { Recorder } from '../recording/Recorder';
import type { MidiProject } from '../../core/model/types';

/** The performance-tool dialogs (ADR-092). */
export type PerformKind = 'strum' | 'arpeggio' | 'legato' | 'velocity-shaper';

export interface AppServices {
  store: EditorStore;
  transport: Transport;
  adapter: SpessaAdapter;
  input: InputController;
  step: StepController;
  recorder: Recorder;
  /** true once a SoundFont is loaded */
  audioReady: boolean;
  /** unlocks / finishes loading the audio engine inside a user gesture (rejects with the reason) */
  ensureAudio: () => Promise<void>;
  reportError: (message: string) => void;
}

/** Edit-menu actions shared with the editors' right-click menus (they act on the current selection). */
export interface EditActions {
  copy: () => void;
  cut: () => void;
  duplicate: () => void;
  delete: () => void;
  selectAll: () => void;
  /** quantize the selection with the editing grid (Q) */
  quantize: () => void;
  /** open the quantize dialog: note value, strength, shuffle, lengths (⇧Q, ADR-043) */
  quantizeDialog: () => void;
  /** runs `fn` (a command or a dialog acting on the selection) on a clip's notes; afterwards the clip alone is selected again */
  onClipNotes: (noteIds: string[], fn: () => void) => void;
  /** humanize / velocity dialogs (ADR-050) */
  humanizeDialog: () => void;
  velocityDialog: () => void;
  /** performance tools on the selected notes (ADR-092, revived from ADR-077 / 078): 入力支援 and 編集 › ノート */
  performDialog: (kind: PerformKind) => void;
  transpose: (semitones: number) => void;
  noteLength: () => void;
  /** merges the selected clips of each track into one (track view menu, ⌘J; ADR-065) */
  mergeClips: () => void;
  /**
   * 入力支援 › ギターボイシング › コードを 1 つ入力… (ADR-091): opens the dialog for a track at a tick fixed by the
   * right-click; the chord analysis at that tick is read now, once.
   */
  guitarVoicing: (at: { trackId: string; tick: number; returnFocus?: HTMLElement | null }) => void;
  /** 入力支援 › ギターボイシング（コード進行）… (ADR-091 追記): a progression from that tick */
  guitarProgression: (at: { trackId: string; tick: number; returnFocus?: HTMLElement | null }) => void;
}

/** Every command the menus and shortcuts can run (the editors only need EditActions). */
export interface AppActions extends EditActions {
  undo: () => void;
  redo: () => void;
  paste: () => void;
  splitAtCursor: () => void;
  addTrack: () => void;
  duplicateTrack: () => void;
  removeTrack: () => void;
}

export const EditActionsContext = createContext<EditActions | null>(null);

export function useEditActions(): EditActions {
  const a = useContext(EditActionsContext);
  if (!a) throw new Error('EditActionsContext missing');
  return a;
}

/** The song without a transform preview (ADR-077 / 092): what the tool dialogs compute from. */
export function useCommittedProject(): MidiProject {
  const s = useEditorState();
  return s.previewBase ?? s.project;
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesContext missing');
  return s;
}

export function useEditorState(): EditorState {
  const { store } = useServices();
  return useSyncExternalStore(store.subscribe, store.getState);
}
