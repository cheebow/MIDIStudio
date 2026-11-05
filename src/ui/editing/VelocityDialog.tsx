// Velocity dialog (ADR-050): set / add / scale / ramp over the chosen notes.
import { useState } from 'react';
import { editVelocities, type VelocityOp } from '../../core/editing/velocity';
import { useServices } from '../../app/store/context';
import { t } from '../../i18n';
import { Dialog } from '../Dialog';
import { useNoteTarget } from './noteTarget';
import { NumberInput } from '../NumberInput';

type Kind = VelocityOp['kind'];

export function VelocityDialog({ onClose }: { onClose: () => void }) {
  const { store, reportError } = useServices();
  const { project, ids, fieldset } = useNoteTarget();
  const [kind, setKind] = useState<Kind>('set');
  const [value, setValue] = useState(100);
  const [delta, setDelta] = useState(10);
  const [percent, setPercent] = useState(80);
  const [from, setFrom] = useState(40);
  const [to, setTo] = useState(110);
  const op = (): VelocityOp => (kind === 'set' ? { kind, value } : kind === 'add' ? { kind, delta } : kind === 'scale' ? { kind, percent } : { kind, from, to });
  const apply = () => {
    try {
      const cmd = editVelocities(project, ids, op());
      if (cmd) store.run(cmd);
      onClose();
    } catch (e) {
      reportError((e as Error).message);
    }
  };
  const num = (label: string, v: number, set: (n: number) => void, min: number, max: number) => (
    <NumberInput aria-label={label} min={min} max={max} value={v} onValue={set} className="pct" />
  );
  const option = (k: Kind, label: string, control: React.ReactNode) => (
    <label>
      <input type="radio" name="velocity-op" checked={kind === k} onChange={() => setKind(k)} /> {label} {control}
    </label>
  );
  return (
    <Dialog title={t('ベロシティ')} onClose={onClose}>
      <form
        className="form-grid quantize-form"
        data-testid="velocity-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        {fieldset}
        <fieldset>
          <legend>{t('変更')}</legend>
          {option('set', t('一定にする'), num(t('値'), value, setValue, 1, 127))}
          {option('add', t('加算'), num(t('加算する量'), delta, setDelta, -126, 126))}
          {option('scale', t('倍率'), <>{num(t('倍率（%）'), percent, setPercent, 1, 400)} %</>)}
          {option('ramp', t('傾斜'), <>{num(t('始点'), from, setFrom, 1, 127)} → {num(t('終点'), to, setTo, 1, 127)}</>)}
        </fieldset>
        <div className="row">
          <button type="submit" className="primary" disabled={ids.length === 0} data-testid="velocity-apply">
            {t('適用（{n} 個）', { n: ids.length })}
          </button>
          <button type="button" onClick={onClose}>
            {t('キャンセル')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
