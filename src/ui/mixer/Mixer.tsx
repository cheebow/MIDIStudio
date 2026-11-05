// Mixer (UI_DESIGN 8): DAW-style channel strips. Knobs (Pan / Reverb / Chorus / Expression) and a
// vertical Volume fader edit the track's tick-0 controller events (saved in the SMF); while moving,
// the value is sent to the synth for preview, and it is committed once when the gesture ends.
import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { controllerAt, programAt, setControllerAt } from '../../core/editing/channelSetup';
import { usePlaybackPosition } from '../../app/hooks/usePlayback';
import { programLabel } from '../../core/gm/instruments';
import type { MidiTrack } from '../../core/model/types';
import { selectedTrack } from '../../core/model/selectedTrack';
import { useEditorState, useServices } from '../../app/store/context';
import { Fader, Knob } from './controls';

const pan = (v: number) => (v === 64 ? 'C' : v < 64 ? `L${64 - v}` : `R${v - 64}`);

export function Mixer() {
  const { store, transport, adapter, reportError } = useServices();
  const { project } = useEditorState();
  // Level meters: one animation-frame loop writes straight to the meter elements (no re-render).
  const meterEls = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    let raf = 0;
    const shown = new Map<string, number>();
    const loop = () => {
      const levels = adapter.channelLevels();
      for (const [id, el] of meterEls.current) {
        const ch = Number(el.dataset.channel);
        const peak = levels ? (levels[ch] ?? 0) : 0;
        // -48 dBFS .. 0 dBFS -> 0..1; fast attack, slow release
        const target = peak > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(peak) + 48) / 48)) : 0;
        const prev = shown.get(id) ?? 0;
        const v = target > prev ? target : Math.max(target, prev - 0.025);
        if (Math.abs(v - prev) > 0.001 || v === 0) {
          shown.set(id, v);
          el.style.height = `${(1 - v) * 100}%`;
          el.parentElement?.classList.toggle('clip', peak >= 0.99);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [adapter]);
  // Values follow the playhead (re-rendered every frame only while playing).
  const tick = Math.max(0, Math.round(usePlaybackPosition(transport).tick));
  const at = (tk: MidiTrack, c: number) => controllerAt(tk, c, tick);
  const initial = (tk: MidiTrack, c: number) => at(tk, c).event?.value ?? null;
  const preview = (tk: MidiTrack, c: number) => (v: number) => transport.sendToTrack(tk.id, [0xb0, c, v]);
  const commit = (tk: MidiTrack, c: number) => (v: number, mergeKey?: string) => {
    if (initial(tk, c) === v) return;
    try {
      // a controller-only edit at the playhead is applied live by the Transport: no reload (ADR-039)
      store.run(setControllerAt(store.project, tk.id, c, v, tick), mergeKey ? { mergeKey: `${mergeKey}-${tk.id}-${c}` } : {});
    } catch (e) {
      reportError((e as Error).message);
    }
  };
  const anySolo = project.tracks.some((tk) => tk.solo);
  /** tooltip when a controller changes during the song (automation) */
  const autoNote = (tk: MidiTrack, c: number) => {
    const a = at(tk, c);
    if (a.count > 1) return t('CC{c} の変化が {n} 個あります。表示は再生位置の値で、動かすとその時点で有効なイベントを書き換えます。', { c, n: a.count });
    if (a.event && a.event.tick > 0) return t('CC{c} は Tick {tick} にあります。', { c, tick: a.event.tick });
    return undefined;
  };

  const selectedId = selectedTrack(project)?.id;

  return (
    <div className="mixer" role="region" aria-label={t('ミキサー')}>
      <div className="mixer-strips">
        {project.tracks.map((tk, i) => {
          const pc = programAt(tk, tick).event;
          const silent = tk.mute || (anySolo && !tk.solo);
          const selected = selectedId === tk.id; // same fallback as the editors (ADR-084)
          const knob = (c: number, name: string, def: number, extra: { bipolar?: boolean; format?: (v: number) => string } = {}) => (
            <Knob label={`${tk.name} ${name}`} value={initial(tk, c)} defaultValue={def} color={tk.color} onChange={preview(tk, c)} onCommit={commit(tk, c)} automation={autoNote(tk, c)} {...extra} />
          );
          const meter = (
            <div className="meter" aria-hidden="true" title={t('{name} の出力レベル（{ch}。同じチャンネル番号のトラックは同じメーターです）', { name: tk.name, ch: `${tk.port}${tk.channel + 1}` })}>
              <div
                className="meter-cover"
                data-channel={tk.channel}
                ref={(el) => {
                  if (el) meterEls.current.set(tk.id, el);
                  else meterEls.current.delete(tk.id);
                }}
              />
            </div>
          );
          return (
            <div key={tk.id} className={`strip${selected ? ' selected' : ''}${silent ? ' silent' : ''}`} data-testid="mixer-strip" onPointerDown={() => !selected && store.updateSettings({ selectedTrackId: tk.id })}>
              <div className="strip-head" style={{ borderTopColor: tk.color }} title={tk.name}>
                <span className="strip-index">{i + 1}</span>
                <span className="strip-name">{tk.name}</span>
              </div>
              <div className="strip-program note" title={pc && pc.kind === 'program' ? programLabel(pc.program) : t('音色未設定')}>
                {pc && pc.kind === 'program' ? programLabel(pc.program).slice(4) : '—'}
              </div>
              <div className="strip-knobs">
                {knob(10, 'Pan', 64, { bipolar: true, format: pan })}
                {knob(91, 'Reverb', 40)}
                {knob(93, 'Chorus', 0)}
                {knob(11, 'Expr', 127)}
              </div>
              <Fader label={`${tk.name} Volume`} value={initial(tk, 7)} defaultValue={100} color={tk.color} onChange={preview(tk, 7)} onCommit={commit(tk, 7)} automation={autoNote(tk, 7)} meter={meter} />
              <div className="strip-volume" aria-hidden="true">
                {initial(tk, 7) ?? '--'}
              </div>
              <div className="strip-buttons">
                <button className={`toggle${tk.mute ? ' on' : ''}`} aria-pressed={tk.mute} aria-label={t('{name} をミュート', { name: tk.name })} onClick={() => store.setTrackFlags(tk.id, { mute: !tk.mute })}>
                  M
                </button>
                <button className={`toggle solo${tk.solo ? ' on' : ''}`} aria-pressed={tk.solo} aria-label={t('{name} をソロ', { name: tk.name })} onClick={() => store.setTrackFlags(tk.id, { solo: !tk.solo })}>
                  S
                </button>
              </div>
              <div className="strip-channel">
                {tk.port}
                {tk.channel + 1}
                {tk.displayMode === 'drum' ? ' 🥁' : ''}
              </div>
            </div>
          );
        })}
      </div>
      <p className="note mixer-note">
        {t('表示は再生位置で有効な CC の値です（再生中は追従。A はその CC が曲の途中で変化するもの＝オートメーション）。フェーダー右のメーターは実際の出力レベルです。動かすと表示中のイベントを書き換え、まだ無い CC は曲頭（Tick 0）に追加します。薄い表示は未設定。ドラッグ・ホイール・矢印キーで変更、ダブルクリックで初期値。変化の形はピアノロールの CC レーンで編集します。')}
      </p>
    </div>
  );
}
