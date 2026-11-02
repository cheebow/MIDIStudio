// Humanize dialog (ADR-050): random offsets of timing, velocity and length. The values are saved
// with the project.
import { useState } from 'react';
import type { HumanizeSettings } from '../../core/model/types';
import { humanizeNotes } from '../../core/editing/humanize';
import { useServices } from '../../app/store/context';
import { Dialog } from '../Dialog';
import { useNoteTarget } from './noteTarget';

export function HumanizeDialog({ onClose }: { onClose: () => void }) {
  const { store, reportError } = useServices();
  const { project, ids, fieldset } = useNoteTarget();
  const [s, setS] = useState<HumanizeSettings>(project.settings.humanize);
  const set = (p: Partial<HumanizeSettings>) => setS((v) => ({ ...v, ...p }));
  const apply = () => {
    try {
      const cmd = humanizeNotes(project, ids, s);
      store.updateSettings({ humanize: s });
      if (cmd) store.run(cmd);
      onClose();
    } catch (e) {
      reportError((e as Error).message);
    }
  };
  const row = (label: string, key: keyof HumanizeSettings, max: number, unit: string, step = 1) => (
    <label>
      {label} ±{s[key]}
      {unit}
      <span className="row">
        <input type="range" aria-label={label} min={0} max={max} step={step} value={s[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
        <input type="number" aria-label={`${label}（${unit}）`} min={0} max={max} value={s[key]} onChange={(e) => set({ [key]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) })} className="pct" />
      </span>
    </label>
  );
  return (
    <Dialog title="ヒューマナイズ" onClose={onClose}>
      <form
        className="form-grid quantize-form"
        data-testid="humanize-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        {fieldset}
        {row('位置', 'timingTicks', Math.max(1, project.ppq / 2), ' Tick')}
        {row('ベロシティ', 'velocity', 64, '')}
        {row('長さ', 'lengthPercent', 50, '%')}
        <div className="row">
          <button type="submit" className="primary" disabled={ids.length === 0} data-testid="humanize-apply">
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
