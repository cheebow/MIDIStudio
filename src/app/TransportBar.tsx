// Phase 2 transport bar. Reads position only from the Transport (REQ-PLAY-04).
import { useMemo, useState } from 'react';
import { useServices } from './store/context';
import { useContextMenu } from '../ui/menu/ContextMenu';
import { ConductorEventDialog, conductorAt, conductorValueText, KIND_NAMES, type ConductorDialogTarget } from '../ui/tempo/conductorUi';
import type { MidiProject } from '../core/model/types';
import { bpmFromUs } from '../core/timing/tempoMap';
import type { Transport } from '../playback/Transport';
import { usePlaybackPosition, useTransportState } from './hooks/usePlayback';
import { LoopIcon, MetronomeIcon } from '../ui/icons';
import { useSignatureMap } from '../ui/hooks';
import { SeekBar } from './SeekBar';
import { t } from '../i18n';

interface Props {
  transport: Transport;
  project: MidiProject;
  audioReady: boolean;
  /** starts the sound engine if needed (called from the click) */
  ensureAudio: () => Promise<void>;
  metronome: boolean;
  onMetronomeChange: (on: boolean) => void;
  onLoopChange: (loop: MidiProject['loop']) => void;
  onError: (message: string) => void;
  /** record button + REC / count-in label + settings, placed next to play like a DAW transport */
  record?: React.ReactNode;
}

function songEndTick(p: MidiProject): number {
  let end = 0;
  for (const t of p.tracks) {
    end = Math.max(end, t.endOfTrackTick ?? 0);
    for (const e of t.events) end = Math.max(end, e.kind === 'note' ? e.tick + e.durationTicks : e.tick);
  }
  return Math.max(end, p.ppq * 4);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

/**
 * A loop bar number. While typing, the text is a draft: it is applied as soon as it is a whole
 * number that `valid` accepts; Enter or leaving the field applies it with `fix` (the caller keeps
 * the loop at least one bar long) or puts back the current value when it is not a number (ADR-084).
 */
function BarInput({ value, min, valid, onCommit }: { value: number; min: number; valid: (bar: number) => boolean; onCommit: (bar: number, fix: boolean) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const parse = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : null);
  const finish = () => {
    if (draft === null) return;
    const n = parse(draft);
    const b = n === null ? null : Math.max(min, n);
    setDraft(null);
    if (b !== null && b !== value) onCommit(b, true);
  };
  return (
    <input
      type="number"
      min={min}
      className="bar-input"
      value={draft ?? value}
      onChange={(e) => {
        const s = e.target.value;
        const b = parse(s);
        if (b !== null && b >= min && valid(b)) {
          setDraft(null);
          if (b !== value) onCommit(b, false);
        } else setDraft(s);
      }}
      onKeyDown={(e) => e.key === 'Enter' && finish()}
      onBlur={finish}
    />
  );
}

export function TransportBar({ transport, project, audioReady, ensureAudio, metronome, onMetronomeChange, onLoopChange, onError, record }: Props) {
  const state = useTransportState(transport);
  const pos = usePlaybackPosition(transport);
  const sig = useSignatureMap(project);
  const end = useMemo(() => songEndTick(project), [project]);
  const tick = Math.max(0, pos.tick);
  const bpm = transport.tempoMap ? bpmFromUs(transport.tempoMap.usPerQuarterAt(tick)) : 120;
  const ts = sig.signatureAt(tick);
  const bar = (t: number) => sig.tickToBarBeat(t).bar;
  const playing = state.status === 'playing';
  const { store, recorder } = useServices();
  /** Stop and play / pause end a running take first (as the record button does): the transport alone would leave it unsaved. */
  const endTake = (): boolean => {
    if (recorder.getState().phase === 'idle') return false;
    recorder.stop();
    return true;
  };
  const ctxMenu = useContextMenu();
  const [conductorEdit, setConductorEdit] = useState<ConductorDialogTarget | null>(null);
  /** menu for the BPM / time-signature readouts: change the value in effect here, or add one here */
  const conductorMenu = (e: React.MouseEvent<HTMLButtonElement>, kind: 'tempo' | 'time-signature') => {
    const r = e.currentTarget.getBoundingClientRect();
    const here = Math.round(tick);
    const at = kind === 'time-signature' ? Math.round(sig.barBeatToTick(sig.tickToBarBeat(here).bar)) : here;
    const cur = conductorAt(project, kind, here);
    const name = KIND_NAMES[kind];
    ctxMenu.open({ clientX: r.left, clientY: r.bottom + 2, preventDefault: () => undefined }, [
      ...(cur ? [{ label: t('{name} {value}（{from} から）を変更…', { name: t(name), value: conductorValueText(cur), from: sig.format(cur.tick) }), action: () => setConductorEdit({ kind, tick: cur.tick, id: cur.id }) }] : []),
      { label: t('{where}に{name}の変化を追加…', { where: kind === 'tempo' ? t('再生位置') : t('この小節'), name: t(name) }), action: () => setConductorEdit({ kind, tick: at }) },
      { separator: true, label: '' },
      { label: t('コンダクタートラックを開く'), action: () => store.updateSettings({ activePanel: 'tempo', editorCollapsed: false }) },
    ]);
  };

  const run = (fn: () => Promise<void> | void) => {
    try {
      const r = fn();
      if (r instanceof Promise) r.catch((e: unknown) => onError((e as Error).message));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="transport" role="toolbar" aria-label={t('トランスポート')}>
      <button onClick={() => transport.seek(0)} title={t('先頭へ')} aria-label={t('先頭へ')}>⏮</button>
      <button onClick={() => {
        endTake(); // closes the take at the position it reached, then the playhead goes back
        transport.stop();
      }} title={t('停止')} aria-label={t('停止')} data-testid="transport-stop">■</button>
      <button
        className="primary"
        disabled={state.loading}
        onClick={() => {
          if (!endTake()) run(() => ensureAudio().then(() => transport.togglePlay()));
        }}
        title={audioReady ? t('再生 / 一時停止') : t('再生（音源を準備してから再生します）')}
        aria-label={playing ? t('一時停止') : t('再生')}
        data-testid="transport-play"
      >
        {playing ? '❚❚' : '▶'}
      </button>
      {record}
      <label className="icon-toggle" title={t('ループ再生（小節の範囲を繰り返す）')}>
        <input type="checkbox" aria-label="LOOP" checked={project.loop.enabled} onChange={(e) => onLoopChange({ ...project.loop, enabled: e.target.checked })} />
        <LoopIcon />
      </label>
      <label className="note">
        {t('小節')}
        {/* ADR-084: typed text is a draft; it applies as soon as it is a valid range (so "12" can be
            typed digit by digit), and on Enter / leaving the field it is fixed up (at least one bar) */}
        <BarInput
          min={1}
          value={bar(project.loop.startTick)}
          valid={(b) => b < bar(project.loop.endTick - 1) + 1}
          onCommit={(b, fix) => {
            const startTick = Math.round(sig.barBeatToTick(b));
            const endTick = fix && startTick >= project.loop.endTick ? Math.round(sig.barBeatToTick(b + 1)) : project.loop.endTick;
            onLoopChange({ ...project.loop, startTick, endTick });
          }}
        />
        〜
        <BarInput
          min={2}
          value={bar(project.loop.endTick - 1) + 1}
          valid={(b) => b > bar(project.loop.startTick)}
          onCommit={(b, fix) => {
            const startBar = bar(project.loop.startTick);
            const endTick = Math.round(sig.barBeatToTick(fix ? Math.max(b, startBar + 1) : b));
            onLoopChange({ ...project.loop, endTick });
          }}
        />
      </label>
      <output className="position" data-testid="transport-position" aria-live="off">
        {sig.format(tick)}
      </output>
      <output className="time">{formatTime(pos.seconds)}</output>
      <button className="readout" data-testid="bpm-readout" title={t('テンポを変更・追加')} aria-label={t('テンポ {bpm} BPM（クリックで変更）', { bpm: bpm.toFixed(2) })} onClick={(e) => conductorMenu(e, 'tempo')}>
        BPM {bpm.toFixed(bpm % 1 ? 2 : 0)}
      </button>
      <button className="readout" data-testid="signature-readout" title={t('拍子を変更・追加')} aria-label={t('拍子 {num}/{den}（クリックで変更）', { num: ts.numerator, den: ts.denominator })} onClick={(e) => conductorMenu(e, 'time-signature')}>
        {ts.numerator}/{ts.denominator}
      </button>
      {ctxMenu.element}
      {conductorEdit && <ConductorEventDialog target={conductorEdit} onClose={() => setConductorEdit(null)} />}
      <label className="icon-toggle" title={t('メトロノーム')}>
        <input type="checkbox" aria-label={t('メトロノーム')} checked={metronome} onChange={(e) => onMetronomeChange(e.target.checked)} />
        <MetronomeIcon />
      </label>
      <button onClick={() => transport.panic()} title={t('鳴っている音をすべて止める')}>Panic</button>
      {state.pendingEdits && !state.loading && (
        <span className="note pending-edits" data-testid="pending-edits" title={t('停止・シーク・ループの折り返しで反映します')}>
          {t('変更は停止後に反映')}
        </span>
      )}
      <SeekBar transport={transport} project={project} sig={sig} endTick={Math.max(end, project.loop.endTick) + sig.ticksPerBar(0)} />
      {state.loading && <span className="note">{t('準備中…')}</span>}
    </div>
  );
}
