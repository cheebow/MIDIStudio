// MidiProject -> SMF Format 1 (MIDI_GS_SPEC 3). Track 0 is the conductor track; each MidiTrack
// becomes one MTrk. Same-tick order: see DECISIONS ADR-014.
import { base64ToBytes } from '../model/base64';
import { portIndex } from '../model/ports';
import { encodeUtf8 } from '../model/text';
import type { ConductorEvent, MidiEvent, MidiProject, MidiTrack, SourceText } from '../model/types';
import { compareEvents } from '../events/order';
import { writeSmf } from '../smf/writer';
import type { SmfEvent, SmfFile, SmfTrack } from '../smf/types';
import { t } from '../../i18n';

export interface ExportWarning {
  code: string;
  message: string;
  trackId?: string;
}

export interface ExportResult {
  smf: SmfFile;
  warnings: ExportWarning[];
}

/** Sort key: tick, group (-1 = generated Note Off, before everything else at that tick), order. */
interface Item {
  tick: number;
  group: number;
  order: number;
  seq: number;
  ev: SmfEvent;
}

function b64(s: string): Uint8Array {
  const bytes = base64ToBytes(s);
  if (!bytes) throw new Error('invalid base64 payload in project');
  return bytes;
}

function nameBytes(name: string, source?: SourceText): Uint8Array {
  return source && source.text === name ? b64(source.base64) : encodeUtf8(name);
}

function conductorToSmf(e: ConductorEvent): SmfEvent {
  switch (e.kind) {
    case 'tempo': {
      const us = e.usPerQuarter;
      return { kind: 'meta', tick: e.tick, metaType: 0x51, data: new Uint8Array([(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]) };
    }
    case 'time-signature':
      return {
        kind: 'meta',
        tick: e.tick,
        metaType: 0x58,
        data: new Uint8Array([e.numerator, Math.log2(e.denominator), e.clocksPerClick ?? 24, e.thirtySecondsPerQuarter ?? 8]),
      };
    case 'key-signature':
      return { kind: 'meta', tick: e.tick, metaType: 0x59, data: new Uint8Array([e.sharpsFlats & 0xff, e.minor ? 1 : 0]) };
    case 'marker':
      return { kind: 'meta', tick: e.tick, metaType: 0x06, data: e.rawBase64 ? b64(e.rawBase64) : encodeUtf8(e.text) };
  }
}

function finish(items: Item[], endOfTrackTick: number): SmfTrack {
  items.sort((a, b) => a.tick - b.tick || a.group - b.group || a.order - b.order || a.seq - b.seq);
  const last = items.length > 0 ? items[items.length - 1].tick : 0;
  return { events: items.map((i) => i.ev), endOfTrackTick: Math.max(last, endOfTrackTick) };
}

function trackToSmf(track: MidiTrack, warnings: ExportWarning[]): SmfTrack {
  const items: Item[] = [];
  let seq = 0;
  const push = (tick: number, group: number, order: number, ev: SmfEvent) => items.push({ tick, group, order, seq: seq++, ev });
  // Header events first at tick 0 (name, port prefix).
  if (track.name !== '') push(0, -3, 0, { kind: 'meta', tick: 0, metaType: 0x03, data: nameBytes(track.name, track.sourceName) });
  const port = portIndex(track.port);
  if (track.hasPortPrefix || port !== 0) push(0, -2, 0, { kind: 'meta', tick: 0, metaType: 0x21, data: new Uint8Array([port]) });

  const ch = (e: { channelOverride?: number }) => e.channelOverride ?? track.channel;
  let lastEnd = track.endOfTrackTick ?? 0;
  const events: MidiEvent[] = [...track.events].sort(compareEvents);
  for (const e of events) {
    switch (e.kind) {
      case 'note': {
        const c = ch(e);
        push(e.tick, 0, e.originOrder, { kind: 'channel', tick: e.tick, status: 0x90 | c, data: [e.pitch, e.velocity] });
        const off = e.tick + e.durationTicks;
        const offEv: SmfEvent =
          e.sourceEncoding === 'note-on-zero'
            ? { kind: 'channel', tick: off, status: 0x90 | c, data: [e.pitch, 0] }
            : { kind: 'channel', tick: off, status: 0x80 | c, data: [e.pitch, e.releaseVelocity] };
        if (e.releaseOrder !== undefined) push(off, 0, e.releaseOrder, offEv);
        else push(off, -1, e.originOrder, offEv);
        lastEnd = Math.max(lastEnd, off);
        break;
      }
      case 'cc':
        push(e.tick, 0, e.originOrder, { kind: 'channel', tick: e.tick, status: 0xb0 | ch(e), data: [e.controller, e.value] });
        break;
      case 'program':
        push(e.tick, 0, e.originOrder, { kind: 'channel', tick: e.tick, status: 0xc0 | ch(e), data: [e.program] });
        break;
      case 'pitch-bend': {
        const v = e.value + 8192;
        push(e.tick, 0, e.originOrder, { kind: 'channel', tick: e.tick, status: 0xe0 | ch(e), data: [v & 0x7f, (v >> 7) & 0x7f] });
        break;
      }
      case 'channel-pressure':
        push(e.tick, 0, e.originOrder, { kind: 'channel', tick: e.tick, status: 0xd0 | ch(e), data: [e.pressure] });
        break;
      case 'poly-pressure':
        push(e.tick, 0, e.originOrder, { kind: 'channel', tick: e.tick, status: 0xa0 | ch(e), data: [e.pitch, e.pressure] });
        break;
      case 'sysex':
        push(e.tick, 0, e.originOrder, { kind: 'sysex', tick: e.tick, status: e.status === 'F0' ? 0xf0 : 0xf7, data: b64(e.dataBase64) });
        break;
      case 'meta':
        push(e.tick, 0, e.originOrder, { kind: 'meta', tick: e.tick, metaType: e.metaType, data: b64(e.dataBase64) });
        break;
      case 'raw': {
        const bytes = b64(e.rawBase64);
        if (bytes.length >= 2 && bytes[0] >= 0x80 && bytes[0] < 0xf0) {
          push(e.tick, 0, e.originOrder, { kind: 'channel', tick: e.tick, status: bytes[0], data: [...bytes.subarray(1)] });
        } else {
          warnings.push({ code: 'W_EXPORT_RAW_SKIPPED', message: t('トラック「{name}」の Tick {tick}: 書き出せない形式の raw イベントがあります（{reason}）。', { name: track.name, tick: e.tick, reason: e.reason }), trackId: track.id });
        }
        break;
      }
    }
  }
  return finish(items, lastEnd);
}

export function projectToSmf(project: MidiProject): ExportResult {
  const warnings: ExportWarning[] = [];
  const conductorItems: Item[] = [];
  let seq = 0;
  if (project.title !== '') {
    conductorItems.push({ tick: 0, group: -3, order: 0, seq: seq++, ev: { kind: 'meta', tick: 0, metaType: 0x03, data: nameBytes(project.title, project.sourceTitle) } });
  }
  for (const m of project.conductorMeta) {
    conductorItems.push({ tick: m.tick, group: 0, order: m.originOrder, seq: seq++, ev: { kind: 'meta', tick: m.tick, metaType: m.metaType, data: b64(m.dataBase64) } });
  }
  for (const c of project.conductor) {
    conductorItems.push({ tick: c.tick, group: 0, order: c.originOrder, seq: seq++, ev: conductorToSmf(c) });
  }
  const tracks: SmfTrack[] = [finish(conductorItems, project.conductorEndOfTrackTick ?? 0)];
  for (const t of project.tracks) tracks.push(trackToSmf(t, warnings));
  return { smf: { format: 1, ppq: project.ppq, tracks }, warnings };
}

export function exportSmfBytes(project: MidiProject): { bytes: Uint8Array; warnings: ExportWarning[] } {
  const { smf, warnings } = projectToSmf(project);
  return { bytes: writeSmf(smf), warnings };
}
