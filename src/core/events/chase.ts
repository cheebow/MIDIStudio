// EventChase (ARCHITECTURE F, MIDI_GS_SPEC 6): the controller state of every port/channel just
// before a tick, rebuilt from the project. Note Ons are never chased (no stuck notes).
// The SpessaSynth sequencer performs its own chase on seek; this module is used for live preview
// (so auditioned notes use the track's program at the playhead) and for verification.
import { base64ToBytes } from '../model/base64';
import { portIndex } from '../model/ports';
import type { MidiProject } from '../model/types';
import { compareEvents } from './order';

export interface ChannelChaseState {
  port: number;
  channel: number;
  bankMsb?: number;
  bankLsb?: number;
  program?: number;
  /** last value per controller, excluding bank select, data entry and RPN/NRPN selectors */
  controllers: Map<number, number>;
  pitchBend?: number; // -8192..8191
  /** "rpn:msb:lsb" / "nrpn:msb:lsb" -> data entry values */
  parameters: Map<string, { msb?: number; lsb?: number }>;
}

export interface ChaseResult {
  channels: Map<string, ChannelChaseState>;
  /** SysEx before the tick, in playback order (GS Reset, part settings...) */
  sysex: { tick: number; port: number; status: 'F0' | 'F7'; data: Uint8Array }[];
}

const SKIP_CC = new Set([0, 32, 6, 38, 96, 97, 98, 99, 100, 101, 120, 123, 124, 125, 126, 127]);

export function chaseKey(port: number, channel: number): string {
  return `${port}:${channel}`;
}

/** State at the moment just before `tick` (events at `tick` itself are not included). */
export function chaseAt(project: MidiProject, tick: number): ChaseResult {
  const channels = new Map<string, ChannelChaseState>();
  const sysex: ChaseResult['sysex'] = [];
  const state = (port: number, channel: number) => {
    const k = chaseKey(port, channel);
    let s = channels.get(k);
    if (!s) channels.set(k, (s = { port, channel, controllers: new Map(), parameters: new Map() }));
    return s;
  };
  const selected = new Map<string, string | null>();
  // Several tracks may share a port / channel: apply their events in playback order (tick, then
  // track, then the order within the track), not track by track, or the last track would win over
  // a later value on an earlier track (ADR-083).
  type Item = { tick: number; ti: number; order: number; port: number; channel: number; e: ChaseEvent };
  type ChaseEvent = Extract<MidiProject['tracks'][number]['events'][number], { kind: 'cc' | 'program' | 'pitch-bend' | 'sysex' }>;
  const items: Item[] = [];
  project.tracks.forEach((track, ti) => {
    const port = portIndex(track.port);
    for (const e of [...track.events].sort(compareEvents)) {
      if (e.tick >= tick) break;
      if (e.kind === 'sysex') items.push({ tick: e.tick, ti, order: e.originOrder, port, channel: -1, e });
      else if (e.kind === 'cc' || e.kind === 'program' || e.kind === 'pitch-bend') items.push({ tick: e.tick, ti, order: e.originOrder, port, channel: e.channelOverride ?? track.channel, e });
    }
  });
  items.sort((a, b) => a.tick - b.tick || a.ti - b.ti || a.order - b.order);

  for (const { port, channel: ch, e } of items) {
    if (e.kind === 'sysex') {
      const data = base64ToBytes(e.dataBase64);
      if (data) sysex.push({ tick: e.tick, port, status: e.status, data });
      continue;
    }
    const s = state(port, ch);
    const key = chaseKey(port, ch);
    if (e.kind === 'program') s.program = e.program;
    else if (e.kind === 'pitch-bend') s.pitchBend = e.value;
    else {
      const c = e.controller;
      if (c === 0) s.bankMsb = e.value;
      else if (c === 32) s.bankLsb = e.value;
      else if (c === 101 || c === 100 || c === 99 || c === 98) {
        const isRpn = c === 101 || c === 100;
        const prev = selected.get(key);
        const [kind, msb, lsb] = prev ? prev.split(':') : [isRpn ? 'rpn' : 'nrpn', '127', '127'];
        const k = isRpn ? 'rpn' : 'nrpn';
        const nm = c === 101 || c === 99 ? e.value : kind === k ? Number(msb) : 127;
        const nl = c === 100 || c === 98 ? e.value : kind === k ? Number(lsb) : 127;
        selected.set(key, nm === 127 && nl === 127 ? null : `${k}:${nm}:${nl}`);
      } else if (c === 6 || c === 38) {
        const p = selected.get(key);
        if (p) {
          const v = s.parameters.get(p) ?? {};
          if (c === 6) v.msb = e.value;
          else v.lsb = e.value;
          s.parameters.set(p, v);
        }
      } else if (c === 121) {
        // Reset All Controllers (RP-015): controllers and pitch bend back to defaults
        s.controllers.clear();
        s.pitchBend = undefined;
      } else if (!SKIP_CC.has(c)) s.controllers.set(c, e.value);
    }
  }
  return { channels, sysex };
}

/** MIDI messages (status + data, 0-based channel) that recreate one channel's chased state. */
export function chaseMessages(s: ChannelChaseState): number[][] {
  const ch = s.channel;
  const out: number[][] = [];
  if (s.bankMsb !== undefined) out.push([0xb0 | ch, 0, s.bankMsb]);
  if (s.bankLsb !== undefined) out.push([0xb0 | ch, 32, s.bankLsb]);
  if (s.program !== undefined) out.push([0xc0 | ch, s.program]);
  for (const [c, v] of [...s.controllers].sort((a, b) => a[0] - b[0])) out.push([0xb0 | ch, c, v]);
  for (const [p, v] of s.parameters) {
    const [kind, msb, lsb] = p.split(':');
    const [selM, selL] = kind === 'rpn' ? [101, 100] : [99, 98];
    out.push([0xb0 | ch, selM, Number(msb)], [0xb0 | ch, selL, Number(lsb)]);
    if (v.msb !== undefined) out.push([0xb0 | ch, 6, v.msb]);
    if (v.lsb !== undefined) out.push([0xb0 | ch, 38, v.lsb]);
    out.push([0xb0 | ch, selM, 127], [0xb0 | ch, selL, 127]); // RPN null
  }
  if (s.pitchBend !== undefined) {
    const v = s.pitchBend + 8192;
    out.push([0xe0 | ch, v & 0x7f, v >> 7]);
  }
  return out;
}
