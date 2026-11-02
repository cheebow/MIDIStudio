// Quantize dialog (ADR-043): note value, strength, shuffle and length handling, applied to the
// selected notes or to every note of the selected track. The last values are saved with the
// project; the Q key keeps quantizing with the editing grid without this dialog.
import { useState } from 'react';
import type { QuantizeSettings } from '../../core/model/types';
import { quantizeNotes, quantizeOptionsFrom } from '../../core/editing/quantize';
import { gridLabel, gridTicks, GRID_DIVISIONS } from '../../core/timing/grid';
import { formatRational } from '../../core/timing/rational';
import { useServices } from '../../app/store/context';
import { Dialog } from '../Dialog';
import { useNoteTarget } from './noteTarget';

const KINDS = ['straight', 'triplet', 'dotted'] as const;

export function QuantizeDialog({ onClose }: { onClose: () => void }) {
  const { store, reportError } = useServices();
  const { project, ids, fieldset } = useNoteTarget();
  const [s, setS] = useState<QuantizeSettings>(project.settings.quantize);
  const [message, setMessage] = useState<string | null>(null);
  const set = (p: Partial<QuantizeSettings>) => setS((v) => ({ ...v, ...p }));
  const grid = gridTicks(project.ppq, s.grid);

  const apply = () => {
    try {
      const cmd = quantizeNotes(project, ids, quantizeOptionsFrom(project.ppq, s));
      store.updateSettings({ quantize: s });
      if (!cmd) {
        setMessage('動かすノートはありません。');
        return;
      }
      store.run(cmd);
      onClose();
    } catch (e) {
      reportError((e as Error).message);
    }
  };

  return (
    <Dialog title="クオンタイズ" onClose={onClose}>
      <form
        className="form-grid quantize-form"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        {fieldset}
        <label>
          音符
          <select
            aria-label="音符"
            value={`${s.grid.division}:${s.grid.kind}`}
            onChange={(e) => {
              const [d, k] = e.target.value.split(':');
              set({ grid: { division: Number(d), kind: k as QuantizeSettings['grid']['kind'] } });
            }}
          >
            {GRID_DIVISIONS.flatMap((division) => KINDS.map((kind) => ({ division, kind }))).map((g) => (
              <option key={`${g.division}:${g.kind}`} value={`${g.division}:${g.kind}`}>
                {gridLabel(g)}
                {g.kind === 'triplet' ? '（3 連符）' : g.kind === 'dotted' ? '（付点）' : ''}
              </option>
            ))}
          </select>
          {grid.den !== 1 && <span className="note">1 グリッド = {formatRational(grid)} Tick: 最も近い Tick に丸めます</span>}
        </label>
        <label>
          強さ {s.strength}%
          <span className="row">
            <input type="range" aria-label="強さ" min={0} max={100} step={5} value={s.strength} onChange={(e) => set({ strength: Number(e.target.value) })} />
            <input type="number" aria-label="強さ（%）" min={0} max={100} value={s.strength} onChange={(e) => set({ strength: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className="pct" />
          </span>
        </label>
        <label>
          シャッフル {s.swing}%{s.swing <= 50 ? '（なし）' : ''}
          <span className="row">
            <input type="range" aria-label="シャッフル" min={50} max={75} step={1} value={s.swing} onChange={(e) => set({ swing: Number(e.target.value) })} />
            <input type="number" aria-label="シャッフル（%）" min={50} max={75} value={s.swing} onChange={(e) => set({ swing: Math.max(50, Math.min(75, Number(e.target.value) || 50)) })} className="pct" />
          </span>
          <span className="note">50 = なし、67 = 3 連符、75 = 付点</span>
        </label>
        <fieldset>
          <legend>長さ</legend>
          <label>
            <input type="radio" name="q-lengths" checked={s.lengths === 'keep'} onChange={() => set({ lengths: 'keep' })} /> 変えない
          </label>
          <label>
            <input type="radio" name="q-lengths" checked={s.lengths === 'ends'} onChange={() => set({ lengths: 'ends' })} /> ノートの終わりもグリッドに合わせる
          </label>
          <label>
            <input type="radio" name="q-lengths" checked={s.lengths === 'grid'} onChange={() => set({ lengths: 'grid' })} /> 長さをグリッドの倍数に揃える
          </label>
        </fieldset>
        {message && <p className="note warn-text">{message}</p>}
        <div className="row">
          <button type="submit" className="primary" disabled={ids.length === 0} data-testid="quantize-apply">
            適用（{ids.length} 個）
          </button>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </form>
    </Dialog>
  );
}
