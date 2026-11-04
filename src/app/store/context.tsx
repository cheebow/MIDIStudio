import { createContext, useContext, useSyncExternalStore } from 'react';
import type { EditorState, EditorStore } from './EditorStore';
import type { Transport } from '../../playback/Transport';
import type { SpessaAdapter } from '../../playback/SpessaAdapter';
import type { InputController } from '../../input/InputController';
import type { StepController } from '../recording/StepController';
import type { Recorder } from '../recording/Recorder';
import type { PerformKind } from '../../ui/perform';

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
  /** humanize / velocity dialogs (ADR-050) */
  humanizeDialog: () => void;
  velocityDialog: () => void;
  /** performance tools (ADR-077): guitar voicing, strum, arpeggio, legato, velocity shaper */
  performDialog: (kind: PerformKind) => void;
  transpose: (semitones: number) => void;
  noteLength: () => void;
  /** merges the selected clips of each track into one (track view menu, ⌘J; ADR-065) */
  mergeClips: () => void;
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
