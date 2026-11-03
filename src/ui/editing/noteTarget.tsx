// Shared "which notes" chooser for the note dialogs (quantize, humanize, velocity): the selected
// notes, or every note of the selected track when nothing is selected.
import { useMemo, useState } from 'react';
import { selectedTrack } from '../../core/model/selectedTrack';
import { useEditorState } from '../../app/store/context';
import { t } from '../../i18n';

export function useNoteTarget() {
  const { project, selection } = useEditorState();
  const track = selectedTrack(project);
  const selectedNotes = useMemo(() => {
    const ids: string[] = [];
    for (const t of project.tracks) for (const e of t.events) if (e.kind === 'note' && selection.eventIds.has(e.id)) ids.push(e.id);
    return ids;
  }, [project, selection.eventIds]);
  const trackNotes = useMemo(() => (track ? track.events.filter((e) => e.kind === 'note').map((e) => e.id) : []), [track]);
  const [target, setTarget] = useState<'selection' | 'track'>(selectedNotes.length > 0 ? 'selection' : 'track');
  const ids = target === 'selection' ? selectedNotes : trackNotes;
  const fieldset = (
    <fieldset>
      <legend>{t('対象')}</legend>
      <label>
        <input type="radio" name="note-target" checked={target === 'selection'} disabled={selectedNotes.length === 0} onChange={() => setTarget('selection')} /> {t('選択中のノート（{n} 個）', { n: selectedNotes.length })}
      </label>
      <label>
        <input type="radio" name="note-target" checked={target === 'track'} disabled={!track} onChange={() => setTarget('track')} /> {track ? t('トラック「{name}」のすべてのノート（{n} 個）', { name: track.name, n: trackNotes.length }) : t('トラックがありません')}
      </label>
    </fieldset>
  );
  return { project, track, ids, fieldset };
}
