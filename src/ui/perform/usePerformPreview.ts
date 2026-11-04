// Non-destructive preview for the performance tools (ADR-077): every settings change recomputes
// the transform from the committed project and shows it through EditorStore.preview; Apply commits
// it as one undo step, Cancel / unmount removes it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MidiProject } from '../../core/model/types';
import { EMPTY_RESULT, type TransformResult } from '../../core/editing/perform/types';
import { useEditorState, useServices } from '../../app/store/context';

export function usePerformPreview(compute: (base: MidiProject) => TransformResult): { result: TransformResult; error: string | null; apply: () => boolean; cancel: () => void } {
  const { store } = useServices();
  const state = useEditorState();
  // the committed project: stays the same object while this dialog previews, changes when
  // something else edited the song (then the preview is rebuilt on top of the new content)
  const base = state.previewBase ?? state.project;
  const computed = useMemo((): { result: TransformResult; error: string | null } => {
    try {
      return { result: compute(base), error: null };
    } catch (e) {
      return { result: EMPTY_RESULT, error: (e as Error).message };
    }
  }, [compute, base]);
  const [applyError, setApplyError] = useState<string | null>(null);
  useEffect(() => {
    store.preview(() => computed.result.command);
  }, [store, computed]);
  useEffect(() => () => store.cancelPreview(), [store]);
  const apply = useCallback((): boolean => {
    try {
      store.commitPreview((b) => {
        const r = compute(b);
        return { command: r.command, select: r.ids };
      });
      return true;
    } catch (e) {
      setApplyError((e as Error).message);
      return false;
    }
  }, [store, compute]);
  const cancel = useCallback(() => store.cancelPreview(), [store]);
  return { result: computed.result, error: applyError ?? computed.error, apply, cancel };
}
