// Step recording panel (INPUT_RECORDING 6): everything is reachable by mouse and by normal keys
// (→ rest, ← back, - tie, Backspace undo step), no numpad needed.
import { useSyncExternalStore } from 'react';
import { GRID_DIVISIONS, gridLabel, gridTicks } from '../../core/timing/grid';
import { useSignatureMap } from '../hooks';
import { useEditorState, useServices } from '../../app/store/context';
import { t } from '../../i18n';
import { ALT_LABEL as ALT } from '../platform';
import { NumberInput } from '../NumberInput';

export function StepPanel({ drum }: { drum: boolean }) {
  const { store, step, transport } = useServices();
  const { project } = useEditorState();
  const snap = useSyncExternalStore(step.subscribe, step.getSnapshot);
  const rec = project.settings.recording;
  const sig = useSignatureMap(project);
  const options = GRID_DIVISIONS.flatMap((d) => (['straight', 'triplet', 'dotted'] as const).map((k) => ({ g: { division: d, kind: k }, t: gridTicks(project.ppq, { division: d, kind: k }) }))).filter((o) => o.t.den === 1);
  const set = (patch: Partial<typeof rec>) => store.updateSettings({ recording: { ...rec, ...patch } });
  return (
    <div className="step-panel" role="region" aria-label={t('ステップ入力')}>
      <strong>{drum ? t('ステップ入力（ドラム）') : t('ステップ入力（鍵盤）')}</strong>
      <span className="step-cursor" data-testid="step-cursor">
        {t('位置')} {sig.format(snap.cursor)}
      </span>
      <label title={t('⇧← 半分 / ⇧→ 倍 / {dot} 付点 / {alt}T 三連', { dot: drum ? `${ALT}.` : '.', alt: ALT })}>
        {t('音長')}{' '}
        <select value={rec.stepTicks} onChange={(e) => set({ stepTicks: Number(e.target.value) })} aria-label={t('ステップの長さ')}>
          {options.map((o) => (
            <option key={gridLabel(o.g)} value={o.t.num}>
              {gridLabel(o.g)}（{o.t.num}）
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('ゲート')}{' '}
        <NumberInput min={1} max={100} value={rec.gatePercent} onValue={(n) => set({ gatePercent: n })} style={{ width: '4em' }} />%
      </label>
      {drum && (
        <label>
          <input type="checkbox" checked={rec.drumAutoAdvance} onChange={(e) => set({ drumAutoAdvance: e.target.checked })} /> {t('自動で進む')}
        </label>
      )}
      <button onClick={() => step.back()} title={t('1 ステップ戻る（←）')}>{t('← 戻る')}</button>
      <button onClick={() => step.rest()} title={t('休符 / 次へ（→）')} data-testid="step-rest">{t('休符 →')}</button>
      <button onClick={() => step.tie()} title={t('直前の音をのばす（-）')}>{t('タイ')}</button>
      <button onClick={() => step.undoLast()} title={t('直前のステップを取り消す（Backspace）')}>{t('取消')}</button>
      <button onClick={() => step.setCursor(Math.round(transport.getPosition().tick))}>{t('再生位置へ')}</button>
      {snap.message && <span className="warn-text" data-testid="step-message">{snap.message}</span>}
      <span className="note">{drum ? t('パッドを押すと現在位置に入力（同じ位置に重ねられます）') : t('同時に押した鍵盤は和音として、すべて離したときに入力')}</span>
    </div>
  );
}
