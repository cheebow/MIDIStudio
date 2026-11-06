// Pieces shared by the guitar-voicing dialogs (ADR-091): the preview (preview synth only, released on
// close) and the target-track select (a melodic track or a new guitar track created on insert).
import { useEffect, useRef } from 'react';
import { useEditorState, useServices } from '../../app/store/context';
import { freeChannel, GUITAR_PROGRAM } from '../../core/guitar/insertVoicing';
import { t } from '../../i18n';

export const NEW_TRACK = '__new__';
const PREVIEW_SOURCE = 'guitar';
const PREVIEW_MS = 1500;

/**
 * play(pitches): sounds a form at once on the target track's sound (or GM 25 on a free channel for a
 * new track) and stops it after a moment. Everything stops when the dialog closes, and the focus goes
 * back to `returnFocus`. Nothing is written to the song.
 */
export function useVoicingPreview(targetTrackId: string | null, returnFocus?: HTMLElement | null): { play: (pitches: readonly number[]) => void; ready: boolean } {
  const { transport, audioReady } = useServices();
  const { project } = useEditorState();
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    transport.releaseAllPreviews(PREVIEW_SOURCE);
  };
  useEffect(
    () => () => {
      stop();
      if (returnFocus?.isConnected) returnFocus.focus();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, on close
    [],
  );
  const play = (pitches: readonly number[]) => {
    stop();
    const velocity = project.inputPresets.defaultVelocity;
    for (const p of pitches) {
      if (targetTrackId) transport.auditionNote(targetTrackId, p, velocity, PREVIEW_SOURCE);
      else transport.auditionProgram('A', freeChannel(project), GUITAR_PROGRAM, p, velocity, PREVIEW_SOURCE);
    }
    timer.current = window.setTimeout(stop, PREVIEW_MS);
  };
  return { play, ready: audioReady };
}

/** Melodic tracks of the song (drum tracks are not offered). */
export function useMelodicTracks() {
  const { project } = useEditorState();
  return project.tracks.filter((tr) => tr.displayMode !== 'drum');
}

export function TargetSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { project } = useEditorState();
  const melodic = useMelodicTracks();
  return (
    <label>
      {t('挿入先')}
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid="gv-target">
        {melodic.map((tr) => (
          <option key={tr.id} value={tr.id}>
            {project.tracks.indexOf(tr) + 1}: {tr.name}
          </option>
        ))}
        <option value={NEW_TRACK}>{t('新規ギタートラック（挿入時に作成）')}</option>
      </select>
    </label>
  );
}
