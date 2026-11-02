// Global shortcuts (UI_DESIGN 9, ADR-044). Musical keys are routed first (performance modes), then
// the editor shortcuts. Nothing fires while typing, inside a dialog or in a menu; browser / OS
// reserved keys are not taken. Single-letter DAW shortcuts work only in the edit mode: in the
// performance modes the same keys are an instrument (INPUT_RECORDING 7); ⌥K / ⌥P switch modes
// from anywhere, Esc always returns to the edit mode.
import { useEffect } from 'react';
import type { EditorStore } from '../store/EditorStore';
import type { Transport } from '../../playback/Transport';
import type { InputController } from '../../input/InputController';
import { shiftOctave, type InputMode } from '../../input/KeyboardRouter';
import type { StepController } from '../recording/StepController';
import type { Recorder } from '../recording/Recorder';
import type { AppActions } from '../store/context';
import type { EditorPanel } from '../../core/model/types';
import { moveTrack } from '../../core/editing/operations';
import { selectedTrack } from '../../core/model/selectedTrack';
import { TimeSignatureMap } from '../../core/timing/timeSignatureMap';
import { IS_MAC } from '../../ui/platform';
import { errorText, isTextTarget } from '../errorText';

export interface ShortcutDeps {
  store: EditorStore;
  transport: Transport;
  input: InputController;
  step: StepController;
  recorder: Recorder;
  actions: AppActions;
  ensureAudio: () => Promise<void>;
  saveToBrowser: () => void;
  openProjectFile: () => void;
  toggleVisual: () => void;
  setError: (m: string) => void;
  tryRun: (fn: () => void) => void;
}

const PANEL_KEYS: Record<string, EditorPanel> = { Digit1: 'piano-roll', Digit2: 'drum', Digit3: 'list', Digit4: 'mixer', Digit5: 'tempo' };

const targetKind = (t: EventTarget | null) => (isTextTarget(t) ? 'text' : (t as HTMLElement | null)?.closest?.('dialog') ? 'dialog' : 'other');
/** Enter on a focused button / tab / link activates it: never also treat it as "go to start". */
const activates = (t: EventTarget | null) => Boolean((t as HTMLElement | null)?.closest?.('button, a, summary, [role="button"], [role="tab"], [role="menuitem"], [role="slider"]'));

export function useGlobalShortcuts(d: ShortcutDeps): void {
  // Re-subscribed on every render on purpose: the handlers read the latest closures.
  useEffect(() => {
    const { store, transport, input, step, recorder, actions } = d;
    const onKeyUp = (e: KeyboardEvent) => {
      if (input.keyUp({ code: e.code, timeStamp: e.timeStamp }) !== 'ignored') e.preventDefault();
      // Space is play / pause: a focused toolbar button must not also fire (browsers click on keyup)
      if (e.code === 'Space' && !(IS_MAC ? e.metaKey : e.ctrlKey) && targetKind(e.target) === 'other' && !(e.target as HTMLElement | null)?.closest?.('.menubar, .menu-items') && activates(e.target)) e.preventDefault();
      // Tab is a momentary sustain pedal in the PC-keyboard mode (ADR-044 追記)
      if (e.key === 'Tab' && input.mode === 'piano-performance' && input.sustain) input.setSustain(false);
    };
    const sigMap = () => new TimeSignatureMap(store.project.ppq, store.project.conductor.filter((c) => c.kind === 'time-signature'));
    /** start of the bar `delta` bars away from the one containing `tick` */
    const barStart = (tick: number, delta = 0) => {
      const sig = sigMap();
      return Math.round(sig.barBeatToTick(Math.max(1, sig.tickToBarBeat(Math.max(0, tick)).bar + delta)));
    };
    /** tick range covered by the selected events (note ends included) */
    const selectedSpan = (): { start: number; end: number } | null => {
      const sel = store.getState().selection.eventIds;
      let start = Infinity;
      let end = -Infinity;
      for (const t of store.project.tracks)
        for (const e of t.events) {
          if (!sel.has(e.id)) continue;
          start = Math.min(start, e.tick);
          end = Math.max(end, e.kind === 'note' ? e.tick + e.durationTicks : e.tick);
        }
      return start === Infinity ? null : { start, end };
    };
    const toggleMode = (m: InputMode) => input.setMode(input.mode === m ? 'edit-shortcuts' : m);
    const playFrom = (tick: number) =>
      d
        .ensureAudio()
        .then(() => {
          transport.seek(tick);
          return transport.play();
        })
        .catch((err: unknown) => d.setError(errorText(err)));

    const onKey = (e: KeyboardEvent) => {
      // Musical keys first (performance modes), so they never trigger shortcuts.
      const routed = input.keyDown({ code: e.code, repeat: e.repeat, targetKind: targetKind(e.target), ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, timeStamp: e.timeStamp });
      if (routed !== 'ignored') {
        e.preventDefault();
        return;
      }
      // (Space / Delete / ⌘Z / Esc in a dialog or menu would act on the song behind the modal)
      if (targetKind(e.target) !== 'other' || (e.target as HTMLElement | null)?.closest?.('.menubar, .menu-items')) return;
      if (e.key === 'Escape' && input.mode !== 'edit-shortcuts') {
        input.setMode('edit-shortcuts');
        return;
      }
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      const handled = () => e.preventDefault();
      // Mode switches work in every mode (the router ignores keys with Alt / Option).
      if (e.altKey && !mod && !e.shiftKey && (e.code === 'KeyK' || e.code === 'KeyP')) {
        handled();
        toggleMode(e.code === 'KeyK' ? 'piano-performance' : 'drum-performance');
        return;
      }
      // PC-keyboard performance: ↑ ↓ shift the octave (also in step input), Tab held = sustain.
      // These keys are not notes in the key maps (physical positions, JIS / US alike).
      if (!mod && !e.altKey && (input.mode === 'piano-performance' || input.mode === 'step-piano') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        handled();
        if (!e.repeat) store.setInputPresets(shiftOctave(store.project.inputPresets, e.key === 'ArrowUp' ? 1 : -1));
        return;
      }
      if (!mod && !e.altKey && input.mode === 'piano-performance' && e.key === 'Tab') {
        handled();
        if (!e.repeat) input.setSustain(true);
        return;
      }
      // Step recording keys (normal keys; numpad +/- are optional extras)
      if (!mod && (input.mode === 'step-piano' || input.mode === 'step-drums')) {
        const stepKey: Record<string, () => void> = {
          ArrowRight: () => step.rest(),
          NumpadAdd: () => step.forward(),
          ArrowLeft: () => step.back(),
          NumpadSubtract: () => step.back(),
          Backspace: () => step.undoLast(),
          Minus: () => step.tie(),
        };
        const fn = stepKey[e.code];
        if (fn) {
          handled();
          fn();
          return;
        }
      }
      // In performance modes, single-letter shortcuts are off to avoid accidents (INPUT_RECORDING 7).
      const letter = input.mode === 'edit-shortcuts' && !mod && !e.altKey;
      const k = e.key.toLowerCase();
      const project = store.project;
      const settings = project.settings;
      const track = selectedTrack(project);
      const pos = () => Math.round(transport.getPosition().tick);
      if (e.code === 'Space' && !mod) {
        handled();
        const span = e.shiftKey ? selectedSpan() : null;
        if (span) void playFrom(span.start);
        else
          d.ensureAudio()
            .then(() => transport.togglePlay())
            .catch((err: unknown) => d.setError(errorText(err)));
      } else if (mod && k === 'z' && !e.shiftKey) {
        handled();
        actions.undo();
      } else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) {
        handled();
        actions.redo();
      } else if (mod && k === 'c') {
        handled();
        actions.copy();
      } else if (mod && k === 'x') {
        handled();
        actions.cut();
      } else if (mod && k === 'v') {
        handled();
        actions.paste();
      } else if (mod && k === 'd') {
        handled();
        actions.duplicate();
      } else if (mod && k === 'a') {
        handled();
        actions.selectAll();
      } else if (mod && k === 's') {
        handled();
        d.saveToBrowser();
      } else if (mod && k === 'o') {
        handled();
        d.openProjectFile();
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        handled();
        actions.delete();
      } else if (!mod && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        handled();
        const id = settings.selectedTrackId;
        if (id) d.tryRun(() => store.run(moveTrack(project, id, e.key === 'ArrowUp' ? -1 : 1)));
      } else if (!mod && !e.altKey && (e.key === 'Home' || (e.key === 'Enter' && !activates(e.target)))) {
        handled();
        transport.seek(0);
      } else if (letter && !e.shiftKey && (e.code === 'Comma' || e.code === 'Period')) {
        handled();
        transport.seek(barStart(pos(), e.code === 'Comma' ? -1 : 1));
      } else if (letter && !e.shiftKey && PANEL_KEYS[e.code]) {
        handled();
        store.updateSettings({ activePanel: PANEL_KEYS[e.code], editorCollapsed: false });
      } else if (letter && k === 'r') {
        handled();
        if (recorder.getState().phase === 'idle') d.ensureAudio().then(() => recorder.start()).catch((err: unknown) => d.setError(errorText(err)));
        else recorder.stop();
      } else if (letter && k === 't') {
        handled();
        d.toggleVisual();
      } else if (letter && k === 'q') {
        handled();
        if (e.shiftKey) actions.quantizeDialog();
        else actions.quantize();
      } else if (letter && k === 'v') {
        handled();
        store.setTool('select');
      } else if (letter && k === 'p') {
        handled();
        store.setTool('draw');
      } else if (letter && k === 'l') {
        handled();
        const span = e.shiftKey ? selectedSpan() : null;
        if (e.shiftKey) {
          if (span) store.setLoop({ enabled: true, startTick: barStart(span.start), endTick: barStart(Math.max(span.start, span.end - 1), 1) });
        } else store.setLoop({ ...project.loop, enabled: !project.loop.enabled });
      } else if (letter && !e.shiftKey && (k === 'i' || k === 'o')) {
        handled();
        const loop = project.loop;
        if (k === 'i') {
          const startTick = barStart(pos());
          store.setLoop({ ...loop, startTick, endTick: loop.endTick > startTick ? loop.endTick : barStart(pos(), 1) });
        } else {
          const endTick = barStart(pos(), 1);
          store.setLoop({ ...loop, endTick, startTick: loop.startTick < endTick ? loop.startTick : barStart(pos()) });
        }
      } else if (letter && !e.shiftKey && (k === 'm' || k === 's')) {
        handled();
        if (track) store.setTrackFlags(track.id, k === 'm' ? { mute: !track.mute } : { solo: !track.solo });
      } else if (letter && !e.shiftKey && k === 'k') {
        handled();
        store.updateSettings({ metronome: !settings.metronome });
      } else if (letter && !e.shiftKey && k === 'j') {
        handled();
        store.updateSettings({ snapEnabled: !settings.snapEnabled });
      } else if (letter && !e.shiftKey && k === 'f') {
        handled();
        store.updateSettings({ followPlayback: !settings.followPlayback });
      } else if (!mod && k === 'escape') store.selectEvents([]);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  });
}
