// Velocity shaper dialog (PT-05).
import { useCallback, useState } from 'react';
import type { MidiProject } from '../../core/model/types';
import { shapeVelocities, type VelocityShape } from '../../core/editing/perform';
import { t } from '../../i18n';
import { Choice, PerformDialog } from './PerformDialog';

let last: VelocityShape = 'crescendo';

export function VelocityShaperDialog({ onClose }: { onClose: () => void }) {
  const [shape, setShape] = useState<VelocityShape>(last);
  const compute = useCallback((base: MidiProject, ids: string[]) => shapeVelocities(base, ids, { shape }), [shape]);
  return (
    <PerformDialog title={t('ベロシティ・シェイパー')} testId="velocity-shaper-dialog" compute={compute} onClose={onClose}>
      <Choice<VelocityShape>
        legend={t('強弱のパターン')}
        name="velocity-shape"
        value={shape}
        onChange={(s) => (last = s, setShape(s))}
        options={[
          { value: 'crescendo', label: t('クレッシェンド'), hint: t('徐々に強く') },
          { value: 'decrescendo', label: t('デクレッシェンド'), hint: t('徐々に弱く') },
          { value: 'alternate', label: t('交互アクセント'), hint: t('和音ごとに強・弱を交互に') },
          { value: 'beat', label: t('拍アクセント'), hint: t('小節の強拍を強く、拍の裏を弱く') },
        ]}
      />
    </PerformDialog>
  );
}
