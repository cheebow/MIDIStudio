// Strum dialog (PT-02, ADR-092): 編集 › ノート › ストラム… and 右クリック › 入力支援 › ストラム….
import { useCallback, useState } from 'react';
import type { MidiProject } from '../../core/model/types';
import { strumChords, type StrokeMode, type StrumOptions, type StrumSpeed } from '../../core/editing/perform';
import { t } from '../../i18n';
import { Choice, PerformDialog } from './PerformDialog';

let last: StrumOptions = { stroke: 'auto', speed: 'normal', natural: true };

export function StrumDialog({ onClose }: { onClose: () => void }) {
  const [o, setO] = useState<StrumOptions>(last);
  const set = (p: Partial<StrumOptions>) => setO((v) => (last = { ...v, ...p }));
  const compute = useCallback((base: MidiProject, ids: string[]) => strumChords(base, ids, o), [o]);
  return (
    <PerformDialog title={t('ストラム')} testId="strum-dialog" compute={compute} onClose={onClose}>
      <Choice<StrokeMode>
        legend={t('ストローク')}
        name="strum-stroke"
        value={o.stroke}
        onChange={(stroke) => set({ stroke })}
        options={[
          { value: 'auto', label: t('自動'), hint: t('拍の位置からダウン / アップを決める') },
          { value: 'down', label: t('ダウン固定') },
          { value: 'up', label: t('アップ固定') },
        ]}
      />
      <Choice<StrumSpeed>
        legend={t('ストラム速度')}
        name="strum-speed"
        value={o.speed}
        onChange={(speed) => set({ speed })}
        options={[
          { value: 'slow', label: t('ゆっくり') },
          { value: 'normal', label: t('普通') },
          { value: 'fast', label: t('速い') },
        ]}
      />
      <label>
        <input type="checkbox" checked={o.natural} onChange={(e) => set({ natural: e.target.checked })} /> {t('自然な強弱')}
        <span className="muted"> — {t('弦ごとのわずかなずれと強さの差')}</span>
      </label>
    </PerformDialog>
  );
}
