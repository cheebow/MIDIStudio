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
  const { store } = useServices();
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
      ...(cur ? [{ label: `${name} ${conductorValueText(cur)}（${sig.format(cur.tick)} から）を変更…`, action: () => setConductorEdit({ kind, tick: cur.tick, id: cur.id }) }] : []),
      { label: `${kind === 'tempo' ? '再生位置' : 'この小節'}に${name}の変化を追加…`, action: () => setConductorEdit({ kind, tick: at }) },
      { separator: true, label: '' },
      { label: 'コンダクタートラックを開く', action: () => store.updateSettings({ activePanel: 'tempo', editorCollapsed: false }) },
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
    <div className="transport" role="toolbar" aria-label="トランスポート">
      <button onClick={() => transport.seek(0)} title="先頭へ" aria-label="先頭へ">⏮</button>
      <button onClick={() => transport.stop()} title="停止" aria-label="停止" data-testid="transport-stop">■</button>
      <button
        className="primary"
        disabled={state.loading}
        onClick={() => run(() => ensureAudio().then(() => transport.togglePlay()))}
        title={audioReady ? '再生 / 一時停止' : '再生（音源を準備してから再生します）'}
        aria-label={playing ? '一時停止' : '再生'}
        data-testid="transport-play"
      >
        {playing ? '❚❚' : '▶'}
      </button>
      {record}
      <label className="icon-toggle" title="ループ再生（小節の範囲を繰り返す）">
        <input type="checkbox" aria-label="LOOP" checked={project.loop.enabled} onChange={(e) => onLoopChange({ ...project.loop, enabled: e.target.checked })} />
        <LoopIcon />
      </label>
      <label className="note">
        小節
        <input
          type="number"
          min={1}
          className="bar-input"
          value={bar(project.loop.startTick)}
          onChange={(e) => {
            const start = Math.round(sig.barBeatToTick(Math.max(1, Number(e.target.value) || 1)));
            onLoopChange({ ...project.loop, startTick: start, endTick: Math.max(project.loop.endTick, start + 1) });
          }}
        />
        〜
        <input
          type="number"
          min={2}
          className="bar-input"
          value={bar(project.loop.endTick - 1) + 1}
          onChange={(e) => {
            const endTick = Math.round(sig.barBeatToTick(Math.max(2, Number(e.target.value) || 2)));
            onLoopChange({ ...project.loop, endTick: Math.max(endTick, project.loop.startTick + 1) });
          }}
        />
      </label>
      <output className="position" data-testid="transport-position" aria-live="off">
        {sig.format(tick)}
      </output>
      <output className="time">{formatTime(pos.seconds)}</output>
      <button className="readout" data-testid="bpm-readout" title="テンポを変更・追加" aria-label={`テンポ ${bpm.toFixed(2)} BPM（クリックで変更）`} onClick={(e) => conductorMenu(e, 'tempo')}>
        BPM {bpm.toFixed(bpm % 1 ? 2 : 0)}
      </button>
      <button className="readout" data-testid="signature-readout" title="拍子を変更・追加" aria-label={`拍子 ${ts.numerator}/${ts.denominator}（クリックで変更）`} onClick={(e) => conductorMenu(e, 'time-signature')}>
        {ts.numerator}/{ts.denominator}
      </button>
      {ctxMenu.element}
      {conductorEdit && <ConductorEventDialog target={conductorEdit} onClose={() => setConductorEdit(null)} />}
      <label className="icon-toggle" title="メトロノーム">
        <input type="checkbox" aria-label="メトロノーム" checked={metronome} onChange={(e) => onMetronomeChange(e.target.checked)} />
        <MetronomeIcon />
      </label>
      <button onClick={() => transport.panic()} title="鳴っている音をすべて止める">Panic</button>
      {state.pendingEdits && !state.loading && (
        <span className="note pending-edits" data-testid="pending-edits" title="停止・シーク・ループの折り返しで反映します">
          変更は停止後に反映
        </span>
      )}
      <SeekBar transport={transport} project={project} sig={sig} endTick={Math.max(end, project.loop.endTick) + sig.ticksPerBar(0)} />
      {state.loading && <span className="note">準備中…</span>}
    </div>
  );
}
