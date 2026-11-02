// Startup dialog (UI_DESIGN 10, ADR-049): one place to choose the song (new / autosave), see the
// sound engine's state, decide about the MIDI keyboard, and start the engine with the one click
// browsers require for audio. Shown at every start (the click is needed anyway).
import { useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Logo } from '../../ui/Logo';
import { midiPref, type AudioPhase, type MidiSetupState } from '../hooks/useAudioEngine';
import { SAMPLE_SONGS } from '../samples';

export interface StartupChoice {
  song: 'restore' | 'new' | 'sample';
  useMidi: boolean;
  /** which sample when song === 'sample' (ADR-058) */
  sampleId?: string;
}

export function StartupDialog({
  audioPhase,
  progress,
  prefetchState,
  soundBankName,
  midiState,
  midiDevices,
  restore,
  onRetrySoundFont,
  onChooseSoundFont,
  onStart,
}: {
  audioPhase: AudioPhase;
  progress: number | null;
  prefetchState: 'loading' | 'done' | 'failed';
  soundBankName: string | null;
  midiState: MidiSetupState;
  midiDevices: number;
  restore: { title: string; savedAt: string } | null;
  onRetrySoundFont: () => void;
  onChooseSoundFont: () => void;
  onStart: (choice: StartupChoice) => void;
}) {
  const [song, setSong] = useState<'restore' | 'new' | 'sample'>('new');
  const [sampleId, setSampleId] = useState(SAMPLE_SONGS[0].id);
  const [useMidi, setUseMidi] = useState(midiPref() !== 'skip');
  // the autosave offer may arrive after the dialog opened: default to restoring once it is known
  const [restoreSeen, setRestoreSeen] = useState(false);
  if (restore && !restoreSeen) {
    setRestoreSeen(true);
    setSong('restore');
  }
  const soundStatus =
    audioPhase === 'ready'
      ? soundBankName ?? '準備完了'
      : prefetchState === 'failed'
        ? '読み込みに失敗しました'
        : prefetchState === 'loading'
          ? `読み込み中 ${progress === null ? '' : `${Math.round(progress * 100)}%`}`
          : 'GeneralUser GS';
  const midiChoice = midiState === 'prompt' || midiState === 'granted';
  const midiStatus =
    midiState === 'unsupported'
      ? 'このブラウザでは使えません'
      : midiState === 'granted'
        ? `接続 ${midiDevices} 台`
        : midiState === 'denied'
          ? 'ブラウザで許可されていません'
          : null;

  return (
    <Dialog
      title="MIDI Studio"
      onClose={() => undefined}
      closable={false}
      header={
        <header className="startup-brand">
          <Logo size={52} />
          <h2>MIDI Studio</h2>
        </header>
      }
    >
      <form
        className="form-grid startup-form"
        data-testid="startup-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onStart({ song, useMidi: midiChoice && useMidi, sampleId });
        }}
      >
        <fieldset>
          <legend>曲</legend>
          {restore && (
            <label>
              <input type="radio" name="startup-song" checked={song === 'restore'} onChange={() => setSong('restore')} /> 前回の自動保存「{restore.title}」（{new Date(restore.savedAt).toLocaleString()}）を開く
            </label>
          )}
          <label>
            <input type="radio" name="startup-song" checked={song === 'new'} onChange={() => setSong('new')} /> 新しい曲（ピアノ・ベース・ギター・ドラム）
          </label>
          <label className="row">
            <input type="radio" name="startup-song" checked={song === 'sample'} onChange={() => setSong('sample')} /> サンプル曲
            <select
              aria-label="サンプル曲"
              value={sampleId}
              onChange={(e) => {
                setSampleId(e.target.value);
                setSong('sample');
              }}
            >
              {SAMPLE_SONGS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>音源</legend>
          <span data-testid="startup-sound">{soundStatus}</span>
          <div className="row">
            {prefetchState === 'failed' && (
              <button type="button" onClick={onRetrySoundFont}>
                標準の音源を再読み込み
              </button>
            )}
            <button type="button" onClick={onChooseSoundFont}>
              SoundFont ファイルを選ぶ…
            </button>
          </div>
        </fieldset>
        <fieldset>
          <legend>MIDI キーボード</legend>
          {midiChoice ? (
            <>
              <label>
                <input type="radio" name="startup-midi" checked={useMidi} onChange={() => setUseMidi(true)} /> 使う
              </label>
              <label>
                <input type="radio" name="startup-midi" checked={!useMidi} onChange={() => setUseMidi(false)} /> 使わない
              </label>
              {midiStatus && <span className="note">{midiStatus}</span>}
            </>
          ) : (
            <span>{midiStatus}</span>
          )}
        </fieldset>
        <div className="row">
          <button type="submit" className="primary" data-testid="startup-start">
            開始
          </button>
        </div>
      </form>
    </Dialog>
  );
}
