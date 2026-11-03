// "Change selected rows" dialog of the list (ADR-066): position shift, gate time, channel, value
// and note number over the selection. Transpose, quantize, humanize and velocity ratios keep their
// own menu items / dialogs.
import { useState } from 'react';
import { t } from '../../i18n';
import { Dialog } from '../Dialog';
import { useEditorState, useServices } from '../../app/store/context';
import { batchEditRows, batchSummary, type ListBatchOp } from '../../core/list/listTransform';
import { parseTicksInput } from '../../core/list/listEdit';
import { parseNoteName } from '../../core/list/noteNames';

type Kind = ListBatchOp['kind'];

export function ListBatchDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { store, reportError } = useServices();
  const { project } = useEditorState();
  const unit = project.settings.listDisplayUnit;
  const s = batchSummary(project, ids);
  const [kind, setKind] = useState<Kind>('shift');
  const [shift, setShift] = useState('0');
  const [gate, setGate] = useState(String(project.ppq));
  const [percent, setPercent] = useState(50);
  const [channel, setChannel] = useState<string>('track');
  const [value, setValue] = useState(100);
  const [delta, setDelta] = useState(10);
  const [key, setKey] = useState('C4');

  const ticksOf = (text: string): number => {
    const m = /^\s*([+-]?)\s*(.+)$/.exec(text);
    if (!m) throw new Error(t('数値を入力してください。'));
    const r = parseTicksInput(m[2], unit, project.ppq);
    if (!r.ok) throw new Error(r.message);
    return m[1] === '-' ? -r.ticks : r.ticks;
  };

  const op = (): ListBatchOp => {
    switch (kind) {
      case 'shift':
        return { kind, deltaTicks: ticksOf(shift) };
      case 'gate-set':
        return { kind, ticks: ticksOf(gate) };
      case 'gate-percent':
        return { kind, percent };
      case 'channel':
        return { kind, channel: channel === 'track' ? null : Number(channel) };
      case 'value-set':
        return { kind, value };
      case 'value-add':
        return { kind, delta };
      case 'key-set': {
        const p = /^\d+$/.test(key.trim()) ? Number(key.trim()) : parseNoteName(key);
        if (p === null) throw new Error(t('ノート番号は 0〜127 です。'));
        return { kind, pitch: p };
      }
    }
  };

  const apply = () => {
    try {
      const cmd = batchEditRows(project, ids, op());
      if (cmd) store.run(cmd);
      onClose();
    } catch (e) {
      reportError((e as Error).message);
    }
  };

  const option = (k: Kind, label: string, control: React.ReactNode, count: number) => (
    <label>
      <input type="radio" name="list-batch-op" checked={kind === k} onChange={() => setKind(k)} disabled={count === 0} /> {label} {control} <span className="note">({t('{n} 行', { n: count })})</span>
    </label>
  );
  const unitLabel = unit === 'classic48' ? t('Classic 48 単位') : 'Tick';

  return (
    <Dialog title={t('選択行の一括変更')} onClose={onClose}>
      <form
        className="form-grid quantize-form"
        data-testid="list-batch-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <p className="note">{t('選択中の {n} 行に適用します。種類に合わない行は変わりません。', { n: s.total })}</p>
        <fieldset>
          <legend>{t('変更')}</legend>
          {option('shift', t('位置をずらす'), <input value={shift} onChange={(e) => setShift(e.target.value)} aria-label={t('移動量')} placeholder={`±${unitLabel}`} className="pct" data-testid="batch-shift" />, s.total)}
          {option('gate-set', t('GT を一定にする'), <input value={gate} onChange={(e) => setGate(e.target.value)} aria-label={t('GT')} placeholder={unitLabel} className="pct" />, s.notes)}
          {option('gate-percent', t('GT を比率で'), <><input type="number" min={1} max={400} value={percent} onChange={(e) => setPercent(Math.max(1, Math.min(400, Number(e.target.value) || 1)))} aria-label={t('GT の比率（%）')} className="pct" data-testid="batch-gate-percent" /> %</>, s.notes)}
          {option(
            'channel',
            t('チャンネル'),
            <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label={t('チャンネル')}>
              <option value="track">{t('トラックに従う')}</option>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={String(i)}>
                  {i + 1}
                </option>
              ))}
            </select>,
            s.channel,
          )}
          {option('value-set', t('値を一定にする'), <input type="number" min={-8192} max={8191} value={value} onChange={(e) => setValue(Number(e.target.value) || 0)} aria-label={t('値')} className="pct" data-testid="batch-value" />, s.valued)}
          {option('value-add', t('値を加算'), <input type="number" min={-8192} max={8191} value={delta} onChange={(e) => setDelta(Number(e.target.value) || 0)} aria-label={t('加算する量')} className="pct" />, s.valued)}
          {option('key-set', t('ノート番号を一定にする'), <input value={key} onChange={(e) => setKey(e.target.value)} aria-label={t('ノート番号または音名')} className="pct" />, s.keyed)}
        </fieldset>
        <div className="row">
          <button type="submit" className="primary" disabled={s.total === 0} data-testid="list-batch-apply">
            {t('適用（{n} 行）', { n: s.total })}
          </button>
          <button type="button" onClick={onClose}>
            {t('キャンセル')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
