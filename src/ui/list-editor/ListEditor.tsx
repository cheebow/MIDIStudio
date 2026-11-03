// RCM-style list editor (REQ-EDT-09..13, UI_DESIGN 6). Virtualised rows (only visible rows are
// rendered), keyboard navigation, numeric cell editing. Edits go through the shared EditorStore.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { addEvents, deleteEvents, duplicateEvents } from '../../core/editing/operations';
import { formatTicks, listRows, type ListRow, type ListUnit, type RowCategory } from '../../core/list/listRows';
import { parseTicksInput, setAbsoluteTick, setGateTime, setRowKey, setRowValue, setStepTime } from '../../core/list/listEdit';
import { followState } from '../../core/list/follow';
import { isClassic48Lossless } from '../../core/timing/classic48';
import { useEditActions, useEditorState, useServices } from '../../app/store/context';
import { useContextMenu } from '../menu/ContextMenu';
import { useSignatureMap } from '../hooks';
import { selectedTrack } from '../../core/model/selectedTrack';

const ROW_H = 22;
const COLS = ['meas', 'step', 'name', 'key', 'st', 'gt', 'vel', 'tick', 'detail'] as const;
type Col = (typeof COLS)[number];
const EDITABLE: Col[] = ['key', 'st', 'gt', 'vel', 'tick'];
const COL_LABEL: Record<Col, string> = { meas: 'MEAS', step: 'STEP', name: 'NOTE', key: 'K#', st: 'ST', gt: 'GT', vel: 'VEL', tick: 'TICK', detail: 'EVENT / DETAIL' };
const ALL_CATS: RowCategory[] = ['note', 'cc', 'program', 'pitch-bend', 'pressure', 'sysex', 'meta', 'raw'];
const CAT_LABEL: Record<RowCategory, string> = { note: 'Note', cc: 'CC', program: 'Program', 'pitch-bend': 'PB', pressure: 'Pressure', sysex: 'SysEx', meta: 'Meta', raw: 'Raw' };

export function ListEditor() {
  const { store, transport } = useServices();
  const editActions = useEditActions();
  const ctxMenu = useContextMenu();
  const { project, selection } = useEditorState();
  const settings = project.settings;
  const unit: ListUnit = settings.listDisplayUnit;
  const track = selectedTrack(project);
  const [visibleCats, setVisibleCats] = useState<Set<RowCategory>>(new Set(ALL_CATS));
  const [cursor, setCursor] = useState<{ row: number; col: Col }>({ row: 0, col: 'st' });
  const [editing, setEditing] = useState<{ text: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scroll, setScroll] = useState({ top: 0, h: 300 });
  const [playRows, setPlayRows] = useState<[number, number] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const filtered = visibleCats.size !== ALL_CATS.length;
  const sig = useSignatureMap(project);
  const rows = useMemo(() => (track ? listRows(project, track, filtered ? visibleCats : undefined, sig) : []), [project, track, filtered, visibleCats, sig]);
  const ticks = useMemo(() => rows.map((r) => r.tick), [rows]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, h: el.clientHeight })));
    ro.observe(el);
    setScroll({ top: el.scrollTop, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Playback highlight: derived from the Transport position only (REQ-PLAY-04).
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const pos = transport.getPosition();
      const f = followState(ticks, pos.tick);
      const key = f.current ? `${f.current[0]}:${f.current[1]}` : '';
      if (key !== last) {
        last = key;
        setPlayRows(f.current);
        const el = scrollRef.current;
        if (pos.playing && settings.followPlayback && el && f.current) {
          const y = f.current[0] * ROW_H;
          if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - ROW_H * 2) el.scrollTop = Math.max(0, y - el.clientHeight / 3);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [transport, ticks, settings.followPlayback]);

  if (!track) return <p className="placeholder">{t('トラックがありません。')}</p>;

  const cur = rows[Math.min(cursor.row, rows.length - 1)];

  function cellText(r: ListRow, col: Col): string {
    switch (col) {
      case 'meas':
        return String(r.meas).padStart(3, '0');
      case 'step':
        return String(r.step).padStart(2, '0');
      case 'name':
        return r.name;
      case 'key':
        return r.key === null ? '--' : String(r.key);
      case 'st':
        return formatTicks(r.stTicks, unit, project.ppq);
      case 'gt':
        return formatTicks(r.gtTicks, unit, project.ppq);
      case 'vel':
        return r.value === null ? '--' : String(r.value);
      case 'tick':
        return formatTicks(r.tick, unit, project.ppq);
      case 'detail':
        return r.detail;
    }
  }

  function canEdit(r: ListRow, col: Col): string | null {
    if (!EDITABLE.includes(col)) return t('この列は編集できません。');
    if (filtered) return t('フィルター中は数値を編集できません（表示されていないイベントを誤って動かさないため）。すべての種類を表示してください。');
    if (col === 'key' && r.event.kind !== 'note' && r.event.kind !== 'poly-pressure') return t('ノート番号のない行です。');
    if (col === 'gt' && r.event.kind !== 'note') return t('GT はノートだけにあります。');
    if (col === 'vel' && r.value === null) return t('この行には値がありません。');
    if (col === 'st' && r.stTicks === null) return t('最後のイベントの ST は変更できません。');
    return null;
  }

  function commit(text: string): boolean {
    if (!cur) return false;
    const col = cursor.col;
    try {
      if (col === 'st' || col === 'gt' || col === 'tick') {
        const tk = parseTicksInput(text, unit, project.ppq);
        if (!tk.ok) {
          setMessage(tk.message);
          return false;
        }
        if (col === 'st') store.run(setStepTime(store.project, track!.id, cur.id, tk.ticks));
        else if (col === 'gt') store.run(setGateTime(store.project, cur.id, tk.ticks));
        else store.run(setAbsoluteTick(store.project, cur.id, tk.ticks));
      } else {
        if (!/^-?\d+$/.test(text.trim())) {
          setMessage(t('整数を入力してください。'));
          return false;
        }
        const v = Number(text.trim());
        if (col === 'key') store.run(setRowKey(store.project, cur.id, v));
        else store.run(setRowValue(store.project, cur.id, v));
      }
      setMessage(null);
      setEditing(null);
      gridRef.current?.focus();
      return true;
    } catch (e) {
      setMessage((e as Error).message);
      return false;
    }
  }

  function startEdit(initial?: string) {
    if (!cur) return;
    const why = canEdit(cur, cursor.col);
    if (why) {
      setMessage(why);
      return;
    }
    setEditing({ text: initial ?? cellText(cur, cursor.col) });
  }

  function moveCursor(row: number, col = cursor.col, extend = false) {
    const r = Math.max(0, Math.min(rows.length - 1, row));
    setCursor({ row: r, col });
    const target = rows[r];
    if (target) {
      if (extend) store.selectEvents([...selection.eventIds, target.id]);
      else store.selectEvents([target.id]);
    }
    const el = scrollRef.current;
    if (el) {
      const y = r * ROW_H;
      if (y < el.scrollTop) el.scrollTop = y;
      else if (y + ROW_H > el.scrollTop + el.clientHeight - ROW_H) el.scrollTop = y + ROW_H * 2 - el.clientHeight;
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing) return;
    const ci = COLS.indexOf(cursor.col);
    const act = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    if (e.key === 'ArrowDown') act(() => moveCursor(cursor.row + 1, cursor.col, e.shiftKey));
    else if (e.key === 'ArrowUp') act(() => moveCursor(cursor.row - 1, cursor.col, e.shiftKey));
    else if (e.key === 'PageDown') act(() => moveCursor(cursor.row + Math.floor(scroll.h / ROW_H)));
    else if (e.key === 'PageUp') act(() => moveCursor(cursor.row - Math.floor(scroll.h / ROW_H)));
    else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) act(() => setCursor({ ...cursor, col: COLS[Math.min(COLS.length - 1, ci + 1)] }));
    else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) act(() => setCursor({ ...cursor, col: COLS[Math.max(0, ci - 1)] }));
    else if (e.key === 'Enter' || e.key === 'F2') act(() => startEdit());
    else if (/^[0-9.\-/]$/.test(e.key) && !e.ctrlKey && !e.metaKey) act(() => startEdit(e.key));
    else if (e.key === 'Delete' || e.key === 'Backspace') act(() => store.run(deleteEvents(store.project, selection.eventIds.size ? selection.eventIds : cur ? [cur.id] : [])));
    else if (e.key === 'Home') act(() => moveCursor(0));
    else if (e.key === 'End') act(() => moveCursor(rows.length - 1));
  }

  function insertNote() {
    const tick = cur ? cur.tick : 0;
    const r = addEvents(store.project, track!.id, [{ kind: 'note', tick, pitch: cur?.key ?? 60, velocity: project.inputPresets.defaultVelocity, durationTicks: project.ppq, releaseVelocity: 64 }], { label: 'ノートを挿入' });
    if (r) store.run(r.command, { select: r.ids });
  }

  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - 5);
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.h) / ROW_H) + 5);
  const lossless = isClassic48Lossless(project.ppq) || project.ppq % 48 === 0;

  return (
    <div className="list-editor">
      <div className="list-toolbar">
        <div className="segmented" role="group" aria-label={t('表示単位')}>
          <button className={unit === 'native' ? 'on' : ''} aria-pressed={unit === 'native'} onClick={() => store.updateSettings({ listDisplayUnit: 'native' })}>
            Native Tick（PPQ {project.ppq}）
          </button>
          <button className={unit === 'classic48' ? 'on' : ''} aria-pressed={unit === 'classic48'} onClick={() => store.updateSettings({ listDisplayUnit: 'classic48' })} data-testid="unit-classic48">
            Classic 48（♩=48）
          </button>
        </div>
        {unit === 'classic48' && !lossless && <span className="warn-text" title={t('PPQ が 48 の倍数でないため、一部の値は小数・分数で表示されます。入力は整数 Tick に正確に戻せる値だけ受け付けます。')}>{t('ⓘ 小数・分数表示あり')}</span>}
        <span className="note">{t('表示:')}</span>
        {ALL_CATS.map((c) => (
          <label key={c} className="note">
            <input
              type="checkbox"
              checked={visibleCats.has(c)}
              onChange={(e) => {
                const next = new Set(visibleCats);
                if (e.target.checked) next.add(c);
                else next.delete(c);
                setVisibleCats(next);
              }}
            />
            {CAT_LABEL[c]}
          </label>
        ))}
        <button onClick={insertNote}>{t('ノート挿入')}</button>
        <button disabled={!selection.eventIds.size} onClick={() => {
          const r = duplicateEvents(store.project, selection.eventIds, 0);
          if (r) store.run(r.command, { select: r.ids });
        }}>{t('複製')}</button>
        <button onClick={() => store.updateSettings({ activePanel: 'tempo' })} title={t('テンポ・拍子・調号・マーカーは「コンダクター」タブで編集します')}>
          {t('コンダクタートラックを開く')}
        </button>
      </div>
      {filtered && <div className="list-notice">{t('フィルター中: ST は表示されていないイベントも含めた次のイベントまでの距離です。数値の編集はすべて表示したときだけできます。')}</div>}
      {message && (
        <div className="list-notice warn-text" role="status" data-testid="list-message">
          {message}
        </div>
      )}
      <div className="list-body">
        <div
          className="list-grid"
          ref={gridRef}
          role="grid"
          aria-label={t('イベントリスト: {name}。上下で行、左右で列を移動、Enter で編集。', { name: track.name })}
          aria-rowcount={rows.length}
          tabIndex={0}
          onKeyDown={onKeyDown}
          data-testid="list-grid"
        >
          <div className="list-header" role="row">
            {COLS.map((c) => (
              <div key={c} role="columnheader" className={`lc lc-${c}`}>
                {COL_LABEL[c]}
              </div>
            ))}
          </div>
          <div className="list-scroll" ref={scrollRef} onScroll={(e) => {
            const { scrollTop, clientHeight } = e.currentTarget;
            setScroll({ top: scrollTop, h: clientHeight });
          }}>
            <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
              {rows.slice(first, last).map((r, k) => {
                const i = first + k;
                const prev = rows[i - 1];
                const hidden = filtered ? r.index - (prev ? prev.index : -1) - 1 : 0;
                const playing = playRows && i >= playRows[0] && i <= playRows[1];
                return (
                  <div
                    key={r.id}
                    role="row"
                    aria-rowindex={i + 1}
                    aria-selected={selection.eventIds.has(r.id)}
                    className={`list-row${selection.eventIds.has(r.id) ? ' selected' : ''}${playing ? ' playing' : ''} cat-${r.category}`}
                    style={{ top: i * ROW_H, height: ROW_H }}
                    data-testid="list-row"
                    onPointerDown={(e) => {
                      gridRef.current?.focus();
                      const col = ((e.target as HTMLElement).dataset.col as Col | undefined) ?? cursor.col;
                      setEditing(null);
                      moveCursor(i, col, e.shiftKey);
                    }}
                    onDoubleClick={() => startEdit()}
                    onContextMenu={(e) => {
                      if (!selection.eventIds.has(r.id)) moveCursor(i);
                      ctxMenu.open(e, [
                        { label: t('値を編集'), shortcut: 'Enter', action: () => startEdit() },
                        { label: t('コピー'), action: editActions.copy },
                        { label: t('複製'), action: () => {
                          const d = duplicateEvents(store.project, store.getState().selection.eventIds, 0);
                          if (d) store.run(d.command, { select: d.ids });
                        } },
                        { separator: true, label: '' },
                        { label: t('再生位置をここに移動'), action: () => transport.seek(r.tick) },
                        { separator: true, label: '' },
                        { label: t('削除'), shortcut: 'Delete', action: () => store.run(deleteEvents(store.project, store.getState().selection.eventIds)) },
                      ]);
                    }}
                  >
                    {COLS.map((c) => {
                      const active = cursor.row === i && cursor.col === c;
                      return (
                        <div key={c} role="gridcell" data-col={c} className={`lc lc-${c}${active ? ' cursor' : ''}`}>
                          {c === 'meas' && hidden > 0 && (
                            <span className="hidden-badge" title={t('{n} 件のイベントが非表示', { n: hidden })}>
                              +{hidden}
                            </span>
                          )}
                          {active && editing ? (
                            <input
                              className="cell-input"
                              autoFocus
                              value={editing.text}
                              aria-label={t('{col} を入力', { col: t(COL_LABEL[c]) })}
                              onChange={(e) => setEditing({ text: e.target.value })}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                  if (commit(editing.text)) moveCursor(i + 1, c);
                                } else if (e.key === 'Escape') {
                                  setEditing(null);
                                  setMessage(null);
                                  gridRef.current?.focus();
                                }
                              }}
                              onBlur={() => setEditing(null)}
                            />
                          ) : (
                            cellText(r, c)
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {ctxMenu.element}
    </div>
  );
}
