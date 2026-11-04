// Strum / cutting dialog (PT-02): one dialog, the style switch shows the cutting presets.
import { useCallback, useState } from 'react';
import type { MidiProject } from '../../core/model/types';
import { strumChords, type CuttingPreset, type StrokeMode, type StrumOptions, type StrumSpeed, type StrumStyle } from '../../core/editing/perform';
import { t } from '../../i18n';
import { Choice, PerformDialog } from './PerformDialog';

let last: StrumOptions = { style: 'strum', stroke: 'auto', speed: 'normal', natural: true, cutting: 'pop' };

export function StrumDialog({ onClose }: { onClose: () => void }) {
  const [o, setO] = useState<StrumOptions>(last);
  const set = (p: Partial<StrumOptions>) => setO((v) => (last = { ...v, ...p }));
  const compute = useCallback((base: MidiProject, ids: string[]) => strumChords(base, ids, o), [o]);
  return (
    <PerformDialog title={t('ストラム')} testId="strum-dialog" compute={compute} onClose={onClose}>
      <Choice<StrumStyle>
        legend={t('奏法')}
        name="strum-style"
        value={o.style}
        onChange={(style) => set({ style })}
        options={[
          { value: 'strum', label: t('通常ストラム') },
          { value: 'cutting', label: t('カッティング'), hint: t('短いゲートとアクセント') },
        ]}
      />
      {o.style === 'cutting' && (
        <Choice<CuttingPreset>
          legend={t('カッティングのタイプ')}
          name="cutting-preset"
          value={o.cutting}
          onChange={(cutting) => set({ cutting })}
          options={[
            { value: 'pop', label: t('ポップ'), hint: t('軽く自然に') },
            { value: 'funk', label: t('ファンク'), hint: t('とても短く、裏拍をはっきり') },
            { value: 'rock', label: t('ロック'), hint: t('強いアタック') },
          ]}
        />
      )}
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
