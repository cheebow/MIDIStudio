// Standard MIDI File reader, Format 0/1 with PPQ division (MIDI_GS_SPEC 2).
// Structure adapted from MML Studio src/engine/smf-reader.ts (same author), rewritten to keep every
// event's bytes (SysEx payloads, unknown metas) instead of MML-oriented summaries.
import { decodeVlq } from './vlq';
import { SMF_LIMITS, type ImportIssue, type SmfEvent, type SmfReadResult, type SmfTrack } from './types';
import { t } from '../../i18n';

class ReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly byteOffset: number,
    readonly track?: number,
  ) {
    super(message);
  }
}

/** Data byte count of a channel voice message by status high nibble. */
export function channelDataLength(status: number): number {
  const hi = status & 0xf0;
  return hi === 0xc0 || hi === 0xd0 ? 1 : 2;
}

/** Strips a RIFF (RMID) or MacBinary container around an SMF. */
function unwrapContainer(bytes: Uint8Array, warnings: ImportIssue[]): Uint8Array {
  const at = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length >= 20 && at(0) === 'RIFF' && at(8) === 'RMID') {
    let p = 12;
    while (p + 8 <= bytes.length) {
      const len = (bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24)) >>> 0;
      if (at(p) === 'data') {
        warnings.push({ code: 'W_SMF_RMID', severity: 'warning', message: t('RIFF (RMID) 形式の中の SMF を読み込みました。'), byteOffset: p });
        return bytes.subarray(p + 8, Math.min(bytes.length, p + 8 + len));
      }
      p += 8 + len + (len & 1);
    }
    return bytes;
  }
  if (bytes.length > 142 && bytes[0] === 0 && bytes[1] >= 1 && bytes[1] <= 63 && at(128) === 'MThd') {
    const forkLength = ((bytes[83] << 24) | (bytes[84] << 16) | (bytes[85] << 8) | bytes[86]) >>> 0;
    warnings.push({ code: 'W_SMF_MACBINARY', severity: 'warning', message: t('MacBinary 形式のヘッダー（128 バイト）を取り除いて読み込みました。'), byteOffset: 0 });
    const endFork = forkLength > 0 && 128 + forkLength <= bytes.length ? 128 + forkLength : bytes.length;
    return bytes.subarray(128, endFork);
  }
  return bytes;
}

interface TrackParse {
  track: SmfTrack;
  pos: number;
  sawEot: boolean;
  eventCount: number;
  runningAfterMeta: number;
}

export function readSmf(input: Uint8Array): SmfReadResult {
  if (input.byteLength > SMF_LIMITS.maxBytes) {
    return fail('E_SMF_TOO_LARGE', t('MIDI ファイルが大きすぎます（{bytes} バイト、上限 {maxMiB} MiB）。', { bytes: input.byteLength, maxMiB: SMF_LIMITS.maxBytes / 1024 / 1024 }), 0);
  }
  const warnings: ImportIssue[] = [];
  const bytes = unwrapContainer(input, warnings);
  try {
    const ascii = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    const u32 = (o: number) => ((bytes[o] << 24) >>> 0) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3];
    const u16 = (o: number) => (bytes[o] << 8) | bytes[o + 1];

    if (bytes.length < 14 || ascii(0) !== 'MThd') {
      throw new ReadError('E_SMF_HEADER', t('SMF ではありません（先頭に MThd ヘッダーがありません）。'), 0);
    }
    const headerLength = u32(4);
    if (headerLength < 6 || 8 + headerLength > bytes.length) {
      throw new ReadError('E_SMF_HEADER', t('MThd ヘッダー長が不正です（{len}）。', { len: headerLength }), 4);
    }
    const format = u16(8);
    const ntrks = u16(10);
    const division = u16(12);
    if (format === 2) {
      throw new ReadError(
        'E_SMF_FORMAT2',
        t('SMF Format 2（独立した複数のシーケンスを持つ形式）には対応していません。Format 2 は曲として1本の時間軸に並べられないため、初版では読み込みを中止しました。現在のプロジェクトは変更されていません。'),
        8,
      );
    }
    if (format !== 0 && format !== 1) {
      throw new ReadError('E_SMF_FORMAT', t('未知の SMF フォーマット {format} です。', { format }), 8);
    }
    if (division & 0x8000) {
      throw new ReadError(
        'E_SMF_SMPTE',
        t('SMPTE 形式の時間単位（タイムコード）の MIDI には対応していません。テンポに依存しない時間単位で、拍・小節単位の編集に変換すると精度が落ちるため、初版では読み込みを中止しました。四分音符単位（PPQ）の MIDI を使ってください。'),
        12,
      );
    }
    const ppq = division;
    if (ppq === 0) throw new ReadError('E_SMF_HEADER', t('PPQ（四分音符あたりの Tick 数）が 0 です。'), 12);
    if (ntrks === 0) throw new ReadError('E_SMF_HEADER', t('トラック数が 0 です。'), 10);
    if (ntrks > SMF_LIMITS.maxTracks) throw new ReadError('E_SMF_TOO_MANY_TRACKS', t('トラック数が上限（{max}）を超えています。', { max: SMF_LIMITS.maxTracks }), 10);
    if (format === 0 && ntrks !== 1) {
      warnings.push({ code: 'W_SMF_FORMAT0_TRACKS', severity: 'warning', message: t('SMF Format 0 なのにトラック数が {ntrks} です。すべてのトラックを読み込みます。', { ntrks }), byteOffset: 10 });
    }

    let totalEvents = 0;

    const parseTrack = (start: number, limit: number, trackIndex: number): TrackParse => {
      const events: SmfEvent[] = [];
      let q = start;
      let tick = 0;
      let running = 0;
      let lastChannelStatus = 0;
      let sawEot = false;
      let eotTick = 0;
      let localEvents = 0;
      let runningAfterMeta = 0;

      const need = (n: number, what: string) => {
        if (q + n > limit) throw new ReadError('E_SMF_TRUNCATED_EVENT', t('{what} の途中で MTrk が終わっています。', { what }), q, trackIndex);
      };
      const readVlq = (what: string) => {
        const r = decodeVlq(bytes, q, limit);
        if (!r.ok) {
          if (r.reason === 'truncated') throw new ReadError('E_SMF_TRUNCATED_EVENT', t('{what} の途中で MTrk が終わっています。', { what }), q, trackIndex);
          throw new ReadError('E_SMF_VLQ', t('{what} の可変長数値（VLQ）が4バイトを超えています（破損）。', { what }), q, trackIndex);
        }
        q += r.length;
        return r.value;
      };
      const dataByte = (what: string) => {
        need(1, what);
        const b = bytes[q];
        if (b & 0x80) throw new ReadError('E_SMF_DATA', t('{what} のデータバイトが不正です（0x{hex}）。', { what, hex: b.toString(16) }), q, trackIndex);
        q++;
        return b;
      };

      while (q < limit && !sawEot) {
        if (totalEvents + ++localEvents > SMF_LIMITS.maxEvents) {
          throw new ReadError('E_SMF_TOO_MANY_EVENTS', t('MIDI イベント数が上限（{max}）を超えています。', { max: SMF_LIMITS.maxEvents }), q, trackIndex);
        }
        tick += readVlq(t('デルタタイム'));
        if (tick > SMF_LIMITS.maxTick) throw new ReadError('E_SMF_TICK', t('Tick が上限（{max}）を超えています（破損の可能性）。', { max: SMF_LIMITS.maxTick }), q, trackIndex);
        need(1, t('イベント'));
        const at = q;
        let status = bytes[q];
        if (status & 0x80) {
          q++;
        } else if (running !== 0) {
          status = running;
        } else if (lastChannelStatus !== 0) {
          // Strictly, meta / SysEx cancel running status, but many files keep using it.
          status = lastChannelStatus;
          runningAfterMeta++;
        } else {
          throw new ReadError('E_SMF_RUNNING_STATUS', t('ランニングステータスの前にステータスバイトがありません（破損）。'), q, trackIndex);
        }
        if (status === 0xff) {
          running = 0;
          need(1, t('メタイベント'));
          const metaType = bytes[q++];
          if (metaType & 0x80) throw new ReadError('E_SMF_META', t('メタイベントの種類 0x{hex} が不正です。', { hex: metaType.toString(16) }), at, trackIndex);
          const len = readVlq(t('メタイベント長'));
          if (len > SMF_LIMITS.maxMetaOrSysExBytes) throw new ReadError('E_SMF_META_TOO_LARGE', t('メタイベントが大きすぎます（{len} バイト）。', { len }), at, trackIndex);
          need(len, t('メタイベント'));
          const data = bytes.slice(q, q + len);
          q += len;
          if (metaType === 0x2f) {
            sawEot = true;
            eotTick = tick;
          } else {
            // a malformed tempo (length not 3, or 0 µs) is passed on: the importer keeps it as a raw
            // meta with a warning instead of refusing the whole file (ADR-087)
            events.push({ kind: 'meta', tick, metaType, data });
          }
          continue;
        }
        if (status === 0xf0 || status === 0xf7) {
          running = 0;
          const len = readVlq(t('SysEx 長'));
          if (len > SMF_LIMITS.maxMetaOrSysExBytes) throw new ReadError('E_SMF_SYSEX_TOO_LARGE', t('SysEx が大きすぎます（{len} バイト、上限 {max}）。', { len, max: SMF_LIMITS.maxMetaOrSysExBytes }), at, trackIndex);
          need(len, 'SysEx');
          events.push({ kind: 'sysex', tick, status, data: bytes.slice(q, q + len) });
          q += len;
          continue;
        }
        if (status >= 0xf1) {
          throw new ReadError('E_SMF_STATUS', t('MTrk 内に使えないステータスバイト 0x{hex} があります（破損）。', { hex: status.toString(16) }), at, trackIndex);
        }
        running = status;
        lastChannelStatus = status;
        const n = channelDataLength(status);
        const data = n === 1 ? [dataByte(t('チャンネルメッセージ'))] : [dataByte(t('チャンネルメッセージ')), dataByte(t('チャンネルメッセージ'))];
        events.push({ kind: 'channel', tick, status, data });
      }
      return {
        track: { events, endOfTrackTick: sawEot ? eotTick : tick },
        pos: q,
        sawEot,
        eventCount: localEvents,
        runningAfterMeta,
      };
    };

    const tracks: SmfTrack[] = [];
    let p = 8 + headerLength;
    while (tracks.length < ntrks) {
      if (p + 8 > bytes.length) {
        throw new ReadError('E_SMF_TRUNCATED', t('ヘッダーでは {ntrks} トラックですが、{found} トラックでファイルが終わっています。', { ntrks, found: tracks.length }), p);
      }
      const type = ascii(p);
      const len = u32(p + 4);
      const dataStart = p + 8;
      const end = dataStart + len;
      if (type !== 'MTrk') {
        if (end > bytes.length) {
          throw new ReadError('E_SMF_CHUNK_LENGTH', t('チャンク "{type}" の長さ（{len}）がファイルの残りを超えています。', { type: printable(type), len }), p + 4);
        }
        warnings.push({ code: 'W_SMF_UNKNOWN_CHUNK', severity: 'warning', message: t('未知のチャンク "{type}"（{len} バイト）は MIDI Studio では扱えないため読み飛ばしました。書き出しには含まれません。', { type: printable(type), len }), byteOffset: p });
        p = end;
        continue;
      }
      const trackIndex = tracks.length;
      // A wrong MTrk length is recovered only when the track, read to its End of Track, is
      // immediately followed by the next MTrk header or by the end of the file.
      const recover = (original: ReadError): { parsed: TrackParse; next: number } => {
        let alt: TrackParse;
        try {
          alt = parseTrack(dataStart, bytes.length, trackIndex);
        } catch {
          throw original;
        }
        const followedOk = alt.pos === bytes.length || (alt.pos + 4 <= bytes.length && ascii(alt.pos) === 'MTrk');
        if (!alt.sawEot || !followedOk) throw original;
        warnings.push({
          code: 'W_SMF_CHUNK_LENGTH_FIXED',
          severity: 'warning',
          message: t('MTrk {track} のチャンク長（{len}）が実際のデータ（{actual} バイト）と合わないため、End of Track までを読み込みました。', { track: trackIndex + 1, len, actual: alt.pos - dataStart }),
          track: trackIndex,
          byteOffset: p + 4,
        });
        return { parsed: alt, next: alt.pos };
      };
      let parsed: TrackParse;
      let next: number;
      if (end > bytes.length) {
        ({ parsed, next } = recover(new ReadError('E_SMF_CHUNK_LENGTH', t('チャンク "MTrk" の長さ（{len}）がファイルの残りを超えています。', { len }), p + 4, trackIndex)));
      } else {
        try {
          parsed = parseTrack(dataStart, end, trackIndex);
          next = end;
        } catch (e) {
          if (!(e instanceof ReadError) || e.code !== 'E_SMF_TRUNCATED_EVENT') throw e;
          ({ parsed, next } = recover(e));
        }
      }
      if (parsed.sawEot && parsed.pos < next) {
        warnings.push({ code: 'W_SMF_AFTER_EOT', severity: 'warning', message: t('MTrk {track}: End of Track の後のデータ（{bytes} バイト）を無視しました。', { track: trackIndex + 1, bytes: next - parsed.pos }), track: trackIndex, byteOffset: parsed.pos });
      }
      if (!parsed.sawEot) {
        warnings.push({ code: 'W_SMF_NO_EOT', severity: 'warning', message: t('MTrk {track} に End of Track がありません（チャンク末尾を終端とみなしました）。', { track: trackIndex + 1 }), track: trackIndex, byteOffset: next });
      }
      if (parsed.runningAfterMeta > 0) {
        warnings.push({
          code: 'W_SMF_RUNNING_AFTER_META',
          severity: 'warning',
          message: t('MTrk {track}: メタイベント／SysEx の後でランニングステータスが使われていました（{count} 箇所）。直前のチャンネルステータスとして読み込みました。', { track: trackIndex + 1, count: parsed.runningAfterMeta }),
          track: trackIndex,
        });
      }
      totalEvents += parsed.eventCount;
      tracks.push(parsed.track);
      p = next;
    }
    if (p < bytes.length) {
      warnings.push({ code: 'W_SMF_TRAILING', severity: 'warning', message: t('最後のトラックの後のデータ（{bytes} バイト）を無視しました。', { bytes: bytes.length - p }), byteOffset: p });
    }
    return { ok: true, smf: { format: format as 0 | 1, ppq, tracks }, warnings, byteLength: input.byteLength };
  } catch (e) {
    if (e instanceof ReadError) {
      const where = e.track !== undefined ? t('MTrk {track}、', { track: e.track + 1 }) : '';
      return fail(e.code, t('{message}（{where}バイト位置 {offset}）', { message: e.message, where, offset: e.byteOffset }), e.byteOffset, e.track);
    }
    throw e;
  }
}

function printable(s: string): string {
  return [...s].map((c) => (c >= ' ' && c <= '~' ? c : '?')).join('');
}

function fail(code: string, message: string, byteOffset: number, track?: number): SmfReadResult {
  return { ok: false, errors: [{ code, severity: 'error', message, byteOffset, track }] };
}
