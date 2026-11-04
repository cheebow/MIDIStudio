// Shared shell of the performance-tool dialogs (ADR-077): target chooser, the tool's own controls,
// what the preview found, 試聴 / 適用 / キャンセル. The preview is live in every view while open.
import { useCallback, type ReactNode } from 'react';
import type { MidiProject } from '../../core/model/types';
import type { TransformResult } from '../../core/editing/perform/types';
import { useEditorState, useServices } from '../../app/store/context';
import { t } from '../../i18n';
import { Dialog } from '../Dialog';
import { useNoteTarget } from '../editing/noteTarget';
import { useAudition } from './useAudition';
import { usePerformPreview } from './usePerformPreview';

export function PerformDialog({ title, testId, compute, chords = true, children, onClose }: { title: string; testId: string; compute: (base: MidiProject, ids: string[]) => TransformResult; /** show the chord count */ chords?: boolean; children: ReactNode; onClose: () => void }) {
  const { reportError, audioReady } = useServices();
  const { project: committed } = useEditorState();
  const { ids, fieldset } = useNoteTarget();
  const bound = useCallback((base: MidiProject) => compute(base, ids), [compute, ids]);
  const { result, error, apply, cancel } = usePerformPreview(bound);
  const audition = useAudition();
  const close = (commit: boolean) => {
    audition.stop();
    if (commit) {
      if (!apply()) return;
    } else cancel();
    onClose();
  };
  const range = (): { start: number; end: number } | null => {
    const sel = new Set(ids);
    let start = Infinity;
    let end = -Infinity;
    for (const tr of committed.tracks)
      for (const e of tr.events) {
        if (e.kind !== 'note' || !sel.has(e.id)) continue;
        start = Math.min(start, e.tick);
        end = Math.max(end, e.tick + e.durationTicks);
      }
    return start === Infinity ? null : { start, end: end + Math.round(committed.ppq / 4) };
  };
  const onAudition = () => {
    if (audition.playing) {
      audition.stop();
      return;
    }
    const r = range();
    if (r) audition.start(r.start, r.end).catch((e: unknown) => reportError((e as Error).message));
  };
  const message = error ? t(error) : result.notice ? t(result.notice) : null;
  return (
    <Dialog title={title} onClose={() => close(false)}>
      <form
        className="form-grid quantize-form"
        data-testid={testId}
        onSubmit={(e) => {
          e.preventDefault();
          close(true);
        }}
      >
        {fieldset}
        {children}
        <p className="perform-status" data-testid="perform-status">
          {chords ? t('対象: ノート {notes} 個、和音 {groups} 個', { notes: result.stats.notes, groups: result.stats.groups }) : t('対象: ノート {notes} 個', { notes: result.stats.notes })}
          {result.command ? '' : ids.length > 0 && !message ? ` — ${t('変わるノートはありません')}` : ''}
        </p>
        {message && (
          <p className={error ? 'error' : 'perform-notice'} role="status" data-testid="perform-notice">
            {message}
          </p>
        )}
        <div className="row">
          <button type="submit" className="primary" disabled={ids.length === 0 || !result.command} title={ids.length > 0 && !result.command ? t('この設定では変わるノートがありません') : undefined} data-testid="perform-apply">
            {t('適用（{n} 個）', { n: ids.length })}
          </button>
          <button type="button" onClick={onAudition} disabled={ids.length === 0 || !audioReady} title={audioReady ? undefined : t('音源（SoundFont）の準備ができていません')} data-testid="perform-audition">
            {audition.playing ? t('停止') : t('試聴')}
          </button>
          <button type="button" onClick={() => close(false)} data-testid="perform-cancel">
            {t('キャンセル')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** A radio group of presets. */
export function Choice<T extends string>({ legend, name, value, options, onChange }: { legend: string; name: string; value: T; options: readonly { value: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} /> {o.label}
          {o.hint && <span className="muted"> — {o.hint}</span>}
        </label>
      ))}
    </fieldset>
  );
}
