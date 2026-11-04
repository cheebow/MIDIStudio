// Conductor track editor (bottom panel "コンダクター"): every tempo / time-signature / key-signature
// change and marker of the song in one list, with a filter by kind. Add at the playhead, edit
// position and value in place (Enter or leaving the field commits; one undo step each), move the
// playhead to a row, delete.
import { useMemo, useState } from 'react';
import { deleteConductorEvent, upsertConductorEvent } from '../../core/editing/conductorOps';
import type { ConductorEvent } from '../../core/model/types';
import { bpmFromUs } from '../../core/timing/tempoMap';
import { useEditorState, useServices } from '../../app/store/context';
import { t } from '../../i18n';
import { ConductorEventDialog, KIND_NAMES, ValueField, parseConductorValue, signatureMap, type ConductorDialogTarget, type ConductorKind } from './conductorUi';

const KINDS = Object.keys(KIND_NAMES) as ConductorKind[];

function fieldText(c: ConductorEvent): string {
  switch (c.kind) {
    case 'tempo':
      return String(Math.round(bpmFromUs(c.usPerQuarter) * 100) / 100);
    case 'time-signature':
      return `${c.numerator}/${c.denominator}`;
    case 'key-signature':
      return `${c.sharpsFlats}:${c.minor ? 1 : 0}`;
    case 'marker':
      return c.text;
  }
}

export function TempoEditor() {
  const { store, transport } = useServices();
  const { project } = useEditorState();
  const sig = useMemo(() => signatureMap(project), [project]);
  const [dialog, setDialog] = useState<ConductorDialogTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** kinds shown in the list (view state only; all kinds by default) */
  const [shown, setShown] = useState<ReadonlySet<ConductorKind>>(() => new Set(KINDS));
  const counts = useMemo(() => {
    const n: Record<ConductorKind, number> = { tempo: 0, 'time-signature': 0, 'key-signature': 0, marker: 0 };
    for (const c of project.conductor) n[c.kind]++;
    return n;
  }, [project.conductor]);
  const rows = project.conductor.filter((c) => shown.has(c.kind));
  const hidden = project.conductor.length - rows.length;
  const filtered = shown.size < KINDS.length;

  const add = (kind: ConductorKind) => {
    const tick = Math.round(transport.getPosition().tick);
    setDialog({ kind, tick: kind === 'time-signature' ? Math.round(sig.barBeatToTick(sig.tickToBarBeat(tick).bar)) : tick });
  };
  const toggle = (kind: ConductorKind) => {
    const next = new Set(shown);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setShown(next);
  };

  return (
    <div className="tempo-editor" data-testid="tempo-editor">
      <div className="list-toolbar">
        <span className="note">{t('再生位置に追加:')}</span>
        {KINDS.map((k) => (
          <button key={k} onClick={() => add(k)} data-testid={`add-${k}`}>
            ＋{t(KIND_NAMES[k])}
          </button>
        ))}
        <span className="toolbar-sep" aria-hidden="true" />
        <span className="note">{t('表示:')}</span>
        {KINDS.map((k) => (
          <button key={k} className={`toggle${shown.has(k) ? ' on' : ''}`} aria-pressed={shown.has(k)} onClick={() => toggle(k)} data-testid={`show-${k}`} title={shown.has(k) ? t('{kind}を一覧に表示しない', { kind: t(KIND_NAMES[k]) }) : t('{kind}を一覧に表示する', { kind: t(KIND_NAMES[k]) })}>
            {t(KIND_NAMES[k])} {counts[k]}
          </button>
        ))}
        {filtered && (
          <button className="link" onClick={() => setShown(new Set(KINDS))} data-testid="show-all">
            {t('すべて表示')}
          </button>
        )}
        <span className="note" title={t('トラックビューのテンポ・マーカーレーンやルーラーの右クリック／ダブルクリック、上部の BPM 表示のクリックでも編集できます。')}>{t('位置と値はその場で書き換え（Enter で確定）')}</span>
      </div>
      {message && (
        <div className="list-notice warn-text" role="status">
          {message}
        </div>
      )}
      <div className="tempo-rows" role="table" aria-label={t('コンダクタートラック')}>
        <div className="tempo-row head" role="row">
          <span role="columnheader">{t('位置')}</span>
          <span role="columnheader">{t('種類')}</span>
          <span role="columnheader">{t('値')}</span>
          <span role="columnheader" />
        </div>
        {project.conductor.length === 0 && <p className="note">{t('テンポ・拍子・調号・マーカーはありません（テンポ 120、4/4 として扱います）。')}</p>}
        {project.conductor.length > 0 && rows.length === 0 && <p className="note">{t('表示する種類が選ばれていません（上の「表示」で選んでください）。')}</p>}
        {rows.map((c) => (
          // the key includes the shown position: a time-signature change elsewhere re-labels this row (ADR-084)
          <TempoRow key={`${c.id}:${c.tick}:${sig.format(c.tick)}:${fieldText(c)}`} event={c} format={(t) => sig.format(t)} parse={(t) => sig.parse(t)} onError={setMessage} onSeek={() => transport.seek(c.tick)} onDelete={() => store.run(deleteConductorEvent(store.project, c.id))} onDialog={() => setDialog({ kind: c.kind, tick: c.tick, id: c.id })} />
        ))}
        {hidden > 0 && rows.length > 0 && <p className="note">{t('ほかに {n} 件（表示していない種類）', { n: hidden })}</p>}
      </div>
      {dialog && <ConductorEventDialog target={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function TempoRow({ event: c, format, parse, onError, onSeek, onDelete, onDialog }: { event: ConductorEvent; format: (t: number) => string; parse: (t: string) => number | null; onError: (m: string | null) => void; onSeek: () => void; onDelete: () => void; onDialog: () => void }) {
  const { store } = useServices();
  const [pos, setPos] = useState(format(c.tick));
  const [value, setValue] = useState(fieldText(c));
  const commit = (override?: string) => {
    const tick = parse(pos);
    const v = override ?? value;
    try {
      if (tick === null) throw new Error(t('位置は 小節.拍.Tick（例 5.1.0）で入力してください。'));
      if (tick === c.tick && v === fieldText(c)) return;
      store.run(upsertConductorEvent(store.project, tick, parseConductorValue(c.kind, v), c.id));
      onError(null);
    } catch (e) {
      onError((e as Error).message);
      setPos(format(c.tick));
      setValue(fieldText(c));
    }
  };
  return (
    <div className={`tempo-row kind-${c.kind}`} role="row" data-testid="tempo-row" onDoubleClick={(e) => (e.target as HTMLElement).tagName !== 'INPUT' && onDialog()}>
      <span role="cell">
        <input aria-label={t('位置')} className="pos" value={pos} onChange={(e) => setPos(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} onBlur={() => commit()} />
      </span>
      <span role="cell" className="kind">
        {t(KIND_NAMES[c.kind])}
      </span>
      <span role="cell">
        <ValueField kind={c.kind} value={value} onChange={setValue} onCommit={commit} label={t('{kind}の値', { kind: t(KIND_NAMES[c.kind]) })} />
        {c.kind === 'tempo' && <span className="note"> BPM（{c.usPerQuarter} µs）</span>}
      </span>
      <span role="cell" className="row">
        <button onClick={onSeek} title={t('再生位置（再生ヘッド）をこの位置に移動します。イベントは動きません。')} aria-label={t('再生位置を {pos} に移動', { pos: format(c.tick) })}>
          {t('再生位置にする')}
        </button>
        <button onClick={onDelete} aria-label={t('{kind}を削除', { kind: t(KIND_NAMES[c.kind]) })}>
          {t('削除')}
        </button>
      </span>
    </div>
  );
}
