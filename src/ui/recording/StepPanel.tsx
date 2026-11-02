// Step recording panel (INPUT_RECORDING 6): everything is reachable by mouse and by normal keys
// (→ rest, ← back, - tie, Backspace undo step), no numpad needed.
import { useSyncExternalStore } from 'react';
import { GRID_DIVISIONS, gridLabel, gridTicks } from '../../core/timing/grid';
import { useSignatureMap } from '../hooks';
import { useEditorState, useServices } from '../../app/store/context';

export function StepPanel({ drum }: { drum: boolean }) {
  const { store, step, transport } = useServices();
  const { project } = useEditorState();
  const snap = useSyncExternalStore(step.subscribe, step.getSnapshot);
  const rec = project.settings.recording;
  const sig = useSignatureMap(project);
  const options = GRID_DIVISIONS.flatMap((d) => (['straight', 'triplet', 'dotted'] as const).map((k) => ({ g: { division: d, kind: k }, t: gridTicks(project.ppq, { division: d, kind: k }) }))).filter((o) => o.t.den === 1);
  const set = (patch: Partial<typeof rec>) => store.updateSettings({ recording: { ...rec, ...patch } });
  return (
    <div className="step-panel" role="region" aria-label="ステップ入力">
      <strong>ステップ入力（{drum ? 'ドラム' : '鍵盤'}）</strong>
      <span className="step-cursor" data-testid="step-cursor">
        位置 {sig.format(snap.cursor)}
      </span>
      <label>
        音長{' '}
        <select value={rec.stepTicks} onChange={(e) => set({ stepTicks: Number(e.target.value) })} aria-label="ステップの長さ">
          {options.map((o) => (
            <option key={gridLabel(o.g)} value={o.t.num}>
              {gridLabel(o.g)}（{o.t.num}）
            </option>
          ))}
        </select>
      </label>
      <label>
        ゲート{' '}
        <input type="number" min={1} max={100} value={rec.gatePercent} onChange={(e) => set({ gatePercent: Math.max(1, Math.min(100, Number(e.target.value) || 90)) })} style={{ width: '4em' }} />%
      </label>
      {drum && (
        <label>
          <input type="checkbox" checked={rec.drumAutoAdvance} onChange={(e) => set({ drumAutoAdvance: e.target.checked })} /> 自動で進む
        </label>
      )}
      <button onClick={() => step.back()} title="1 ステップ戻る（←）">← 戻る</button>
      <button onClick={() => step.rest()} title="休符 / 次へ（→）" data-testid="step-rest">休符 →</button>
      <button onClick={() => step.tie()} title="直前の音をのばす（-）">タイ</button>
      <button onClick={() => step.undoLast()} title="直前のステップを取り消す（Backspace）">取消</button>
      <button onClick={() => step.setCursor(Math.round(transport.getPosition().tick))}>再生位置へ</button>
      {snap.message && <span className="warn-text">{snap.message}</span>}
      <span className="note">{drum ? 'パッドを押すと現在位置に入力（同じ位置に重ねられます）' : '同時に押した鍵盤は和音として、すべて離したときに入力'}</span>
    </div>
  );
}
