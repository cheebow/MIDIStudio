// SMF (low-level SmfFile) -> MidiProject. Nothing is dropped silently (CLAUDE.md rule 3):
// every channel message, SysEx and meta event ends up as a model event, a conductor event, a
// track property that is re-exported, or a RawMidiEvent; each lossy or ambiguous case is reported.
import { bytesToBase64 } from '../model/base64';
import { defaultInputPresets, defaultViewSettings, TRACK_COLORS } from '../model/defaults';
import { newId } from '../model/ids';
import { maxOf } from '../model/numbers';
import { portLabel } from '../model/ports';
import { decodeMetaText, type TextDecodeFn } from '../model/text';
import type {
  ConductorEvent,
  MidiClip,
  MidiEvent,
  MidiProject,
  MidiTrack,
  RawReason,
  SourceText,
  TrackMetaEvent,
} from '../model/types';
import { sortEvents } from '../events/order';
import type { ImportIssue, SmfEvent, SmfFile } from '../smf/types';
import { t } from '../../i18n';

export interface ImportOptions {
  title?: string;
  /** Fallback decoder for non-UTF-8 text metas (the app passes Shift_JIS via TextDecoder). */
  decodeText?: TextDecodeFn;
}

export interface ImportResult {
  project: MidiProject;
  issues: ImportIssue[];
}

/** Meta types moved to the conductor (tempo map / time signature / key / marker). */
const CONDUCTOR_META = new Set([0x51, 0x58, 0x59, 0x06]);

interface Ctx {
  issues: ImportIssue[];
  order: () => number;
  decode?: TextDecodeFn;
}

function text(data: Uint8Array, decode?: TextDecodeFn): { name: string; source?: SourceText } {
  const r = decodeMetaText(data, decode);
  return r.exact ? { name: r.text } : { name: r.text, source: { text: r.text, base64: bytesToBase64(data) } };
}

/** Converts a conductor meta; returns null (with an issue) when the payload is malformed. */
function toConductor(e: Extract<SmfEvent, { kind: 'meta' }>, order: number, ctx: Ctx, track: number): ConductorEvent | null {
  const d = e.data;
  const id = newId('evt');
  switch (e.metaType) {
    case 0x51: {
      const us = (d[0] << 16) | (d[1] << 8) | d[2];
      if (d.length !== 3 || us === 0) break;
      return { id, kind: 'tempo', tick: e.tick, usPerQuarter: us, originOrder: order };
    }
    case 0x58:
      if (d.length < 2 || d[1] > 7 || d[0] === 0) break;
      return {
        id,
        kind: 'time-signature',
        tick: e.tick,
        numerator: d[0],
        denominator: 2 ** d[1],
        ...(d.length >= 4 ? { clocksPerClick: d[2], thirtySecondsPerQuarter: d[3] } : {}),
        originOrder: order,
      };
    case 0x59: {
      const sf = d[0] > 127 ? d[0] - 256 : d[0];
      if (d.length !== 2 || d[1] > 1 || sf < -7 || sf > 7) break; // kept as a raw meta (validateProject only accepts -7..7)
      return { id, kind: 'key-signature', tick: e.tick, sharpsFlats: sf, minor: d[1] === 1, originOrder: order };
    }
    case 0x06: {
      const t = text(d, ctx.decode);
      return { id, kind: 'marker', tick: e.tick, text: t.name, ...(t.source ? { rawBase64: t.source.base64 } : {}), originOrder: order };
    }
  }
  ctx.issues.push({
    code: 'W_IMPORT_BAD_CONDUCTOR_META',
    severity: 'warning',
    message: t('MTrk {track} の Tick {tick}: メタイベント FF {type} の内容が不正なため、解釈せずにそのまま保持しました。', { track: track + 1, tick: e.tick, type: hex(e.metaType) }),
    track,
    tick: e.tick,
  });
  return null;
}

function hex(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0');
}

function metaEvent(e: Extract<SmfEvent, { kind: 'meta' }>, order: number): TrackMetaEvent {
  return { id: newId('evt'), kind: 'meta', tick: e.tick, metaType: e.metaType, dataBase64: bytesToBase64(e.data), originOrder: order };
}

/** Builds track events from channel messages, pairing Note On/Off per channel+pitch (FIFO). */
class TrackBuilder {
  readonly events: MidiEvent[] = [];
  /**
   * Open Note Ons per channel+pitch, a FIFO read from `head`: Array.shift() is O(n), and a crafted
   * file of many stacked Note Ons would make the import quadratic (minutes for a 2 MB file, ADR-087).
   */
  private open = new Map<number, { items: { tick: number; velocity: number; order: number; bytes: number[] }[]; head: number }>();
  overlaps = 0;
  zeroLength = 0;
  unpairedOff = 0;

  constructor(
    readonly channel: number,
    private readonly ctx: Ctx,
  ) {}

  private raw(tick: number, order: number, bytes: number[], reason: RawReason) {
    this.events.push({ id: newId('evt'), kind: 'raw', tick, rawBase64: bytesToBase64(bytes), reason, originOrder: order });
  }

  private chan(ch: number) {
    return ch === this.channel ? {} : { channelOverride: ch };
  }

  add(e: Extract<SmfEvent, { kind: 'channel' }>, order: number) {
    const ch = e.status & 0x0f;
    const hi = e.status & 0xf0;
    const [a, b] = e.data;
    const id = newId('evt');
    const tick = e.tick;
    switch (hi) {
      case 0x90:
        if (b > 0) {
          const key = ch * 128 + a;
          const q = this.open.get(key) ?? { items: [], head: 0 };
          if (q.items.length > q.head) this.overlaps++;
          q.items.push({ tick, velocity: b, order, bytes: [e.status, a, b] });
          this.open.set(key, q);
        } else {
          this.noteOff(tick, order, e.status, a, b); // velocity 0 = Note Off
        }
        return;
      case 0x80:
        this.noteOff(tick, order, e.status, a, b);
        return;
      case 0xa0:
        this.events.push({ id, kind: 'poly-pressure', tick, pitch: a, pressure: b, originOrder: order, ...this.chan(ch) });
        return;
      case 0xb0:
        this.events.push({ id, kind: 'cc', tick, controller: a, value: b, originOrder: order, ...this.chan(ch) });
        return;
      case 0xc0:
        this.events.push({ id, kind: 'program', tick, program: a, originOrder: order, ...this.chan(ch) });
        return;
      case 0xd0:
        this.events.push({ id, kind: 'channel-pressure', tick, pressure: a, originOrder: order, ...this.chan(ch) });
        return;
      case 0xe0:
        this.events.push({ id, kind: 'pitch-bend', tick, value: ((b << 7) | a) - 8192, originOrder: order, ...this.chan(ch) });
        return;
    }
  }

  private noteOff(tick: number, order: number, status: number, pitch: number, velocity: number) {
    const ch = status & 0x0f;
    const q = this.open.get(ch * 128 + pitch);
    const on = q && q.head < q.items.length ? q.items[q.head++] : undefined;
    if (q && q.head === q.items.length) {
      q.items.length = 0;
      q.head = 0;
    }
    if (!on) {
      this.unpairedOff++;
      this.raw(tick, order, [status, pitch, velocity], 'unpaired-note-off');
      return;
    }
    if (on.tick === tick) {
      this.zeroLength++;
      this.raw(on.tick, on.order, on.bytes, 'zero-length-note');
      this.raw(tick, order, [status, pitch, velocity], 'zero-length-note');
      return;
    }
    this.events.push({
      id: newId('evt'),
      kind: 'note',
      tick: on.tick,
      pitch,
      velocity: on.velocity,
      durationTicks: tick - on.tick,
      releaseVelocity: velocity,
      sourceEncoding: (status & 0xf0) === 0x90 ? 'note-on-zero' : 'note-off',
      releaseOrder: order,
      originOrder: on.order,
      ...this.chan(ch),
    });
  }

  /** Closes the track: unterminated Note Ons are kept as raw events. Returns sorted events. */
  finish(trackLabel: string, trackIndex: number): MidiEvent[] {
    let unterminated = 0;
    for (const q of this.open.values()) {
      for (const on of q.items.slice(q.head)) {
        unterminated++;
        this.raw(on.tick, on.order, on.bytes, 'unpaired-note-on');
      }
    }
    const issues = this.ctx.issues;
    if (this.overlaps > 0) {
      issues.push({
        code: 'W_IMPORT_NOTE_OVERLAP',
        severity: 'warning',
        message: t('{track}: 同じチャンネル・音高の Note On が Note Off の前に重なっていました（{n} 箇所）。古い Note On から順に Note Off と対応付けました。書き出し時の Note On/Off の位置は変わりません。', { track: trackLabel, n: this.overlaps }),
        track: trackIndex,
      });
    }
    if (this.zeroLength > 0) {
      issues.push({
        code: 'W_IMPORT_ZERO_LENGTH_NOTE',
        severity: 'warning',
        message: t('{track}: 長さ 0 のノート（同じ Tick の Note On/Off）が {n} 個ありました。ノートとしては編集できないため、元のメッセージのまま保持しました。', { track: trackLabel, n: this.zeroLength }),
        track: trackIndex,
      });
    }
    if (this.unpairedOff > 0) {
      issues.push({
        code: 'W_IMPORT_UNPAIRED_NOTE_OFF',
        severity: 'warning',
        message: t('{track}: 対応する Note On のない Note Off が {n} 個ありました。元のメッセージのまま保持しました。', { track: trackLabel, n: this.unpairedOff }),
        track: trackIndex,
      });
    }
    if (unterminated > 0) {
      issues.push({
        code: 'W_IMPORT_UNPAIRED_NOTE_ON',
        severity: 'warning',
        message: t('{track}: Note Off のない Note On が {n} 個ありました。元のメッセージのまま保持しました（音源によっては鳴り続けます）。', { track: trackLabel, n: unterminated }),
        track: trackIndex,
      });
    }
    return sortEvents(this.events);
  }
}

function mostCommonChannel(events: readonly SmfEvent[]): number {
  const counts = new Array<number>(16).fill(0);
  for (const e of events) if (e.kind === 'channel') counts[e.status & 0x0f]++;
  let best = 0;
  for (let c = 1; c < 16; c++) if (counts[c] > counts[best]) best = c;
  return best;
}

function hasPlayableEvents(events: readonly SmfEvent[]): boolean {
  return events.some((e) => e.kind === 'channel' || e.kind === 'sysex');
}

export function importSmf(smf: SmfFile, readerWarnings: readonly ImportIssue[] = [], options: ImportOptions = {}): ImportResult {
  let counter = 0;
  const ctx: Ctx = { issues: [...readerWarnings], order: () => counter++, decode: options.decodeText };
  const conductor: ConductorEvent[] = [];
  const conductorMeta: TrackMetaEvent[] = [];
  const tracks: MidiTrack[] = [];
  let title = options.title ?? '';
  let sourceTitle: SourceText | undefined;
  let conductorEnd: number | undefined;
  const movedConductor = new Set<number>();

  // malformed conductor metas already reported (Format 0 looks at them twice: System list, then System track)
  const badConductor = new WeakSet<SmfEvent>();
  const takeConductor = (e: Extract<SmfEvent, { kind: 'meta' }>, order: number, trackIndex: number): boolean => {
    if (!CONDUCTOR_META.has(e.metaType) || badConductor.has(e)) return false;
    const c = toConductor(e, order, ctx, trackIndex);
    if (!c) {
      badConductor.add(e);
      return false;
    }
    conductor.push(c);
    return true;
  };

  // Format 1, track 0 without channel / SysEx events is the conductor track.
  let firstMusicTrack = 0;
  // A Format 0 file with several MTrk chunks (malformed) is read like Format 1, so no track is lost
  // (the reader warns W_SMF_FORMAT0_TRACKS, ADR-087).
  const multiTrack = smf.format === 1 || smf.tracks.length > 1;
  if (multiTrack && smf.tracks.length > 0 && !hasPlayableEvents(smf.tracks[0].events)) {
    firstMusicTrack = 1;
    const t0 = smf.tracks[0];
    conductorEnd = t0.endOfTrackTick;
    let named = false;
    for (const e of t0.events) {
      const order = ctx.order();
      if (e.kind !== 'meta') continue; // (no channel/SysEx here by construction)
      if (takeConductor(e, order, 0)) continue;
      if (e.metaType === 0x03 && !named && e.tick === 0) {
        named = true;
        const t = text(e.data, ctx.decode);
        if (!options.title) title = t.name;
        sourceTitle = t.source;
        continue;
      }
      conductorMeta.push(metaEvent(e, order));
    }
  }

  const convertTrack = (events: readonly SmfEvent[], trackIndex: number, endOfTrackTick: number, channel: number, fallbackName: string): MidiTrack => {
    const builder = new TrackBuilder(channel, ctx);
    let name: { name: string; source?: SourceText } | null = null;
    let port: number | null = null;
    let sawMusic = false;
    let portChanges = 0;
    for (const e of events) {
      const order = ctx.order();
      if (e.kind === 'channel') {
        sawMusic = true;
        builder.add(e, order);
      } else if (e.kind === 'sysex') {
        sawMusic = true;
        builder.events.push({
          id: newId('evt'),
          kind: 'sysex',
          tick: e.tick,
          status: e.status === 0xf0 ? 'F0' : 'F7',
          dataBase64: bytesToBase64(e.data),
          originOrder: order,
        });
      } else if (takeConductor(e, order, trackIndex)) {
        movedConductor.add(trackIndex);
      } else if (e.metaType === 0x03 && name === null && e.tick === 0) {
        name = text(e.data, ctx.decode);
      } else if (e.metaType === 0x21 && e.data.length === 1 && e.data[0] < 128 && port === null && !sawMusic) {
        port = e.data[0];
      } else {
        if (e.metaType === 0x21) portChanges++;
        builder.events.push(metaEvent(e, order));
      }
    }
    const label = `MTrk ${trackIndex + 1}`;
    if (portChanges > 0) {
      ctx.issues.push({
        code: 'W_IMPORT_PORT_CHANGE',
        severity: 'warning',
        message: t('{track}: 演奏の途中にポート指定（FF 21）が {n} 個ありました。イベントとして保持し書き出しますが、MIDI Studio の再生・編集ではトラック先頭のポートを使います。', { track: label, n: portChanges }),
        track: trackIndex,
      });
    }
    const n: { name: string; source?: SourceText } = name ?? { name: fallbackName };
    return {
      id: newId('trk'),
      name: n.name,
      ...(n.source ? { sourceName: n.source } : {}),
      color: TRACK_COLORS[tracks.length % TRACK_COLORS.length],
      port: portLabel(port ?? 0),
      ...(port !== null ? { hasPortPrefix: true } : {}),
      channel,
      displayMode: channel === 9 ? 'drum' : 'melodic',
      mute: false,
      solo: false,
      events: builder.finish(label, trackIndex),
      endOfTrackTick,
      sourceSmfTrack: trackIndex,
    };
  };

  if (multiTrack) {
    for (let i = firstMusicTrack; i < smf.tracks.length; i++) {
      const t = smf.tracks[i];
      tracks.push(convertTrack(t.events, i, t.endOfTrackTick, mostCommonChannel(t.events), `Track ${tracks.length + 1}`));
    }
  } else {
    // Format 0: split channel messages into one track per channel (ADR-015). SysEx and
    // non-conductor metas go to a leading "System" track so they stay ahead of channel events
    // at the same tick on export.
    const t0 = smf.tracks[0];
    const byChannel = new Map<number, SmfEvent[]>();
    const system: SmfEvent[] = [];
    const orders = new Map<SmfEvent, number>();
    // Pre-assign file order so split tracks keep the global source order.
    const base = counter;
    t0.events.forEach((e, i) => orders.set(e, base + i));
    for (const e of t0.events) {
      if (e.kind === 'channel') {
        const ch = e.status & 0x0f;
        const list = byChannel.get(ch) ?? [];
        list.push(e);
        byChannel.set(ch, list);
      } else system.push(e);
    }
    let nameFromTrack: { name: string; source?: SourceText } | null = null;
    // Conductor metas and the first track name are taken from the system list.
    const systemRest: SmfEvent[] = [];
    const midPorts: SmfEvent[] = [];
    let port: number | null = null;
    for (const e of system) {
      const order = orders.get(e)!;
      if (e.kind === 'meta' && takeConductor(e, order, 0)) continue;
      if (e.kind === 'meta' && e.metaType === 0x03 && nameFromTrack === null && e.tick === 0) {
        nameFromTrack = text(e.data, ctx.decode);
        continue;
      }
      if (e.kind === 'meta' && e.metaType === 0x21 && port === null && e.data.length === 1 && e.data[0] < 128 && e.tick === 0) {
        port = e.data[0];
        continue;
      }
      if (e.kind === 'meta' && e.metaType === 0x21) {
        // A port change during the song applies to the channel events after it: each channel track
        // gets it at the same tick, so the export sends them to the same port (ADR-087). In the
        // System track it would become that track's own port prefix and the change would be lost.
        midPorts.push(e);
        continue;
      }
      systemRest.push(e);
    }
    if (byChannel.size === 0) systemRest.push(...midPorts); // no channel track to carry them: kept as events, never dropped
    else systemRest.sort((a, b) => orders.get(a)! - orders.get(b)!);
    for (const [ch, list] of byChannel) {
      if (midPorts.length === 0) break;
      const copies = midPorts.map((e) => {
        const c = { ...e };
        orders.set(c, orders.get(e)!);
        return c;
      });
      byChannel.set(ch, [...list, ...copies].sort((a, b) => orders.get(a)! - orders.get(b)!));
    }
    if (nameFromTrack && !options.title) {
      title = nameFromTrack.name;
      sourceTitle = nameFromTrack.source;
    }
    const withOrder = (list: SmfEvent[], fn: () => MidiTrack): MidiTrack => {
      // convertTrack draws orders from ctx.order(); temporarily serve the pre-assigned ones.
      const queue = list.map((e) => orders.get(e)!);
      const saved = ctx.order;
      let k = 0;
      ctx.order = () => queue[k++];
      try {
        return fn();
      } finally {
        ctx.order = saved;
      }
    };
    if (systemRest.length > 0) {
      const tr = withOrder(systemRest, () => convertTrack(systemRest, 0, t0.endOfTrackTick, 0, 'System'));
      if (port !== null) {
        tr.port = portLabel(port);
        tr.hasPortPrefix = true;
      }
      tracks.push(tr);
    }
    for (const ch of [...byChannel.keys()].sort((a, b) => a - b)) {
      const list = byChannel.get(ch)!;
      const tr = withOrder(list, () => convertTrack(list, 0, t0.endOfTrackTick, ch, `Ch ${ch + 1}`));
      if (port !== null) {
        tr.port = portLabel(port);
        tr.hasPortPrefix = true;
      }
      tracks.push(tr);
    }
    counter = base + t0.events.length;
    conductorEnd = t0.endOfTrackTick;
    ctx.issues.push({
      code: 'I_IMPORT_FORMAT0_SPLIT',
      severity: 'info',
      message: t('SMF Format 0 をチャンネルごとに {n} トラックへ分けました{system}。書き出しは Format 1 です。', { n: byChannel.size, system: systemRest.length > 0 ? t('（SysEx・メタイベントは「System」トラック）') : '' }),
    });
  }

  if (movedConductor.size > 0) {
    ctx.issues.push({
      code: 'I_IMPORT_CONDUCTOR_MERGED',
      severity: 'info',
      message: t('テンポ・拍子・調・マーカーをテンポトラックにまとめました（元の MTrk: {tracks}）。', { tracks: [...movedConductor].map((i) => i + 1).join(', ') }),
    });
  }
  const sortedConductor = sortEvents(conductor);
  reportConductorConflicts(sortedConductor, ctx.issues);

  const clips: MidiClip[] = tracks.filter((t) => t.events.length > 0).map((t) => clipForTrack(t));
  let lastTick = maxOf(tracks, (t) => t.endOfTrackTick ?? 0, 0);
  for (const t of tracks) lastTick = Math.max(lastTick, maxOf(t.events, (e) => (e.kind === 'note' ? e.tick + e.durationTicks : e.tick), 0));
  const project: MidiProject = {
    schemaVersion: 1,
    id: newId('prj'),
    title: title || t('無題'),
    ppq: smf.ppq,
    conductor: sortedConductor,
    conductorMeta,
    tracks,
    clips,
    loop: { enabled: false, startTick: 0, endTick: Math.max(lastTick, smf.ppq * 4) },
    // start on the first track that has notes (a file often opens with an empty conductor-only MTrk)
    settings: { ...defaultViewSettings(smf.ppq), selectedTrackId: (tracks.find((t) => t.events.some((e) => e.kind === 'note')) ?? tracks[0])?.id },
    inputPresets: defaultInputPresets(),
    nextOriginOrder: counter,
    ...(conductorEnd !== undefined ? { conductorEndOfTrackTick: conductorEnd } : {}),
    ...(sourceTitle ? { sourceTitle } : {}),
  };
  if (smf.format === 1 && firstMusicTrack === 0) {
    ctx.issues.push({
      code: 'I_IMPORT_NO_CONDUCTOR_TRACK',
      severity: 'info',
      message: t('MTrk 1 に演奏データがあるため、テンポトラックとしてではなく通常のトラックとして読み込みました。'),
    });
  }
  return { project, issues: ctx.issues };
}

export function clipForTrack(t: MidiTrack): MidiClip {
  let start = Infinity;
  let end = 0;
  for (const e of t.events) {
    start = Math.min(start, e.tick);
    end = Math.max(end, e.kind === 'note' ? e.tick + e.durationTicks : e.tick);
  }
  if (start === Infinity) start = 0;
  return { id: newId('clp'), trackId: t.id, startTick: start, endTick: Math.max(end, start + 1), eventIds: t.events.map((e) => e.id) };
}

function reportConductorConflicts(events: readonly ConductorEvent[], issues: ImportIssue[]) {
  const seen = new Map<string, ConductorEvent>();
  let conflicts = 0;
  for (const e of events) {
    if (e.kind !== 'tempo' && e.kind !== 'time-signature') continue;
    const key = `${e.kind}@${e.tick}`;
    const prev = seen.get(key);
    if (prev && JSON.stringify({ ...prev, id: 0, originOrder: 0 }) !== JSON.stringify({ ...e, id: 0, originOrder: 0 })) conflicts++;
    seen.set(key, e);
  }
  if (conflicts > 0) {
    issues.push({
      code: 'W_IMPORT_CONDUCTOR_CONFLICT',
      severity: 'warning',
      message: t('同じ Tick に異なるテンポまたは拍子が {n} 箇所ありました。すべて保持し、ファイル内の順序で後のものが有効になります。', { n: conflicts }),
    });
  }
}
