// Arpeggio dialog (PT-03; note length and ends in ADR-092): pattern, the length of each note (fitted
// to the chord automatically, or a note value repeating the pattern to the chord's end) and how long
// each note sounds (cut, or held to the end of the chord like a slow strum). With the automatic
// length, the dialog names the note value it comes to for the target chords.
import { useCallback, useState } from 'react';
import type { MidiProject } from '../../core/model/types';
import { arpeggiateChords, arpeggioStepLengths, noteValueName, type ArpeggioEnds, type ArpeggioOptions, type ArpeggioPattern, type ArpeggioRhythm } from '../../core/editing/perform';
import { t } from '../../i18n';
import { Choice, PerformDialog } from './PerformDialog';

const LENGTHS: readonly { value: ArpeggioRhythm; label: string }[] = [
  { value: 'even', label: '和音に合わせて自動' },
  { value: '4', label: '4 分' },
  { value: '8', label: '8 分' },
  { value: '8t', label: '3 連 8 分' },
  { value: '16', label: '16 分' },
  { value: '16t', label: '3 連 16 分' },
  { value: '32', label: '32 分' },
];

let last: Required<ArpeggioOptions> = { pattern: 'up', rhythm: 'even', ends: 'gate' };

/** "3 連 4 分（4 和音）" / "3 連 4 分（3 和音）、8 分（1 和音）" / "約 213 Tick（1 和音）" */
function autoLengthText(project: MidiProject, ids: string[], opts: ArpeggioOptions): string | null {
  const steps = arpeggioStepLengths(project, ids, { ...opts, rhythm: 'even' });
  if (steps.length === 0) return null;
  const counts = new Map<string, number>();
  for (const s of steps) {
    const name = noteValueName(s, project.ppq);
    const label = name ? t(name) : t('約 {n} Tick', { n: Math.round(s) });
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, n]) => t('{label}（{n} 和音）', { label, n })).join(t('、'));
}

export function ArpeggioDialog({ onClose }: { onClose: () => void }) {
  const [o, setO] = useState<Required<ArpeggioOptions>>(last);
  const set = (p: Partial<ArpeggioOptions>) => setO((v) => (last = { ...v, ...p }));
  const compute = useCallback((base: MidiProject, ids: string[]) => arpeggiateChords(base, ids, o), [o]);
  return (
    <PerformDialog title={t('アルペジオ')} testId="arpeggio-dialog" compute={compute} onClose={onClose}>
      {({ project, ids }) => {
        const auto = o.rhythm === 'even' ? autoLengthText(project, ids, o) : null;
        return (
          <>
            <Choice<ArpeggioPattern>
              legend={t('パターン')}
              name="arpeggio-pattern"
              value={o.pattern}
              onChange={(pattern) => set({ pattern })}
              options={[
                { value: 'up', label: t('上昇'), hint: t('低い音から高い音へ') },
                { value: 'down', label: t('下降'), hint: t('高い音から低い音へ') },
                { value: 'updown', label: t('往復'), hint: t('低→高→低') },
              ]}
            />
            <label>
              {t('1 音の長さ')}
              <select value={o.rhythm} onChange={(e) => set({ rhythm: e.target.value as ArpeggioRhythm })} data-testid="arpeggio-length">
                {LENGTHS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {t(l.label)}
                  </option>
                ))}
              </select>
              <span className="muted" data-testid="arpeggio-length-note">
                {o.rhythm === 'even' ? (auto ? `→ ${auto}` : '') : t('和音が終わるまでくり返します')}
              </span>
            </label>
            <Choice<ArpeggioEnds>
              legend={t('音の終わり')}
              name="arpeggio-ends"
              value={o.ends}
              onChange={(ends) => set({ ends })}
              options={[
                { value: 'gate', label: t('1 音ずつ切る'), hint: t('次の音の手前で離す') },
                { value: 'hold', label: t('和音の終わりまで伸ばす'), hint: t('鳴り始めだけずらす（ゆっくりしたストラムのよう）') },
              ]}
            />
          </>
        );
      }}
    </PerformDialog>
  );
}
