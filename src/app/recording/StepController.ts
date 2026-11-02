// Step recording controller (REQ-IN-05, INPUT_RECORDING 6). Listens to the shared input stream in
// step modes. Piano: keys pressed together form a chord, written when the last key is released.
// Drums: every hit is written at the cursor (auto-advance off by default, I09).
import { stepBack, stepForward, stepNotes, stepRest, stepTie, stepUndoLast, type StepSettings, type StepState } from '../../core/recording/stepRecorder';
import type { InputController, CapturedInput } from '../../input/InputController';
import type { EditorStore } from '../store/EditorStore';

type Listener = () => void;

export class StepController {
  private state: StepState = { cursor: 0, lastStep: null };
  private listeners = new Set<Listener>();
  private pending = new Map<number, number>();
  private held = new Set<number>();
  private message: string | null = null;

  constructor(
    private readonly store: EditorStore,
    private readonly input: InputController,
  ) {
    input.addSink((e, trackId) => this.onInput(e, trackId));
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private snapshot = { cursor: 0, message: null as string | null };
  getSnapshot = () => this.snapshot;
  private emit() {
    this.snapshot = { cursor: this.state.cursor, message: this.message };
    for (const l of this.listeners) l();
  }

  get cursor(): number {
    return this.state.cursor;
  }

  setCursor(tick: number): void {
    this.state = { cursor: Math.max(0, Math.round(tick)), lastStep: null };
    this.emit();
  }

  settings(drum: boolean): StepSettings {
    const r = this.store.project.settings.recording;
    return { stepTicks: r.stepTicks, gate: { ratio: Math.max(0.01, Math.min(1, r.gatePercent / 100)) }, autoAdvance: drum ? r.drumAutoAdvance : true };
  }

  private active(): 'piano' | 'drum' | null {
    const m = this.input.mode;
    return m === 'step-piano' ? 'piano' : m === 'step-drums' ? 'drum' : null;
  }

  private onInput(e: CapturedInput, trackId: string | null) {
    const kind = this.active();
    if (!kind || !trackId) return;
    const drum = kind === 'drum' || e.target === 'drum';
    if (e.type === 'note-on') {
      if (drum) {
        this.write(trackId, [{ pitch: e.pitch, velocity: e.velocity }], true);
        return;
      }
      this.held.add(e.pitch);
      this.pending.set(e.pitch, e.velocity);
    } else if (e.type === 'note-off' && !drum) {
      this.held.delete(e.pitch);
      if (this.held.size === 0 && this.pending.size > 0) {
        const chord = [...this.pending].map(([pitch, velocity]) => ({ pitch, velocity }));
        this.pending.clear();
        this.write(trackId, chord, false);
      }
    }
  }

  private write(trackId: string, notes: { pitch: number; velocity: number }[], drum: boolean) {
    try {
      const r = stepNotes(this.store.project, trackId, this.state, this.settings(drum), notes);
      this.store.run(r.command, { select: r.state.lastStep?.ids });
      this.state = r.state;
      this.message = null;
    } catch (err) {
      this.message = (err as Error).message;
    }
    this.emit();
  }

  rest(): void {
    this.state = stepRest(this.state, this.settings(this.active() === 'drum'));
    this.emit();
  }
  forward(): void {
    this.state = stepForward(this.state, this.settings(this.active() === 'drum'));
    this.emit();
  }
  back(): void {
    this.state = stepBack(this.state, this.settings(this.active() === 'drum'));
    this.emit();
  }
  tie(): void {
    const r = stepTie(this.store.project, this.state, this.settings(this.active() === 'drum'));
    this.store.run(r.command);
    this.state = r.state;
    this.emit();
  }
  undoLast(): void {
    const r = stepUndoLast(this.store.project, this.state);
    this.store.run(r.command);
    this.state = r.state;
    this.emit();
  }
}
