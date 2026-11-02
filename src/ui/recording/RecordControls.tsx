// Record button + status (REQ-IN-04). Recording needs an armed track (R).
import { useEffect, useSyncExternalStore } from 'react';
import type { Recorder } from '../../app/recording/Recorder';

export function RecordControls({ recorder, onSettings, beforeStart, onError, onMessage }: { recorder: Recorder; onSettings: () => void; beforeStart: () => Promise<void>; onError: (m: string) => void; onMessage: (m: string) => void }) {
  const st = useSyncExternalStore(recorder.subscribe, recorder.getState);
  // results go to the status bar (a long text here would wrap the toolbar onto two lines)
  useEffect(() => {
    if (st.message && st.phase === 'idle') onMessage(st.message);
  }, [st.message, st.phase, onMessage]);
  const active = st.phase !== 'idle';
  return (
    <span className="record-controls">
      <button
        className={`record${active ? ' on' : ''}`}
        aria-pressed={active}
        aria-label={active ? '録音を停止' : '録音'}
        title="録音（録音待機のトラックへ）"
        data-testid="record"
        onClick={() => {
          if (active) recorder.stop();
          else beforeStart().then(() => recorder.start()).catch((e: unknown) => onError((e as Error).message));
        }}
      >
        ●
      </button>
      {st.phase === 'count-in' && <span className="count-in" data-testid="count-in">カウント {st.countIn}</span>}
      {st.phase === 'recording' && <span className="rec-label">REC</span>}
      <button onClick={onSettings} title="録音の設定" aria-label="録音の設定">
        ⚙
      </button>
    </span>
  );
}
