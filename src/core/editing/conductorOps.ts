// Tempo / time signature / marker edits (REQ-PRJ-05, REQ-PLAY-01). Integer µs per quarter is
// the source of truth; BPM is converted on input and shown rounded.
import { newId } from '../model/ids';
import type { ConductorEvent, MidiProject } from '../model/types';
import { sortEvents } from '../events/order';
import { usFromBpm } from '../timing/tempoMap';
import { TimeSignatureMap } from '../timing/timeSignatureMap';
import type { Command } from './history';
import { EditError } from './operations';
import { t } from '../../i18n';

function withConductor(conductor: ConductorEvent[], label: string): Command {
  return { label, patch: { conductor: sortEvents(conductor) } };
}

export function setTempo(project: MidiProject, tick: number, bpm: number): Command {
  if (!(bpm >= 1 && bpm <= 999)) throw new EditError(t('テンポは 1〜999 BPM で入力してください。'));
  const us = usFromBpm(bpm);
  const existing = project.conductor.find((c) => c.kind === 'tempo' && c.tick === tick);
  const conductor = existing
    ? project.conductor.map((c) => (c === existing ? { ...c, usPerQuarter: us } : c))
    : [...project.conductor, { id: newId('evt'), kind: 'tempo' as const, tick, usPerQuarter: us, originOrder: project.nextOriginOrder }];
  return { ...withConductor(conductor, 'テンポを変更'), patch: { conductor: sortEvents(conductor), ...(existing ? {} : { nextOriginOrder: project.nextOriginOrder + 1 }) } };
}

export function setTimeSignature(project: MidiProject, tick: number, numerator: number, denominator: number): Command {
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) throw new EditError(t('拍子の分子は 1〜32 です。'));
  if (![1, 2, 4, 8, 16, 32].includes(denominator)) throw new EditError(t('拍子の分母は 1, 2, 4, 8, 16, 32 のいずれかです。'));
  const existing = project.conductor.find((c) => c.kind === 'time-signature' && c.tick === tick);
  const conductor = existing
    ? project.conductor.map((c) => (c === existing ? { ...c, numerator, denominator } : c))
    : [...project.conductor, { id: newId('evt'), kind: 'time-signature' as const, tick, numerator, denominator, originOrder: project.nextOriginOrder }];
  return { label: '拍子を変更', patch: { conductor: sortEvents(conductor), ...(existing ? {} : { nextOriginOrder: project.nextOriginOrder + 1 }) } };
}

export function deleteConductorEvent(project: MidiProject, id: string): Command {
  const e = project.conductor.find((c) => c.id === id);
  if (!e) throw new EditError('event not found');
  return withConductor(project.conductor.filter((c) => c.id !== id), 'テンポトラックのイベントを削除');
}

export type ConductorValue =
  | { kind: 'tempo'; bpm: number }
  | { kind: 'time-signature'; numerator: number; denominator: number }
  | { kind: 'key-signature'; sharpsFlats: number; minor: boolean }
  | { kind: 'marker'; text: string };

const KIND_LABEL: Record<ConductorValue['kind'], string> = { tempo: 'テンポ', 'time-signature': '拍子', 'key-signature': '調号', marker: 'マーカー' };

function validate(v: ConductorValue): void {
  if (v.kind === 'tempo' && !(v.bpm >= 1 && v.bpm <= 999)) throw new EditError(t('テンポは 1〜999 BPM で入力してください。'));
  if (v.kind === 'time-signature') {
    if (!Number.isInteger(v.numerator) || v.numerator < 1 || v.numerator > 32) throw new EditError(t('拍子の分子は 1〜32 です。'));
    if (![1, 2, 4, 8, 16, 32].includes(v.denominator)) throw new EditError(t('拍子の分母は 1, 2, 4, 8, 16, 32 のいずれかです。'));
  }
  if (v.kind === 'key-signature' && (!Number.isInteger(v.sharpsFlats) || v.sharpsFlats < -7 || v.sharpsFlats > 7)) throw new EditError(t('調号は ♭7〜♯7 です。'));
}

/**
 * Adds a tempo / time-signature / key-signature / marker event at `tick`, or changes the event
 * `id` (value and position) — one undo step. Tempo, signatures and keys allow one event per tick:
 * an event of the same kind already at the target tick is replaced. Markers may share a tick.
 * A time signature must start a bar: its tick is moved to the start of the bar it falls in
 * (computed without the event being edited).
 */
export function upsertConductorEvent(project: MidiProject, tick: number, value: ConductorValue, id?: string): Command {
  validate(value);
  if (!Number.isInteger(tick) || tick < 0) throw new EditError(t('位置が正しくありません。'));
  const old = id ? project.conductor.find((c) => c.id === id) : undefined;
  if (id && !old) throw new EditError('event not found');
  if (old && old.kind !== value.kind) throw new EditError(t('種類は変更できません。'));
  let rest = project.conductor.filter((c) => c !== old);
  let at = tick;
  if (value.kind === 'time-signature') {
    const map = new TimeSignatureMap(project.ppq, rest.filter((c) => c.kind === 'time-signature'));
    at = Math.round(map.barBeatToTick(map.tickToBarBeat(tick).bar));
  }
  if (value.kind !== 'marker') rest = rest.filter((c) => !(c.kind === value.kind && c.tick === at));
  const base = { id: old?.id ?? newId('evt'), tick: at, originOrder: old?.originOrder ?? project.nextOriginOrder };
  let ev: ConductorEvent;
  switch (value.kind) {
    case 'tempo':
      ev = { ...base, kind: 'tempo', usPerQuarter: usFromBpm(value.bpm) };
      break;
    case 'time-signature': {
      const prev = old?.kind === 'time-signature' ? old : undefined;
      ev = { ...base, kind: 'time-signature', numerator: value.numerator, denominator: value.denominator, ...(prev?.clocksPerClick !== undefined ? { clocksPerClick: prev.clocksPerClick, thirtySecondsPerQuarter: prev.thirtySecondsPerQuarter } : {}) };
      break;
    }
    case 'key-signature':
      ev = { ...base, kind: 'key-signature', sharpsFlats: value.sharpsFlats, minor: value.minor };
      break;
    case 'marker':
      ev = { ...base, kind: 'marker', text: value.text };
      break;
  }
  const label = `${KIND_LABEL[value.kind]}を${old ? '変更' : '追加'}`;
  return { label, patch: { conductor: sortEvents([...rest, ev]), ...(old ? {} : { nextOriginOrder: project.nextOriginOrder + 1 }) } };
}
