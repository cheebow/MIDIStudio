// WAV export dialog (ADR-052): renders the playback snapshot in a Worker and downloads the file.
import { useEffect, useRef, useState } from 'react';
import { buildPlaybackSnapshot } from '../../core/project-io/playbackSnapshot';
import { downloadBytes, safeFileName } from '../../storage/files';
import { useEditorState } from '../../app/store/context';
import { Dialog } from '../Dialog';
import { t } from '../../i18n';
import { NumberInput } from '../NumberInput';

type Msg = { type: 'progress'; value: number } | { type: 'done'; wav: ArrayBuffer } | { type: 'error'; message: string };

export function ExportWavDialog({ soundFont, onClose }: { soundFont: ArrayBuffer | null; onClose: () => void }) {
  const { project } = useEditorState();
  const [sampleRate, setSampleRate] = useState(44100);
  const [tail, setTail] = useState(2);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);

  const start = () => {
    if (!soundFont || soundFont.byteLength === 0) {
      setError(t('音源のデータがありません。'));
      return;
    }
    setError(null);
    setProgress(0);
    const snap = buildPlaybackSnapshot({ ...project, loop: { ...project.loop, enabled: false } });
    const w = new Worker(new URL('../../playback/render/renderWav.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.type === 'progress') setProgress(m.value);
      else if (m.type === 'done') {
        downloadBytes(new Uint8Array(m.wav), safeFileName(project.title, 'wav'), 'audio/wav');
        w.terminate();
        worker.current = null;
        onClose();
      } else {
        setError(m.message);
        setProgress(null);
        w.terminate();
        worker.current = null;
      }
    };
    w.onerror = (e) => {
      setError(e.message || t('書き出しに失敗しました。'));
      setProgress(null);
    };
    try {
      // the bank is copied for the worker (the hook keeps its own)
      w.postMessage({ smf: snap.smf, soundFont: soundFont.slice(0), sampleRate, tailSeconds: tail });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
      w.terminate();
      worker.current = null;
    }
  };
  const cancel = () => {
    worker.current?.terminate();
    worker.current = null;
    setProgress(null);
  };

  return (
    <Dialog title={t('WAV を書き出す')} onClose={onClose}>
      <div className="form-grid">
        <label>
          {t('サンプリングレート')}
          <select aria-label={t('サンプリングレート')} value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))} disabled={progress !== null}>
            <option value={44100}>44.1 kHz</option>
            <option value={48000}>48 kHz</option>
          </select>
        </label>
        <label>
          {t('曲の終わりの余韻')}
          <span className="row">
            <NumberInput aria-label={t('余韻（秒）')} min={0} max={30} step={0.5} integer={false} value={tail} onValue={setTail} className="pct" disabled={progress !== null} /> {t('秒')}
          </span>
        </label>
        {!soundFont && <p className="note warn-text">{t('音源が読み込まれていません。')}</p>}
        {progress !== null && (
          <progress value={progress} max={1} aria-label={t('書き出しの進み')} style={{ width: '100%' }}>
            {Math.round(progress * 100)}%
          </progress>
        )}
        {error && (
          <p className="note warn-text" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          {progress === null ? (
            <button className="primary" onClick={start} disabled={!soundFont} data-testid="wav-start">
              {t('書き出す')}
            </button>
          ) : (
            <button onClick={cancel}>{t('中止')}</button>
          )}
          <button onClick={onClose}>{t('閉じる')}</button>
        </div>
      </div>
    </Dialog>
  );
}
