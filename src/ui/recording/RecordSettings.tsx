import type { RecordingSettings } from '../../core/model/types';

export function RecordSettingsForm({ value, onChange }: { value: RecordingSettings; onChange: (v: RecordingSettings) => void }) {
  const set = (p: Partial<RecordingSettings>) => onChange({ ...value, ...p });
  return (
    <div className="form-grid">
      <label>
        録音モード
        <select value={value.mode} onChange={(e) => set({ mode: e.target.value as RecordingSettings['mode'] })}>
          <option value="overdub">オーバーダブ（重ねる）</option>
          <option value="replace">置き換え（録音範囲の既存ノート・CC を消す）</option>
        </select>
      </label>
      <label>
        カウントイン
        <select value={value.countInBars} onChange={(e) => set({ countInBars: Number(e.target.value) as RecordingSettings['countInBars'] })}>
          {[0, 1, 2, 4].map((n) => (
            <option key={n} value={n}>
              {n} 小節
            </option>
          ))}
        </select>
        <span className="note">最後の 1 拍で弾いた音は開始位置に揃えます。</span>
      </label>
      <label>
        <span>
          <input type="checkbox" checked={value.armFollowsSelection} onChange={(e) => set({ armFollowsSelection: e.target.checked })} /> トラックを選ぶと、そのトラックを録音待機にする
        </span>
        <span className="note">選んだトラックだけが録音待機（R）になります。オフのときは R を自分で押します。</span>
      </label>
      <label>
        <span>
          <input type="checkbox" checked={value.punch} onChange={(e) => set({ punch: e.target.checked })} /> ループ範囲でパンチイン / アウト
        </span>
        <span className="note">範囲外の入力は記録しません。範囲の終わりをこえるノートは終わりで切ります。</span>
      </label>
      <label>
        ループ録音（LOOP ON・パンチ OFF のとき）
        <select value={value.loopTakes} onChange={(e) => set({ loopTakes: e.target.value as RecordingSettings['loopTakes'] })}>
          <option value="merge">すべてのテイクを重ねる</option>
          <option value="last">最後のテイクだけ残す</option>
        </select>
      </label>
      <label>
        <span>
          <input type="checkbox" checked={value.quantize} onChange={(e) => set({ quantize: e.target.checked })} /> 録音したノートをグリッドにクオンタイズ
        </span>
        <span className="note">既定はオフ（演奏どおりの位置で記録し、後から Edit → クオンタイズ）。</span>
      </label>
      <label>
        レイテンシ補正（ms）
        <input type="number" min={-500} max={500} value={value.latencyMs} onChange={(e) => set({ latencyMs: Math.max(-500, Math.min(500, Number(e.target.value) || 0)) })} />
        <span className="note">入力が遅れて記録される場合に、その分を前へずらします。環境により異なるため実測して設定してください。</span>
      </label>
    </div>
  );
}
