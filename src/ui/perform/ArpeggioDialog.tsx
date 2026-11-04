// Arpeggio dialog (PT-03).
import { useCallback, useState } from 'react';
import type { MidiProject } from '../../core/model/types';
import { arpeggiateChords, type ArpeggioPattern } from '../../core/editing/perform';
import { t } from '../../i18n';
import { Choice, PerformDialog } from './PerformDialog';

let last: ArpeggioPattern = 'up';

export function ArpeggioDialog({ onClose }: { onClose: () => void }) {
  const [pattern, setPattern] = useState<ArpeggioPattern>(last);
  const compute = useCallback((base: MidiProject, ids: string[]) => arpeggiateChords(base, ids, { pattern }), [pattern]);
  return (
    <PerformDialog title={t('アルペジオ')} testId="arpeggio-dialog" compute={compute} onClose={onClose}>
      <Choice<ArpeggioPattern>
        legend={t('パターン')}
        name="arpeggio-pattern"
        value={pattern}
        onChange={(p) => (last = p, setPattern(p))}
        options={[
          { value: 'up', label: t('上昇'), hint: t('低い音から高い音へ') },
          { value: 'down', label: t('下降'), hint: t('高い音から低い音へ') },
          { value: 'updown', label: t('往復'), hint: t('低→高→低') },
        ]}
      />
    </PerformDialog>
  );
}
