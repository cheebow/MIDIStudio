// Note info bar above the piano roll and the drum editor (ADR-073, like Cubase's info line):
// position, length, pitch, velocity and release velocity of the selected notes, editable as text.
// One note: its values. Several: the value they share, or "min–max". Typing a number sets every
// selected note (position / pitch move the group, keeping its shape); "+10" / "-10" adds to each.
// ↑↓ step the value (Shift: bigger steps), Enter applies, Esc goes back to the shown value.
import { useMemo, useState } from 'react';
import { applyFieldInput, parseFieldInput, summarizeNotes, type FieldRange, type NoteField } from '../../core/editing/noteInfo';
import { noteName } from '../../core/list/noteNames';
import type { MidiTrack, NoteEvent } from '../../core/model/types';
import { useEditorState, useServices } from '../../app/store/context';
import { t } from '../../i18n';
import { useSignatureMap } from '../hooks';

const FIELDS: { field: NoteField; label: string; hint: string }[] = [
  { field: 'tick', label: '位置', hint: '小節.拍.Tick（例 5.2.0）、または +/− Tick' },
  { field: 'duration', label: '長さ', hint: 'Tick、または +/− Tick' },
  { field: 'pitch', label: '音高', hint: '音名（C4、F#3）かノート番号、または +/− 半音' },
  { field: 'velocity', label: 'ベロシティ', hint: '1〜127、または +/− 値' },
  { field: 'release', label: 'リリース', hint: 'リリースベロシティ 0〜127、または +/− 値' },
];

export function NoteInfoBar({ track, pitchLabel }: { track: MidiTrack; /** drum editor: "38 Snare" */ pitchLabel?: (pitch: number) => string }) {
  const { store, reportError } = useServices();
  const { project, selection } = useEditorState();
  const sig = useSignatureMap(project);
  const notes = useMemo(() => track.events.filter((e): e is NoteEvent => e.kind === 'note' && selection.eventIds.has(e.id)), [track.events, selection.eventIds]);
  const summary = useMemo(() => summarizeNotes(notes), [notes]);
  /** text being typed per field; absent = show the current value */
  const [draft, setDraft] = useState<Partial<Record<NoteField, string>>>({});
  const [invalid, setInvalid] = useState<NoteField | null>(null);

  const one = (field: NoteField, v: number) => (field === 'tick' ? sig.format(v) : field === 'pitch' ? (pitchLabel ? pitchLabel(v) : noteName(v)) : String(v));
  const shown = (field: NoteField, r: FieldRange) => (r.min === r.max ? one(field, r.min) : `${one(field, r.min)}–${one(field, r.max)}`);

  const run = (field: NoteField, input: Parameters<typeof applyFieldInput>[3]) => {
    try {
      store.run(applyFieldInput(store.project, notes.map((n) => n.id), field, input));
    } catch (e) {
      reportError((e as Error).message);
    }
  };
  const clear = (field: NoteField) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[field];
      return next;
    });
    setInvalid((f) => (f === field ? null : f));
  };
  /** applies the typed text (read from the input itself, so a fast Enter never sees a stale draft); false when it does not read as a value */
  const commit = (field: NoteField, text: string): boolean => {
    if (!summary || text === shown(field, summary[field])) {
      clear(field);
      return true;
    }
    const input = parseFieldInput(text, field, (s) => sig.parse(s));
    if (!input) {
      setInvalid(field);
      return false;
    }
    run(field, input);
    clear(field);
    return true;
  };
  /** select the field's text again after the value re-renders, so the next value can be typed over it; only while it
   * still has focus (select() would pull focus back from a field the user moved to in the meantime) */
  const reselect = (el: HTMLInputElement) =>
    requestAnimationFrame(() => {
      if (document.activeElement === el) el.select();
    });
  const step = (field: NoteField, big: boolean) => {
    const q = Math.max(1, Math.round(project.ppq / 4)); // a 16th; Shift: a beat
    switch (field) {
      case 'tick':
      case 'duration':
        return big ? project.ppq : q;
      case 'pitch':
        return big ? 12 : 1;
      default:
        return big ? 10 : 1;
    }
  };

  return (
    <div className="note-info-bar" role="group" aria-label={t('選択したノート')} data-testid="note-info-bar">
      {!summary ? (
        <span className="note-info-empty">{t('ノートを選ぶと、ここで位置・長さ・音高・ベロシティを直せます')}</span>
      ) : (
        <>
          <span className="note-info-count">{t('{n} ノート', { n: notes.length })}</span>
          {FIELDS.map(({ field, label, hint }) => (
            <label key={field} className="note-info-field">
              <span>{t(label)}</span>
              <input
                value={draft[field] ?? shown(field, summary[field])}
                aria-label={t(label)}
                aria-invalid={invalid === field}
                title={invalid === field ? t('読み取れません: {hint}', { hint: t(hint) }) : t(hint)}
                data-field={field}
                spellCheck={false}
                autoComplete="off"
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft((d) => ({ ...d, [field]: v }));
                  setInvalid((f) => (f === field ? null : f));
                }}
                onBlur={(e) => {
                  if (!commit(field, e.currentTarget.value)) clear(field); // unreadable text is dropped when leaving the field
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (commit(field, e.currentTarget.value)) reselect(e.currentTarget);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    clear(field);
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const d = step(field, e.shiftKey);
                    clear(field);
                    run(field, { kind: 'add', delta: e.key === 'ArrowUp' ? d : -d });
                    reselect(e.currentTarget);
                  }
                }}
              />
            </label>
          ))}
        </>
      )}
    </div>
  );
}
