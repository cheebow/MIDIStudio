// Legato dialog (PT-04).
import { useCallback, useState } from 'react';
import type { MidiProject } from '../../core/model/types';
import { legatoNotes, type LegatoMode } from '../../core/editing/perform';
import { t } from '../../i18n';
import { Choice, PerformDialog } from './PerformDialog';

let last: LegatoMode = 'connect';

export function LegatoDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<LegatoMode>(last);
  const compute = useCallback((base: MidiProject, ids: string[]) => legatoNotes(base, ids, { mode }), [mode]);
  return (
    <PerformDialog title={t('レガート調整')} testId="legato-dialog" compute={compute} onClose={onClose}>
      <Choice<LegatoMode>
        legend={t('次のノートとの関係')}
        name="legato-mode"
        value={mode}
        onChange={(m) => (last = m, setMode(m))}
        options={[
          { value: 'connect', label: t('つなぐ'), hint: t('次のノートの開始位置で終わる') },
          { value: 'overlap', label: t('少し重ねる'), hint: t('次のノートより少し後で終わる') },
          { value: 'detach', label: t('少し離す'), hint: t('次のノートより少し前で終わる') },
        ]}
      />
    </PerformDialog>
  );
}
