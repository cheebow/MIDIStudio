// Guitar voicing dialog (PT-01).
import { useCallback, useState } from 'react';
import type { MidiProject } from '../../core/model/types';
import { voiceChords, type VoicingPreset } from '../../core/editing/perform';
import { t } from '../../i18n';
import { Choice, PerformDialog } from './PerformDialog';

let last: VoicingPreset = 'auto';

export function VoicingDialog({ onClose }: { onClose: () => void }) {
  const [voicing, setVoicing] = useState<VoicingPreset>(last);
  const compute = useCallback((base: MidiProject, ids: string[]) => voiceChords(base, ids, { voicing }), [voicing]);
  return (
    <PerformDialog title={t('ギターボイシング')} testId="voicing-dialog" compute={compute} onClose={onClose}>
      <Choice<VoicingPreset>
        legend={t('ボイシング')}
        name="voicing-preset"
        value={voicing}
        onChange={(v) => (last = v, setVoicing(v))}
        options={[
          { value: 'auto', label: t('自動'), hint: t('押さえやすく、前のコードから遠くない形') },
          { value: 'open', label: t('オープンコード優先'), hint: t('開放弦を使う形') },
          { value: 'high', label: t('ハイポジション優先'), hint: t('5 フレットより上の形') },
        ]}
      />
      <p className="muted">{t('標準チューニング（E A D G B E）で押さえられる形に置き換えます。maj / m / 7 / maj7 / m7 / sus2 / sus4 / dim / aug に対応。')}</p>
    </PerformDialog>
  );
}
