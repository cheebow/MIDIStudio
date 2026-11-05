import type { RecordingSettings } from '../../core/model/types';
import { t } from '../../i18n';
import { NumberInput } from '../NumberInput';

export function RecordSettingsForm({ value, onChange }: { value: RecordingSettings; onChange: (v: RecordingSettings) => void }) {
  const set = (p: Partial<RecordingSettings>) => onChange({ ...value, ...p });
  return (
    <div className="form-grid">
      <label>
        {t('録音モード')}
        <select value={value.mode} onChange={(e) => set({ mode: e.target.value as RecordingSettings['mode'] })}>
          <option value="overdub">{t('オーバーダブ（重ねる）')}</option>
          <option value="replace">{t('置き換え（録音範囲の既存ノート・CC を消す）')}</option>
        </select>
      </label>
      <label>
        {t('カウントイン')}
        <select value={value.countInBars} onChange={(e) => set({ countInBars: Number(e.target.value) as RecordingSettings['countInBars'] })}>
          {[0, 1, 2, 4].map((n) => (
            <option key={n} value={n}>
              {t('{n} 小節', { n })}
            </option>
          ))}
        </select>
        <span className="note">{t('最後の 1 拍で弾いた音は開始位置に揃えます。')}</span>
      </label>
      <label>
        <span>
          <input type="checkbox" checked={value.punch} onChange={(e) => set({ punch: e.target.checked })} /> {t('ループ範囲でパンチイン / アウト')}
        </span>
        <span className="note">{t('範囲外の入力は記録しません。範囲の終わりをこえるノートは終わりで切ります。')}</span>
      </label>
      <label>
        {t('ループ録音（LOOP ON・パンチ OFF のとき）')}
        <select value={value.loopTakes} onChange={(e) => set({ loopTakes: e.target.value as RecordingSettings['loopTakes'] })}>
          <option value="merge">{t('すべてのテイクを重ねる')}</option>
          <option value="last">{t('最後のテイクだけ残す')}</option>
        </select>
      </label>
      <label>
        <span>
          <input type="checkbox" checked={value.quantize} onChange={(e) => set({ quantize: e.target.checked })} /> {t('録音したノートをグリッドにクオンタイズ')}
        </span>
        <span className="note">{t('既定はオフ（演奏どおりの位置で記録し、後から Edit → クオンタイズ）。')}</span>
      </label>
      <label>
        {t('レイテンシ補正（ms）')}
        <NumberInput min={-500} max={500} value={value.latencyMs} onValue={(n) => set({ latencyMs: n })} />
        <span className="note">{t('入力が遅れて記録される場合に、その分を前へずらします。環境により異なるため実測して設定してください。')}</span>
      </label>
    </div>
  );
}
