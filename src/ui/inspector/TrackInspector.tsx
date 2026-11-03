// Track inspector (UI_DESIGN 1/8): port / channel / display mode / name / colour, Bank / Program
// (or GS drum kit) and pitch bend range as real MIDI events at tick 0, GS rhythm part setup.
import { useState } from 'react';
import { t } from '../../i18n';
import { updateTrack, addEvents } from '../../core/editing/operations';
import { programAt, setProgramAt, setPitchBendRange } from '../../core/editing/channelSetup';
import { usePlaybackPosition } from '../../app/hooks/usePlayback';
import { useSignatureMap } from '../hooks';
import { selectedTrack } from '../../core/model/selectedTrack';
import { GM_PROGRAMS, programLabel } from '../../core/gm/instruments';
import { GS_DRUM_KITS } from '../../core/gm/gsKits';
import { encodeGsDt1, partAddress } from '../../core/gs/gsSysex';
import { bytesToBase64 } from '../../core/model/base64';
import type { MidiTrack } from '../../core/model/types';
import { useEditorState, useServices } from '../../app/store/context';

export function TrackInspector() {
  const { store, adapter, audioReady, reportError, transport } = useServices();
  const { project } = useEditorState();
  const [pbRange, setPbRange] = useState(2);
  const tick = Math.max(0, Math.round(usePlaybackPosition(transport).tick));
  const sig = useSignatureMap(project);
  const track: MidiTrack | undefined = selectedTrack(project);
  if (!track) return null;
  // the sound at the playhead: last Program Change at or before it, else the track's first one
  const cur = programAt(track, tick);
  const firstProgram = cur.event;
  const { msb, lsb } = cur;
  const setSound = (v: { msb: number | null; lsb: number | null; program: number }) => store.run(setProgramAt(store.project, track.id, v, tick));
  const where = firstProgram ? sig.tickToBarBeat(firstProgram.tick) : null;
  const set = (changes: Parameters<typeof updateTrack>[2], label?: string) => store.run(updateTrack(store.project, track.id, changes, label));
  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      reportError((e as Error).message);
    }
  };
  const kits = audioReady ? adapter.drumKitPrograms() : null;
  const isDrum = track.displayMode === 'drum';

  return (
    <aside className="inspector" aria-label={t('トラックインスペクター')}>
      <h3>{t('トラック')}</h3>
      <label>
        {t('名前')}
        <input key={track.id + track.name} defaultValue={track.name} onBlur={(e) => e.target.value !== track.name && set({ name: e.target.value }, 'トラック名を変更')} />
      </label>
      <label>
        {t('色')}
        <input type="color" value={track.color.slice(0, 7)} onChange={(e) => set({ color: e.target.value }, 'トラックの色を変更')} />
      </label>
      <div className="inspector-row">
        <label>
          {t('ポート')}
          <select value={track.port} onChange={(e) => set({ port: e.target.value }, 'ポートを変更')}>
            {['A', 'B', 'C', 'D'].map((p) => (
              <option key={p}>{p}</option>
            ))}
            {!['A', 'B', 'C', 'D'].includes(track.port) && <option>{track.port}</option>}
          </select>
        </label>
        <label>
          {t('チャンネル')}
          <select value={track.channel} onChange={(e) => set({ channel: Number(e.target.value) }, 'チャンネルを変更')}>
            {Array.from({ length: 16 }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t('表示')}
        <select value={track.displayMode} onChange={(e) => set({ displayMode: e.target.value as MidiTrack['displayMode'] }, '表示モードを変更')}>
          <option value="melodic">{t('メロディ（ピアノロール）')}</option>
          <option value="drum">{t('ドラム')}</option>
        </select>
      </label>
      {isDrum ? (
        <label>
          {t('ドラムキット（再生位置の Program Change）')}
          <select value={firstProgram?.program ?? ''} onChange={(e) => run(() => setSound({ msb: null, lsb: null, program: Number(e.target.value) }))}>
            {!firstProgram && <option value="">{t('（未設定）')}</option>}
            {GS_DRUM_KITS.map((k) => (
              <option key={k.program} value={k.program}>
                {String(k.program + 1).padStart(3, '0')} {k.name}
                {kits && !kits.includes(k.program) ? t('（この SoundFont にはありません）') : ''}
              </option>
            ))}
            {firstProgram && !GS_DRUM_KITS.some((k) => k.program === firstProgram.program) && <option value={firstProgram.program}>{String(firstProgram.program + 1).padStart(3, '0')}</option>}
          </select>
        </label>
      ) : (
        <>
          <label>
            {t('音色（再生位置の Program Change）')}
            <select value={firstProgram?.program ?? ''} onChange={(e) => run(() => setSound({ msb, lsb, program: Number(e.target.value) }))}>
              {!firstProgram && <option value="">{t('（未設定）')}</option>}
              {GM_PROGRAMS.map((_, p) => (
                <option key={p} value={p}>
                  {programLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <div className="inspector-row">
            <label>
              Bank MSB
              <input type="number" min={0} max={127} value={msb ?? ''} placeholder="--" onChange={(e) => run(() => setSound({ msb: e.target.value === '' ? null : Number(e.target.value), lsb, program: firstProgram?.program ?? 0 }))} />
            </label>
            <label>
              LSB
              <input type="number" min={0} max={127} value={lsb ?? ''} placeholder="--" onChange={(e) => run(() => setSound({ msb, lsb: e.target.value === '' ? null : Number(e.target.value), program: firstProgram?.program ?? 0 }))} />
            </label>
          </div>
        </>
      )}
      {firstProgram && where && (
        <p className="note" data-testid="program-where">
          {cur.inEffect ? '' : t('この位置より前に音色指定がないため、最初の ')}
          {t('{bar}小節{beat}拍目の Program Change', { bar: where.bar, beat: where.beat })}
          {cur.count > 1 ? t('（このトラックに {n} 個）', { n: cur.count }) : ''}
          {t('。変更するとこのイベントを書き換えます。')}
        </p>
      )}
      {!firstProgram && <p className="note">{t('音色を選ぶと Tick 0 に Program Change を追加します。')}</p>}
      <div className="inspector-row">
        <label>
          {t('ベンド幅（半音）')}
          <input type="number" min={0} max={24} value={pbRange} onChange={(e) => setPbRange(Number(e.target.value))} />
        </label>
        <button style={{ alignSelf: 'flex-end' }} onClick={() => run(() => store.run(setPitchBendRange(store.project, track.id, pbRange)))} title={t('RPN 0/0 を Tick 0 に挿入')}>
          {t('設定')}
        </button>
      </div>
      {isDrum && track.channel !== 9 && (
        <button
          onClick={() =>
            run(() => {
              const r = addEvents(store.project, track.id, [{ kind: 'sysex', tick: 0, status: 'F0', dataBase64: bytesToBase64(encodeGsDt1(partAddress(0x15, track.channel), [1])) }], { label: 'GS リズムパート設定を挿入' });
              if (r) store.run(r.command);
            })
          }
          title={t('GS: Use for Rhythm Part = MAP1 をこのチャンネル用に Tick 0 へ挿入')}
        >
          {t('GS: Ch{ch} をリズムパートにする', { ch: track.channel + 1 })}
        </button>
      )}
      <p className="note">{t('音色名は GM / GS の表記です。実際の音は読み込んだ SoundFont によります（Roland 実機の音色ではありません）。')}</p>
    </aside>
  );
}
