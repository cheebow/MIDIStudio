// External MIDI keyboard input via Web MIDI (REQ-IN-01/07, INPUT_RECORDING 4).
// Created only when the browser supports Web MIDI; access is requested from a user action with
// sysex: false. Disconnects release the notes held on that device (I14).
import { parseMidiMessage, type ParsedMidiInput } from './midiMessages';
import { t } from '../i18n';

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
  enabled: boolean;
}

export type MidiAccessState = 'unsupported' | 'idle' | 'requesting' | 'granted' | 'denied';

/** Minimal structural types so tests can pass a fake MIDIAccess. */
export interface MidiInputLike {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  state: string;
  onmidimessage: ((e: { data: Uint8Array | null; timeStamp: number }) => void) | null;
}
export interface MidiAccessLike {
  inputs: { forEach(cb: (input: MidiInputLike) => void): void };
  onstatechange: ((e: { port: { id: string; type: string; state: string } | null }) => void) | null;
}

export interface MidiInputHandlers {
  onMessage: (msg: ParsedMidiInput, deviceId: string, timeStamp: number) => void;
  /** device unplugged: the receiver must release that device's notes */
  onDeviceLost: (deviceId: string, name: string) => void;
  onChange: () => void;
}

export class MidiInputAdapter {
  private access: MidiAccessLike | null = null;
  private _state: MidiAccessState;
  private devices = new Map<string, MidiDeviceInfo>();
  private disabled = new Set<string>();
  error: string | null = null;
  /** 0..15, or null for all channels */
  private _channelFilter: number | null = null;

  get channelFilter(): number | null {
    return this._channelFilter;
  }

  setChannelFilter(ch: number | null): void {
    this._channelFilter = ch;
    this.handlers.onChange();
  }

  constructor(
    private readonly handlers: MidiInputHandlers,
    private readonly requestAccess: ((opts: { sysex: boolean }) => Promise<MidiAccessLike>) | null,
  ) {
    this._state = requestAccess ? 'idle' : 'unsupported';
  }

  get state(): MidiAccessState {
    return this._state;
  }

  get deviceList(): MidiDeviceInfo[] {
    return [...this.devices.values()];
  }

  /**
   * Permission state without prompting ('granted' -> enable() connects silently). Browsers without
   * the Permissions API entry for MIDI report 'prompt'.
   */
  async permission(): Promise<'granted' | 'prompt' | 'denied' | 'unsupported'> {
    if (!this.requestAccess) return 'unsupported';
    try {
      const st = await navigator.permissions.query({ name: 'midi' as PermissionName });
      return st.state;
    } catch {
      return 'prompt';
    }
  }

  private pending: Promise<void> | null = null;

  /**
   * Must be called from a user gesture. Requests access at most once: Chrome returns a new
   * MIDIAccess with new MIDIInput objects on every request, and a handler left on an earlier one
   * keeps firing, so every note would arrive twice (recorded as a 1-tick twin). Later calls reuse
   * the access and only rescan the inputs.
   */
  enable(): Promise<void> {
    if (!this.requestAccess) return Promise.resolve();
    if (this.access) {
      this.refresh();
      return Promise.resolve();
    }
    if (!this.pending) this.pending = this.request().finally(() => (this.pending = null));
    return this.pending;
  }

  private async request(): Promise<void> {
    if (!this.requestAccess) return;
    this._state = 'requesting';
    this.handlers.onChange();
    try {
      this.access = await this.requestAccess({ sysex: false });
      this._state = 'granted';
      this.error = null;
      this.access.onstatechange = () => this.refresh();
      this.refresh();
    } catch (e) {
      this._state = 'denied';
      this.error = t('MIDI 機器へのアクセスが許可されませんでした（{message}）。PC キーボードとマウスでの入力は使えます。', { message: String((e as Error)?.message ?? e) });
      this.handlers.onChange();
    }
  }

  setDeviceEnabled(id: string, enabled: boolean): void {
    if (enabled) this.disabled.delete(id);
    else {
      this.disabled.add(id);
      const d = this.devices.get(id);
      if (d) this.handlers.onDeviceLost(id, d.name);
    }
    this.refresh();
  }

  private refresh(): void {
    if (!this.access) return;
    const seen = new Set<string>();
    this.access.inputs.forEach((input) => {
      seen.add(input.id);
      const name = input.name ?? input.id;
      const prev = this.devices.get(input.id);
      const connected = input.state === 'connected';
      if (prev && prev.state === 'connected' && !connected) this.handlers.onDeviceLost(input.id, name);
      this.devices.set(input.id, { id: input.id, name, manufacturer: input.manufacturer ?? '', state: connected ? 'connected' : 'disconnected', enabled: !this.disabled.has(input.id) });
      input.onmidimessage = connected
        ? (e) => {
            if (this.disabled.has(input.id) || !e.data) return;
            const msg = parseMidiMessage(e.data);
            if (!msg) return;
            // Note-offs always pass: a key held while the filter changed must still be released
            // (a note-off with no matching note-on is ignored downstream, ADR-084).
            if (this._channelFilter !== null && msg.channel !== this._channelFilter && msg.type !== 'note-off') return;
            this.handlers.onMessage(msg, input.id, e.timeStamp);
          }
        : null;
    });
    for (const [id, d] of this.devices) {
      if (!seen.has(id) && d.state === 'connected') {
        this.handlers.onDeviceLost(id, d.name);
        this.devices.set(id, { ...d, state: 'disconnected' });
      }
    }
    this.handlers.onChange();
  }
}
