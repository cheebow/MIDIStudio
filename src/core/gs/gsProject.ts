// Project-level GS helpers: rhythm part detection (REQ-EDT-08), GS Reset insertion, value edits.
import { base64ToBytes, bytesToBase64 } from '../model/base64';
import { newId } from '../model/ids';
import type { MidiProject, SysExEvent } from '../model/types';
import type { Command } from '../editing/history';
import { EditError } from '../editing/operations';
import { sortEvents } from '../events/order';
import { decodeGs, encodeGsDt1, gsResetPayload } from './gsSysex';
import { t } from '../../i18n';

/** Channels set as rhythm parts by "Use for Rhythm Part" (value > 0) anywhere in the song. */
export function gsRhythmChannels(project: MidiProject): Map<string, number> {
  // Settings from several tracks apply in playback order (tick, track, order), so the latest one
  // in time wins, not the one on the last track (ADR-084).
  const found: { tick: number; ti: number; order: number; key: string; value: number }[] = [];
  project.tracks.forEach((t, ti) => {
    for (const e of t.events) {
      if (e.kind !== 'sysex' || e.status !== 'F0') continue;
      const b = base64ToBytes(e.dataBase64);
      const d = b && decodeGs(b);
      if (d?.param?.name === 'Use for Rhythm Part' && d.channel !== undefined) found.push({ tick: e.tick, ti, order: e.originOrder, key: `${t.port}:${d.channel}`, value: d.data[0] });
    }
  });
  found.sort((a, b) => a.tick - b.tick || a.ti - b.ti || a.order - b.order);
  const out = new Map<string, number>(); // `${port}:${channel}` -> map number
  for (const f of found) {
    if (f.value > 0) out.set(f.key, f.value);
    else out.delete(f.key);
  }
  return out;
}

/** Marks tracks on GS rhythm-part channels as drum tracks (display only; no event is changed). */
export function applyGsRhythmDisplay(project: MidiProject): { project: MidiProject; changed: string[] } {
  const rhythm = gsRhythmChannels(project);
  const changed: string[] = [];
  const tracks = project.tracks.map((t) => {
    if (t.displayMode !== 'drum' && rhythm.has(`${t.port}:${t.channel}`)) {
      changed.push(t.name);
      return { ...t, displayMode: 'drum' as const };
    }
    return t;
  });
  return { project: changed.length ? { ...project, tracks } : project, changed };
}

/**
 * Inserts a GS Reset at tick 0 of a track, ordered before every other tick-0 event of that track.
 * The user chooses the track (normally the first one so it precedes the other tracks' setup).
 */
export function insertGsReset(project: MidiProject, trackId: string): Command {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new EditError('track not found');
  const already = track.events.some((e) => e.kind === 'sysex' && e.tick === 0 && decodeGs(base64ToBytes(e.dataBase64) ?? [])?.param?.name === 'GS Reset');
  if (already) throw new EditError(t('このトラックの曲頭にはすでに GS Reset があります。'));
  let minOrder = 0;
  for (const e of track.events) if (e.tick === 0 && e.originOrder < minOrder) minOrder = e.originOrder;
  const ev: SysExEvent = { id: newId('evt'), kind: 'sysex', tick: 0, status: 'F0', dataBase64: bytesToBase64(gsResetPayload()), originOrder: minOrder - 1 };
  const tracks = project.tracks.map((t) => (t.id === trackId ? { ...t, events: sortEvents([...t.events, ev]) } : t));
  return { label: 'GS Reset を挿入', patch: { tracks } };
}

/** Changes the value of a decoded single-byte GS parameter, recomputing the checksum (bytes are rebuilt only on edit). */
export function setGsValue(project: MidiProject, eventId: string, value: number): Command {
  for (const track of project.tracks) {
    const e = track.events.find((x) => x.id === eventId);
    if (!e) continue;
    if (e.kind !== 'sysex') throw new EditError(t('SysEx ではありません。'));
    const d = decodeGs(base64ToBytes(e.dataBase64) ?? []);
    if (!d?.param) throw new EditError(t('解釈できない SysEx は値を変更できません（16進で編集してください）。'));
    if (!Number.isInteger(value) || value < d.param.min || value > d.param.max) throw new EditError(t('{name} の範囲は {min}〜{max} です。', { name: d.param.name, min: d.param.min, max: d.param.max }));
    const payload = encodeGsDt1(d.address, [value], d.deviceId);
    const tracks = project.tracks.map((tr) => (tr.id === track.id ? { ...tr, events: tr.events.map((x) => (x.id === eventId ? { ...e, dataBase64: bytesToBase64(payload) } : x)) } : tr));
    return { label: t('{name} を変更', { name: d.param.name }), patch: { tracks } }; // GS parameter names are English already
  }
  throw new EditError('event not found');
}

/** Raw hex edit of a SysEx payload ("41 10 42 12 ... F7"). The F0 byte is implied for F0 events. */
export function parseHexPayload(text: string): number[] | null {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^[0-9a-fA-F]{1,2}$/.test(p)) return null;
    out.push(parseInt(p, 16));
  }
  return out;
}

export function setSysExPayload(project: MidiProject, eventId: string, payload: number[]): Command {
  if (payload.some((b) => b > 0xff)) throw new EditError(t('不正なバイトがあります。'));
  if (payload.slice(0, -1).some((b) => b >= 0x80)) throw new EditError(t('SysEx の途中に 0x80 以上のバイトは置けません（最後の F7 を除く）。'));
  const tracks = project.tracks.map((t) => ({ ...t, events: t.events.map((e) => (e.id === eventId && e.kind === 'sysex' ? { ...e, dataBase64: bytesToBase64(payload) } : e)) }));
  return { label: 'SysEx を編集', patch: { tracks } };
}
