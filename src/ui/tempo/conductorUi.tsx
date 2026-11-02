// Tempo track (conductor) editing UI shared by the tempo editor, the track view and the transport
// bar: value fields per event kind, and a dialog to add / change / delete one event.
import { useMemo, useState } from 'react';
import { deleteConductorEvent, upsertConductorEvent, type ConductorValue } from '../../core/editing/conductorOps';
import type { ConductorEvent, MidiProject } from '../../core/model/types';
import { bpmFromUs } from '../../core/timing/tempoMap';
import { TimeSignatureMap } from '../../core/timing/timeSignatureMap';
import { useEditorState, useServices } from '../../app/store/context';
import { Dialog } from '../Dialog';
import { formatBpm, keyName } from '../canvas';

export type ConductorKind = ConductorValue['kind'];

export const KIND_NAMES: Record<ConductorKind, string> = { tempo: 'テンポ', 'time-signature': '拍子', 'key-signature': '調号', marker: 'マーカー' };

/** Key options: "C（調号なし）", "G（♯1）", "Am（調号なし）", ... value "sf:minor". */
export const KEY_OPTIONS: { value: string; label: string }[] = [false, true].flatMap((minor) =>
  Array.from({ length: 15 }, (_, i) => {
    const sf = i - 7;
    const acc = sf === 0 ? '調号なし' : sf > 0 ? `♯${sf}` : `♭${-sf}`;
    return { value: `${sf}:${minor ? 1 : 0}`, label: `${keyName(sf, minor)}（${minor ? '短調' : '長調'}・${acc}）` };
  }),
);

export function signatureMap(project: MidiProject): TimeSignatureMap {
  return new TimeSignatureMap(project.ppq, project.conductor.filter((c) => c.kind === 'time-signature'));
}

/** The conductor event of `kind` in effect at `tick` (the last one at or before it). */
export function conductorAt(project: MidiProject, kind: 'tempo' | 'time-signature' | 'key-signature', tick: number): ConductorEvent | undefined {
  let found: ConductorEvent | undefined;
  for (const c of project.conductor) if (c.kind === kind && c.tick <= tick && (!found || c.tick >= found.tick)) found = c;
  return found;
}

/** Value text shown for an event. */
export function conductorValueText(c: ConductorEvent): string {
  switch (c.kind) {
    case 'tempo':
      return `♩=${formatBpm(c.usPerQuarter)}`;
    case 'time-signature':
      return `${c.numerator}/${c.denominator}`;
    case 'key-signature':
      return keyName(c.sharpsFlats, c.minor);
    case 'marker':
      return c.text;
  }
}

/** Default value for a new event of `kind` at `tick`: the value in effect there. */
function defaultValue(project: MidiProject, kind: ConductorKind, tick: number): ConductorValue {
  if (kind === 'tempo') {
    const t = conductorAt(project, 'tempo', tick);
    return { kind, bpm: Math.round((t?.kind === 'tempo' ? bpmFromUs(t.usPerQuarter) : 120) * 100) / 100 };
  }
  if (kind === 'time-signature') {
    const s = signatureMap(project).signatureAt(tick);
    return { kind, numerator: s.numerator, denominator: s.denominator };
  }
  if (kind === 'key-signature') {
    const k = conductorAt(project, 'key-signature', tick);
    return { kind, sharpsFlats: k?.kind === 'key-signature' ? k.sharpsFlats : 0, minor: k?.kind === 'key-signature' ? k.minor : false };
  }
  return { kind, text: '' };
}

function valueOf(c: ConductorEvent): ConductorValue {
  switch (c.kind) {
    case 'tempo':
      return { kind: 'tempo', bpm: Math.round(bpmFromUs(c.usPerQuarter) * 100) / 100 };
    case 'time-signature':
      return { kind: 'time-signature', numerator: c.numerator, denominator: c.denominator };
    case 'key-signature':
      return { kind: 'key-signature', sharpsFlats: c.sharpsFlats, minor: c.minor };
    case 'marker':
      return { kind: 'marker', text: c.text };
  }
}

/** Parses the text of a value field; throws a user-facing message when invalid. */
export function parseConductorValue(kind: ConductorKind, text: string): ConductorValue {
  if (kind === 'tempo') {
    const bpm = Number(text);
    if (!text.trim() || !Number.isFinite(bpm)) throw new Error('テンポは数値（BPM）で入力してください。');
    return { kind, bpm };
  }
  if (kind === 'time-signature') {
    const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text);
    if (!m) throw new Error('拍子は 3/4 のように入力してください。');
    return { kind, numerator: Number(m[1]), denominator: Number(m[2]) };
  }
  if (kind === 'key-signature') {
    const [sf, minor] = text.split(':');
    return { kind, sharpsFlats: Number(sf), minor: minor === '1' };
  }
  return { kind, text };
}

/** Field text of a value (inverse of parseConductorValue). */
export function valueFieldText(v: ConductorValue): string {
  return v.kind === 'tempo' ? String(v.bpm) : v.kind === 'time-signature' ? `${v.numerator}/${v.denominator}` : v.kind === 'key-signature' ? `${v.sharpsFlats}:${v.minor ? 1 : 0}` : v.text;
}

/** The input for a value of `kind` (number / text / key select). */
export function ValueField({ kind, value, onChange, onCommit, label, autoFocus }: { kind: ConductorKind; value: string; onChange: (v: string) => void; onCommit?: (value?: string) => void; label: string; autoFocus?: boolean }) {
  const commitKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCommit?.();
    }
  };
  if (kind === 'key-signature')
    return (
      <select
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          onCommit?.(e.target.value); // a choice is final
        }}
      >
        {KEY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  return (
    <input
      aria-label={label}
      value={value}
      autoFocus={autoFocus}
      inputMode={kind === 'tempo' ? 'decimal' : undefined}
      placeholder={kind === 'tempo' ? '120' : kind === 'time-signature' ? '3/4' : kind === 'marker' ? 'Verse A' : undefined}
      style={{ width: kind === 'marker' ? '14em' : '6em' }}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={commitKeys}
      onBlur={() => onCommit?.()}
    />
  );
}

export interface ConductorDialogTarget {
  kind: ConductorKind;
  tick: number;
  /** event being changed; absent = add a new one */
  id?: string;
}

/** Add / change / delete one tempo-track event. Position and value in one dialog, one undo step. */
export function ConductorEventDialog({ target, onClose }: { target: ConductorDialogTarget; onClose: () => void }) {
  const { store } = useServices();
  const { project } = useEditorState();
  const sig = useMemo(() => signatureMap(project), [project]);
  const existing = target.id ? project.conductor.find((c) => c.id === target.id) : undefined;
  const [kind, setKind] = useState<ConductorKind>(existing?.kind ?? target.kind);
  const startTick = existing?.tick ?? target.tick;
  const [pos, setPos] = useState(sig.format(startTick));
  const [value, setValue] = useState(valueFieldText(existing ? valueOf(existing) : defaultValue(project, target.kind, startTick)));
  const [error, setError] = useState<string | null>(null);
  const changeKind = (k: ConductorKind) => {
    setKind(k);
    setValue(valueFieldText(defaultValue(store.project, k, sig.parse(pos) ?? startTick)));
  };
  const submit = () => {
    try {
      const tick = sig.parse(pos);
      if (tick === null) throw new Error('位置は 小節.拍.Tick（例 5.1.0、または小節番号だけ）で入力してください。');
      store.run(upsertConductorEvent(store.project, tick, parseConductorValue(kind, value), existing?.id));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog title={`${KIND_NAMES[kind]}を${existing ? '変更' : '追加'}`} onClose={onClose}>
      <form
        className="form-grid"
        data-testid="conductor-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {!existing && (
          <label>
            種類
            <select value={kind} onChange={(e) => changeKind(e.target.value as ConductorKind)}>
              {(Object.keys(KIND_NAMES) as ConductorKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_NAMES[k]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          位置（小節.拍.Tick）
          <input aria-label="位置" value={pos} onChange={(e) => setPos(e.target.value)} />
          {kind === 'time-signature' && <span className="note">拍子はその小節の頭に置きます。</span>}
        </label>
        <label>
          {kind === 'tempo' ? 'テンポ（BPM）' : kind === 'time-signature' ? '拍子（例 3/4、6/8）' : kind === 'key-signature' ? '調' : 'マーカーの名前'}
          <ValueField kind={kind} value={value} onChange={setValue} label={KIND_NAMES[kind]} autoFocus />
        </label>
        {error && (
          <p className="warn-text" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button className="primary" type="submit">
            OK
          </button>
          {existing && (
            <button
              type="button"
              onClick={() => {
                store.run(deleteConductorEvent(store.project, existing.id));
                onClose();
              }}
            >
              削除
            </button>
          )}
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </form>
    </Dialog>
  );
}
