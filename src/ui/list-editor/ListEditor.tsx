// RCM-style list editor (REQ-EDT-09..13, UI_DESIGN 6, ADR-066). Virtualised rows (only visible
// rows are rendered), keyboard navigation, in-place editing of every column, +/- and drag
// increments, insertion of any event kind, kind conversion, batch changes, and pitch capture
// from the PC / MIDI keyboard. Edits go through the shared EditorStore. Which keys the grid owns
// in each input mode is decided by `listKeyIntent` (src/input/listKeys.ts), so the musical keys,
// the octave keys and the step keys keep working while the list has focus.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../../i18n';
import { addEvents, deleteEvents, duplicateEvents, updateEvents, type NewEvent } from '../../core/editing/operations';
import { CAPTURE_IDLE, captureInserted, captureStep, type CaptureState } from '../../core/list/listCapture';
import { shiftOctave } from '../../input/KeyboardRouter';
import { formatTicks, isConductorEvent, listRows, type ListRow, type ListUnit, type RowCategory } from '../../core/list/listRows';
import { deleteConductorEvent, setTempo, setTimeSignature, upsertConductorEvent } from '../../core/editing/conductorOps';
import { pasteRowsAt } from '../../core/list/listPaste';
import { bpmFromUs } from '../../core/timing/tempoMap';
import { parseTicksInput, setAbsoluteTick, setGateTime, setRowChannel, setRowKey, setRowValue, setStepTime } from '../../core/list/listEdit';
import { applyNameInput, convertEventKinds, type ConvertTarget } from '../../core/list/listConvert';
import { parseNameInput } from '../../core/list/listName';
import { INSERT_SETS, insertListEvent, insertSet, insertTemplate, type InsertKind, type InsertSet } from '../../core/list/listInsert';
import { nudgeCell, type NudgeCol } from '../../core/list/listNudge';
import { followState, lastRowAtOrBefore } from '../../core/list/follow';
import { eventChannel } from '../../core/events/order';
import { isClassic48Lossless } from '../../core/timing/classic48';
import { useEditActions, useEditorState, useServices } from '../../app/store/context';
import { isSecondaryClick, useContextMenu } from '../menu/ContextMenu';
import { noteMenuItems } from '../menu/editMenus';
import type { MenuItem } from '../menu/MenuBar';
import { useSignatureMap } from '../hooks';
import { selectedTrack } from '../../core/model/selectedTrack';
import { listKeyIntent } from '../../input/listKeys';
import { IS_MAC, MOD_LABEL } from '../platform';
import { EventBytesDialog, type BytesDialogState } from './EventBytesDialog';
import { ListBatchDialog } from './ListBatchDialog';

const ROW_H = 22;
const COLS = ['meas', 'step', 'name', 'key', 'st', 'gt', 'vel', 'ch', 'tick', 'detail'] as const;
type Col = (typeof COLS)[number];
const EDITABLE: Col[] = ['name', 'key', 'st', 'gt', 'vel', 'ch', 'tick'];
/** which numeric field a +/- or drag on the column changes (NOTE acts on the note number) */
const NUDGE_COL: Partial<Record<Col, NudgeCol>> = { name: 'key', key: 'key', st: 'st', gt: 'gt', vel: 'vel', ch: 'ch', tick: 'tick' };
const COL_LABEL: Record<Col, string> = { meas: 'MEAS', step: 'STEP', name: 'NOTE', key: 'K#', st: 'ST', gt: 'GT', vel: 'VEL', ch: 'CH', tick: 'TICK', detail: 'EVENT / DETAIL' };
const ALL_CATS: RowCategory[] = ['note', 'cc', 'program', 'pitch-bend', 'pressure', 'sysex', 'meta', 'raw'];
const CAT_LABEL: Record<RowCategory, string> = { note: 'Note', cc: 'CC', program: 'Program', 'pitch-bend': 'PB', pressure: 'Pressure', sysex: 'SysEx', meta: 'Meta', raw: 'Raw', conductor: 'Conductor' };
const INSERT_KINDS: { kind: InsertKind; label: string; key: string }[] = [
  { kind: 'note', label: 'Note', key: 'n' },
  { kind: 'cc', label: 'Control Change', key: 'c' },
  { kind: 'program', label: 'Program Change', key: 'p' },
  { kind: 'pitch-bend', label: 'Pitch Bend', key: 'b' },
  { kind: 'channel-pressure', label: 'Channel Pressure', key: 'a' },
  { kind: 'poly-pressure', label: 'Poly Pressure', key: 'y' },
];
const SET_LABEL: Record<InsertSet, string> = {
  'bank-program': 'バンク + 音色（CC0, CC32, PC）',
  'rpn-bend-range': 'RPN ピッチベンドレンジ',
  'rpn-fine-tune': 'RPN ファインチューン',
  'rpn-coarse-tune': 'RPN コースチューン',
  nrpn: 'NRPN（CC99, CC98, CC6, CC38）',
  'gs-reset': 'GS Reset',
};
type Commit = 'enter' | 'shift-enter' | 'tab' | 'shift-tab' | 'repeat';

export function ListEditor() {
  const { store, transport, input, step, recorder } = useServices();
  const editActions = useEditActions();
  const ctxMenu = useContextMenu();
  const { project, selection } = useEditorState();
  const settings = project.settings;
  const unit: ListUnit = settings.listDisplayUnit;
  const track = selectedTrack(project);
  const inputSnap = useSyncExternalStore(input.subscribe, input.getSnapshot);
  const stepSnap = useSyncExternalStore(step.subscribe, step.getSnapshot);
  const recState = useSyncExternalStore(recorder.subscribe, recorder.getState);
  const mode = inputSnap.mode;
  const stepMode = mode === 'step-piano' || mode === 'step-drums';
  const performing = mode === 'piano-performance' || mode === 'drum-performance';
  const [visibleCats, setVisibleCats] = useState<Set<RowCategory>>(new Set(ALL_CATS));
  /** tempo / time signature / key / marker rows interleaved (they never enter ST) */
  const [showConductor, setShowConductor] = useState(true);
  const [cursor, setCursor] = useState<{ row: number; col: Col }>({ row: 0, col: 'st' });
  /** `selectAll`: opened with Enter / F2 / double-click, so typing replaces the value; a typed digit starts after itself */
  const [editing, setEditing] = useState<{ text: string; selectAll: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scroll, setScroll] = useState({ top: 0, h: 300 });
  const [playRows, setPlayRows] = useState<[number, number] | null>(null);
  const [focused, setFocused] = useState(false);
  const [bytesDialog, setBytesDialog] = useState<BytesDialogState | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** last text confirmed per column (⌘/Ctrl+Enter repeats it) */
  const lastCommitted = useRef<Partial<Record<Col, string>>>({});
  /** row to put the cursor on once the rows include it (after an insertion) */
  const pendingFocus = useRef<{ id: string; col: Col } | null>(null);
  /** detaches the window listeners of a running cell drag */
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);

  const filtered = visibleCats.size !== ALL_CATS.length;
  const sig = useSignatureMap(project);
  const rows = useMemo(() => (track ? listRows(project, track, filtered ? visibleCats : undefined, sig, { conductor: showConductor }) : []), [project, track, filtered, visibleCats, sig, showConductor]);
  const ticks = useMemo(() => rows.map((r) => r.tick), [rows]);
  const cur = rows[Math.min(cursor.row, rows.length - 1)] as ListRow | undefined;

  // The input sink and the drag handlers read the latest values through this ref.
  const latest = useRef({ cursor, rows, track, mode, phase: recState.phase, focused, settings, selection });
  latest.current = { cursor, rows, track, mode, phase: recState.phase, focused, settings, selection };
  const moveCursorRef = useRef<(row: number, col?: Col, extend?: boolean) => void>(() => undefined);

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

  // After an insertion: the cursor goes to the new row (NOTE column, so "CC11" / "D#4" can be typed at once).
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    const i = rows.findIndex((r) => r.id === p.id);
    if (i < 0) return;
    pendingFocus.current = null;
    setCursor({ row: i, col: p.col });
    scrollToRow(i);
  }, [rows, cursor]);

  // Step input: the list cursor follows the shared step cursor (INPUT_RECORDING 6, ADR-066).
  useEffect(() => {
    if (!stepMode) return;
    const L = latest.current;
    if (L.rows[L.cursor.row]?.tick === stepSnap.cursor) return;
    const i = lastRowAtOrBefore(ticks, stepSnap.cursor);
    if (i >= 0 && i !== L.cursor.row) {
      setCursor((c) => ({ ...c, row: i }));
      scrollToRow(i);
    }
  }, [stepMode, stepSnap.cursor, ticks]);

  // Pitch capture (core/list/listCapture.ts): a played key writes the K# of the current row, more
  // keys held with it become a chord at the same position, and releasing them moves on. Works in
  // the PC-keyboard / pad modes and, from an external MIDI keyboard, in the edit mode too. The
  // Recorder owns the input while a take runs; step modes write their own notes.
  const captureRef = useRef<CaptureState>(CAPTURE_IDLE);
  useEffect(
    () =>
      input.addSink((e) => {
        if (e.type !== 'note-on' && e.type !== 'note-off') return;
        const L = latest.current;
        const allowed = L.focused && L.mode !== 'step-piano' && L.mode !== 'step-drums' && L.phase === 'idle' && !!L.track;
        const r = L.rows[Math.min(L.cursor.row, L.rows.length - 1)] as ListRow | undefined;
        const step = captureStep(captureRef.current, e.type === 'note-on' ? { type: 'note-on', pitch: e.pitch, velocity: e.velocity } : { type: 'note-off', pitch: e.pitch }, r ? { id: r.id, tick: r.tick, key: r.key } : null, allowed);
        captureRef.current = step.state;
        for (const a of step.actions) {
          try {
            if (a.type === 'no-key-row') setMessage(t('この行にはノート番号がありません（鍵盤入力は K# のある行で使います）。'));
            else if (a.type === 'set-key') {
              const src = L.rows.find((x) => x.id === a.rowId)?.event;
              const changes = L.settings.list.captureVelocity && src?.kind === 'note' ? { pitch: a.pitch, velocity: a.velocity } : { pitch: a.pitch };
              const cmd = updateEvents(store.project, [{ id: a.rowId, changes }], 'ノート番号を変更');
              if (cmd) store.run(cmd, { select: [a.rowId], mergeKey: `list-chord:${a.rowId}` });
              setMessage(null);
            } else if (a.type === 'insert') {
              const src = store.project.tracks.flatMap((x) => x.events).find((x) => x.id === a.likeRowId);
              const chord = captureRef.current.anchor?.ids ?? [];
              const already = store.project.tracks.flatMap((x) => x.events).some((x) => chord.includes(x.id) && (x.kind === 'note' || x.kind === 'poly-pressure') && x.pitch === a.pitch);
              if (!src || already || !L.track) continue;
              const ch = 'channelOverride' in src && src.channelOverride !== undefined ? { channelOverride: src.channelOverride } : {};
              const ev: NewEvent | null =
                src.kind === 'note'
                  ? { kind: 'note', tick: a.tick, ...ch, pitch: a.pitch, velocity: L.settings.list.captureVelocity ? a.velocity : src.velocity, durationTicks: src.durationTicks, releaseVelocity: 64 }
                  : src.kind === 'poly-pressure'
                    ? { kind: 'poly-pressure', tick: a.tick, ...ch, pitch: a.pitch, pressure: src.pressure }
                    : null;
              if (!ev) continue;
              const res = addEvents(store.project, L.track.id, [ev], { label: 'ノートを挿入' });
              if (!res) continue;
              captureRef.current = captureInserted(captureRef.current, res.ids[0]);
              store.run(res.command, { select: [...chord, ...res.ids], mergeKey: `list-chord:${a.likeRowId}` });
            } else if (a.type === 'advance' && L.settings.list.captureAdvance) {
              const rows = latest.current.rows;
              let last = -1;
              for (const id of a.afterIds) last = Math.max(last, rows.findIndex((x) => x.id === id));
              const next = rows.findIndex((x, i) => i > last && x.key !== null);
              if (next >= 0) moveCursorRef.current(next);
            }
          } catch (err) {
            setMessage((err as Error).message);
          }
        }
      }),
    [input, store],
  );

  if (!track) return <p className="placeholder">{t('トラックがありません。')}</p>;

  function scrollToRow(r: number) {
    const el = scrollRef.current;
    if (!el) return;
    const y = r * ROW_H;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ROW_H > el.scrollTop + el.clientHeight - ROW_H) el.scrollTop = y + ROW_H * 2 - el.clientHeight;
  }

  function cellText(r: ListRow, col: Col): string {
    switch (col) {
      case 'meas':
        return String(r.meas).padStart(3, '0');
      case 'step':
        return r.step === 0 ? '--' : String(r.step).padStart(2, '0');
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
      case 'ch': {
        const ch = isConductorEvent(r.event) ? null : eventChannel(track!, r.event);
        if (ch === null) return '--';
        return `${ch + 1}${'channelOverride' in r.event && r.event.channelOverride !== undefined ? '*' : ''}`;
      }
      case 'tick':
        return formatTicks(r.tick, unit, project.ppq);
      case 'detail':
        return r.detail;
    }
  }

  const isBytesRow = (r: ListRow) => r.event.kind === 'sysex' || r.event.kind === 'meta';

  /** Why the cell cannot be edited as text, or null. SysEx / meta rows open the bytes dialog instead (see startEdit). */
  function canEdit(r: ListRow, col: Col): string | null {
    if (isConductorEvent(r.event)) {
      const k = r.event.kind;
      if ((k === 'tempo' && col === 'vel') || (k === 'time-signature' && col === 'name') || (k === 'marker' && col === 'detail')) return null;
      return t('コンダクター行で編集できるのはテンポの VEL（BPM）、拍子の NOTE（例: 3/4）、マーカーの DETAIL です。ほかはコンダクタータブで。');
    }
    if (!EDITABLE.includes(col)) return t('この列は編集できません。');
    if (col === 'st' && filtered) return t('フィルター中は ST を編集できません（表示されていないイベントを誤って動かさないため）。すべての種類を表示してください。');
    if (r.event.kind === 'raw') return t('raw イベントは編集できません（内容をそのまま保持します）。');
    if (col === 'key' && r.key === null) return t('ノート番号のない行です。');
    if (col === 'gt' && r.event.kind !== 'note') return t('GT はノートだけにあります。');
    if (col === 'vel' && r.value === null) return t('この行には値がありません。');
    if (col === 'st' && r.stTicks === null) return t('最後のイベントの ST は変更できません。');
    if (col === 'ch' && !isConductorEvent(r.event) && eventChannel(track!, r.event) === null) return t('チャンネルを持たない行です。');
    return null;
  }

  function commit(text: string, how: Commit = 'enter'): boolean {
    if (!cur) return false;
    const col = cursor.col;
    try {
      let cmd = null;
      if (isConductorEvent(cur.event)) {
        const s = text.trim();
        if (cur.event.kind === 'tempo') {
          if (!/^\d+(\.\d+)?$/.test(s)) {
            setMessage(t('テンポは 1〜999 BPM で入力してください。'));
            return false;
          }
          cmd = setTempo(store.project, cur.tick, Number(s));
        } else if (cur.event.kind === 'time-signature') {
          const m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
          if (!m) {
            setMessage(t('拍子は 3/4 のように入力してください。'));
            return false;
          }
          cmd = setTimeSignature(store.project, cur.tick, Number(m[1]), Number(m[2]));
        } else if (cur.event.kind === 'marker') cmd = upsertConductorEvent(store.project, cur.tick, { kind: 'marker', text }, cur.id);
        else return false;
      } else if (col === 'st' || col === 'gt' || col === 'tick') {
        const tk = parseTicksInput(text, unit, project.ppq);
        if (!tk.ok) {
          setMessage(tk.message);
          return false;
        }
        if (col === 'st') cmd = setStepTime(store.project, track!.id, cur.id, tk.ticks);
        else if (col === 'gt') cmd = setGateTime(store.project, cur.id, tk.ticks);
        else cmd = setAbsoluteTick(store.project, cur.id, tk.ticks);
      } else if (col === 'name') {
        const parsed = parseNameInput(text, cur.event.kind);
        if ('error' in parsed) {
          setMessage(parsed.error);
          return false;
        }
        cmd = applyNameInput(store.project, cur.id, parsed);
      } else if (col === 'ch') {
        const s = text.trim();
        if (s === '' || s === '-') cmd = setRowChannel(store.project, [cur.id], null);
        else if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > 16) {
          setMessage(t('チャンネルは 1〜16 です。'));
          return false;
        } else cmd = setRowChannel(store.project, [cur.id], Number(s) - 1);
      } else {
        if (!/^-?\d+$/.test(text.trim())) {
          setMessage(t('整数を入力してください。'));
          return false;
        }
        const v = Number(text.trim());
        cmd = col === 'key' ? setRowKey(store.project, cur.id, v) : setRowValue(store.project, cur.id, v);
      }
      if (cmd) store.run(cmd);
      lastCommitted.current[col] = text;
      setMessage(selection.eventIds.size > 1 && selection.eventIds.has(cur.id) ? t('入力は現在行だけに適用しました。複数行は右クリックの「選択行の一括変更…」を使ってください。') : null);
      setEditing(null);
      gridRef.current?.focus();
      afterCommit(how);
      return true;
    } catch (e) {
      setMessage((e as Error).message);
      return false;
    }
  }

  function afterCommit(how: Commit) {
    const dir = how === 'enter' ? settings.list.enterMoves : how === 'shift-enter' ? 'up' : how === 'tab' ? 'right' : how === 'shift-tab' ? 'left' : 'stay';
    if (dir === 'down') moveCursor(cursor.row + 1, cursor.col);
    else if (dir === 'up') moveCursor(cursor.row - 1, cursor.col);
    else if (dir === 'right' || dir === 'left') {
      const order = COLS.filter((c) => EDITABLE.includes(c));
      const i = order.indexOf(cursor.col);
      setCursor({ ...cursor, col: order[Math.max(0, Math.min(order.length - 1, i + (dir === 'right' ? 1 : -1)))] });
    }
  }

  function startEdit(initial?: string) {
    if (!cur) return;
    if (isBytesRow(cur) && (cursor.col === 'name' || cursor.col === 'detail' || (cursor.col === 'vel' && cur.value === null))) {
      setBytesDialog({ mode: 'edit', id: cur.id });
      return;
    }
    const why = canEdit(cur, cursor.col);
    if (why) {
      setMessage(why);
      return;
    }
    setEditing(initial === undefined ? { text: cellText(cur, cursor.col), selectAll: true } : { text: initial, selectAll: false });
  }

  function repeatLast() {
    const text = lastCommitted.current[cursor.col];
    if (text === undefined) {
      setMessage(t('この列に前回の値がありません。'));
      return;
    }
    if (!cur) return;
    if (isBytesRow(cur) && (cursor.col === 'name' || cursor.col === 'detail' || cursor.col === 'vel')) {
      setMessage(t('この行は前回値を使えません（Enter でダイアログを開きます）。'));
      return;
    }
    const why = canEdit(cur, cursor.col);
    if (why) setMessage(why);
    else commit(text, 'repeat');
  }

  function moveCursor(row: number, col = cursor.col, extend = false) {
    const r = Math.max(0, Math.min(rows.length - 1, row));
    setCursor({ row: r, col });
    const target = rows[r];
    if (target) {
      if (extend) store.selectEvents([...selection.eventIds, target.id]);
      else store.selectEvents([target.id]);
      if (stepMode && target.tick !== step.cursor) step.setCursor(target.tick);
    }
    scrollToRow(r);
  }
  moveCursorRef.current = moveCursor;

  function runNudge(row: ListRow, col: NudgeCol, steps: number, mergeKey: string) {
    try {
      const r = nudgeCell(store.project, track!.id, row, col, { steps, unit, ppq: project.ppq });
      if (!r) return;
      if ('message' in r) {
        setMessage(r.message);
        return;
      }
      if (r.command) store.run(r.command, { mergeKey });
      setMessage(null);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  function nudgeCursor(delta: number, big: boolean) {
    if (!cur) return;
    const col = NUDGE_COL[cursor.col];
    if (!col) {
      setMessage(t('この列は編集できません。'));
      return;
    }
    runNudge(cur, col, delta * (big ? (col === 'key' ? 12 : 10) : 1), `list-nudge:${cur.id}:${col}`);
  }

  /** Vertical drag on a numeric cell (mouse only): 6 px per unit, Shift ×10, one undo step per drag. */
  function startDrag(e: React.PointerEvent, row: ListRow, col: NudgeCol) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragCleanup.current?.();
    const startY = e.clientY;
    const id = row.id;
    const key = `list-drag:${id}:${col}:${Date.now()}`;
    let applied = 0;
    const onMove = (ev: PointerEvent) => {
      const units = Math.trunc((startY - ev.clientY) / 6);
      if (units === applied) return;
      const steps = (units - applied) * (ev.shiftKey ? 10 : 1);
      applied = units;
      const r = latest.current.rows.find((x) => x.id === id);
      if (r) runNudge(r, col, steps, key);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      dragCleanup.current = null;
    };
    // a drag whose pointerup never arrives (⌘Tab, a popup, the tab losing focus) must not keep nudging on later moves
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
    dragCleanup.current = onUp;
  }

  const cursorPoint = () => {
    const el = scrollRef.current;
    const rect = el?.getBoundingClientRect();
    if (!el || !rect) return { clientX: 100, clientY: 100 };
    return { clientX: rect.left + 60, clientY: Math.min(rect.bottom - 10, Math.max(rect.top, rect.top + cursor.row * ROW_H - el.scrollTop + ROW_H)) };
  };
  const insertTick = () => (cur ? cur.tick : stepMode ? step.cursor : Math.round(transport.getPosition().tick));

  function doInsert(kind: InsertKind) {
    gridRef.current?.focus();
    try {
      const r = insertListEvent(store.project, track!.id, insertTemplate(store.project, track!, kind, { tick: insertTick(), pitchHint: cur?.key ?? null }));
      if (!r) return;
      pendingFocus.current = { id: r.ids[0], col: 'name' };
      store.run(r.command, { select: r.ids });
      setMessage(null);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  function doInsertSet(set: InsertSet) {
    gridRef.current?.focus();
    try {
      const r = insertSet(store.project, track!.id, set, { tick: insertTick() });
      if (!r) return;
      pendingFocus.current = { id: r.ids[0], col: 'vel' };
      store.run(r.command, { select: r.ids });
      setMessage(null);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  /** Inserts a conductor event at the cursor tick (the value in effect there) and puts the cursor on it. */
  function doInsertConductor(kind: 'tempo' | 'time-signature' | 'marker') {
    gridRef.current?.focus();
    try {
      const tick = insertTick();
      const before = new Set(store.project.conductor.map((c) => c.id));
      let cmd;
      if (kind === 'tempo') {
        const last = [...store.project.conductor].filter((c) => c.kind === 'tempo' && c.tick <= tick).sort((a, b) => a.tick - b.tick || a.originOrder - b.originOrder).pop();
        cmd = setTempo(store.project, tick, Math.round(bpmFromUs(last && last.kind === 'tempo' ? last.usPerQuarter : 500_000) * 100) / 100);
      } else if (kind === 'time-signature') {
        const ts = sig.signatureAt(tick);
        cmd = setTimeSignature(store.project, tick, ts.numerator, ts.denominator);
      } else cmd = upsertConductorEvent(store.project, tick, { kind: 'marker', text: t('マーカー') });
      store.run(cmd);
      const added = store.project.conductor.find((c) => !before.has(c.id)) ?? store.project.conductor.find((c) => c.kind === kind && c.tick === tick);
      if (added) {
        pendingFocus.current = { id: added.id, col: kind === 'tempo' ? 'vel' : kind === 'marker' ? 'detail' : 'name' };
        setCursor((c) => ({ ...c })); // re-run the pending-focus effect even when the rows did not change identity
      }
      setShowConductor(true);
      setMessage(null);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  function doPaste(mode: 'overlay' | 'insert') {
    const clip = store.getState().clipboard;
    if (!clip) {
      setMessage(t('コピーしたイベントがありません。'));
      return;
    }
    try {
      const r = pasteRowsAt(store.project, track!.id, insertTick(), clip, mode);
      if (!r) return;
      pendingFocus.current = { id: r.ids[0], col: cursor.col };
      store.run(r.command, { select: r.ids });
      setMessage(null);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  function insertMenuItems(): MenuItem[] {
    return [
      ...INSERT_KINDS.map((k) => ({ label: k.label, accessKey: k.key, action: () => doInsert(k.kind) })),
      { label: t('SysEx…'), accessKey: 's', action: () => setBytesDialog({ mode: 'insert', kind: 'sysex', tick: insertTick() }) },
      { label: t('Meta…'), accessKey: 'm', action: () => setBytesDialog({ mode: 'insert', kind: 'meta', tick: insertTick() }) },
      { separator: true, label: '' },
      { label: t('セット'), items: INSERT_SETS.map((s) => ({ label: t(SET_LABEL[s]), action: () => doInsertSet(s) })) },
      { separator: true, label: '' },
      { label: 'Tempo', accessKey: 't', action: () => doInsertConductor('tempo') },
      { label: 'Time Signature', accessKey: 'i', action: () => doInsertConductor('time-signature') },
      { label: 'Marker', accessKey: 'k', action: () => doInsertConductor('marker') },
    ];
  }

  /** rows a row command acts on: the selection when the cursor row is part of it, else the cursor row */
  const targetIds = (): string[] => (cur && selection.eventIds.has(cur.id) && selection.eventIds.size > 1 ? [...selection.eventIds] : cur ? [cur.id] : []);

  function doConvert(target: ConvertTarget) {
    gridRef.current?.focus();
    try {
      const cmd = convertEventKinds(store.project, targetIds(), target);
      if (cmd) store.run(cmd);
      setMessage(null);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  function convertMenu(r: ListRow): MenuItem {
    const raw = r.event.kind === 'raw';
    const item = (label: string, target: ConvertTarget, kind: string): MenuItem => ({ label, disabled: raw || r.event.kind === kind, action: () => doConvert(target) });
    return {
      label: t('種類を変更'),
      disabled: raw,
      reason: raw ? t('raw イベントは種類を変更できません（内容をそのまま保持します）。') : undefined,
      items: [
        item('Note', { kind: 'note' }, 'note'),
        item('Control Change', { kind: 'cc' }, 'cc'),
        item('Program Change', { kind: 'program' }, 'program'),
        item('Pitch Bend', { kind: 'pitch-bend' }, 'pitch-bend'),
        item('Channel Pressure', { kind: 'channel-pressure' }, 'channel-pressure'),
        item('Poly Pressure', { kind: 'poly-pressure' }, 'poly-pressure'),
        { separator: true, label: '' },
        { label: t('SysEx…'), disabled: raw || r.event.kind === 'sysex', action: () => setBytesDialog({ mode: 'convert', ids: targetIds(), kind: 'sysex' }) },
        { label: t('Meta…'), disabled: raw || r.event.kind === 'meta', action: () => setBytesDialog({ mode: 'convert', ids: targetIds(), kind: 'meta' }) },
      ],
    };
  }

  function pasteMenuItems(): MenuItem[] {
    const has = Boolean(store.getState().clipboard);
    return [
      { label: t('ここに貼り付け'), shortcut: `${MOD_LABEL}V`, disabled: !has, reason: t('コピーしたイベントがありません。'), action: () => doPaste('overlay') },
      { label: t('挿入して貼り付け（後ろのイベントをずらす）'), shortcut: `⇧${MOD_LABEL}V`, disabled: !has, reason: t('コピーしたイベントがありません。'), action: () => doPaste('insert') },
    ];
  }

  function rowMenuItems(r: ListRow): MenuItem[] {
    if (isConductorEvent(r.event)) {
      return [
        { label: t('値を編集'), shortcut: 'Enter', action: () => startEdit() },
        { label: t('挿入'), shortcut: 'Insert', items: insertMenuItems() },
        ...pasteMenuItems(),
        { separator: true, label: '' },
        { label: t('削除'), shortcut: 'Delete', action: () => store.run(deleteConductorEvent(store.project, r.id)) },
        { label: t('再生位置をここに移動'), action: () => transport.seek(r.tick) },
        { label: t('コンダクタートラックを開く'), action: () => store.updateSettings({ activePanel: 'tempo' }) },
      ];
    }
    return [
      { label: t('値を編集'), shortcut: 'Enter', action: () => startEdit() },
      { label: t('挿入'), shortcut: 'Insert', items: insertMenuItems() },
      convertMenu(r),
      ...pasteMenuItems(),
      { separator: true, label: '' },
      ...noteMenuItems(editActions, { noteLength: false }),
      { separator: true, label: '' },
      { label: t('選択行の一括変更…'), disabled: selection.eventIds.size === 0, action: () => setBatchOpen(true) },
      { label: t('再生位置をここに移動'), action: () => transport.seek(r.tick) },
    ];
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing) return;
    const intent = listKeyIntent(mode, { key: e.key, code: e.code, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }, (code) => input.ownerOf(code) !== null, IS_MAC);
    if (!intent) return; // not ours: the router / global shortcuts get it
    e.preventDefault();
    e.stopPropagation();
    const ci = COLS.indexOf(cursor.col);
    switch (intent.type) {
      case 'row':
        moveCursor(cursor.row + intent.delta, cursor.col, intent.extend);
        break;
      case 'page':
        moveCursor(cursor.row + intent.delta * Math.max(1, Math.floor(scroll.h / ROW_H)));
        break;
      case 'home':
        moveCursor(0);
        break;
      case 'end':
        moveCursor(rows.length - 1);
        break;
      case 'col':
        setCursor({ ...cursor, col: COLS[Math.max(0, Math.min(COLS.length - 1, ci + intent.delta))] });
        break;
      case 'edit':
        startEdit();
        break;
      case 'edit-typed':
        startEdit(intent.text);
        break;
      case 'nudge':
        nudgeCursor(intent.delta, intent.big);
        break;
      case 'repeat-last':
        repeatLast();
        break;
      case 'delete':
        if (cur && isConductorEvent(cur.event) && selection.eventIds.size === 0) store.run(deleteConductorEvent(store.project, cur.id));
        else store.run(deleteEvents(store.project, selection.eventIds.size ? selection.eventIds : cur ? [cur.id] : []));
        break;
      case 'paste':
        doPaste(intent.insert ? 'insert' : 'overlay');
        break;
      case 'insert-menu':
        ctxMenu.open({ ...cursorPoint(), preventDefault: () => undefined }, insertMenuItems());
        break;
      case 'insert':
        if (intent.kind === 'sysex' || intent.kind === 'meta') setBytesDialog({ mode: 'insert', kind: intent.kind, tick: insertTick() });
        else doInsert(intent.kind);
        break;
      case 'octave':
        if (!e.repeat) store.setInputPresets(shiftOctave(project.inputPresets, intent.delta)); // held key: one step, like the global ↑↓
        break;
      case 'context-menu':
        if (cur) ctxMenu.open({ ...cursorPoint(), preventDefault: () => undefined }, rowMenuItems(cur));
        break;
    }
  }

  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - 5);
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.h) / ROW_H) + 5);
  const lossless = isClassic48Lossless(project.ppq) || project.ppq % 48 === 0;
  const setList = (patch: Partial<typeof settings.list>) => store.updateSettings({ list: { ...settings.list, ...patch } });

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
        <label className="note" title={t('テンポ・拍子・調号・マーカーを時刻順に混ぜて表示します。ST には入りません。')}>
          <input type="checkbox" checked={showConductor} onChange={(e) => setShowConductor(e.target.checked)} /> {t('コンダクター')}
        </label>
        <button
          aria-haspopup="menu"
          title={t('カーソル位置にイベントを挿入（Insert / {alt}Enter）。{alt}N / C / P / B / A / Y / S / M ならどのモードでもメニューなしで入ります。', { alt: IS_MAC ? '⌥' : 'Alt+' })}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            ctxMenu.open({ clientX: r.left, clientY: r.bottom + 2, preventDefault: () => undefined }, insertMenuItems());
          }}
          data-testid="list-insert"
        >
          {t('挿入 ▾')}
        </button>
        <button disabled={!selection.eventIds.size} onClick={() => {
          const r = duplicateEvents(store.project, selection.eventIds, 0);
          if (r) store.run(r.command, { select: r.ids });
        }}>{t('複製')}</button>
        <label className="note" title={t('セルを Enter で確定したあと、カーソルをどこへ動かすか（Tab はいつも右の列へ）')}>
          {t('確定後:')}{' '}
          <select value={settings.list.enterMoves} onChange={(e) => setList({ enterMoves: e.target.value as typeof settings.list.enterMoves })} aria-label={t('Enter で確定したあとのカーソル')}>
            <option value="down">{t('下の行へ')}</option>
            <option value="right">{t('右の列へ')}</option>
            <option value="stay">{t('動かない')}</option>
          </select>
        </label>
        {!stepMode && (
          <>
            <label className="note" title={t('鍵盤を弾くと現在行の K# が変わります。次に K# のある行へ進むかどうか。')}>
              <input type="checkbox" checked={settings.list.captureAdvance} onChange={(e) => setList({ captureAdvance: e.target.checked })} /> {t('鍵盤入力後に次の行へ')}
            </label>
            <label className="note">
              <input type="checkbox" checked={settings.list.captureVelocity} onChange={(e) => setList({ captureVelocity: e.target.checked })} /> {t('VEL も取り込む')}
            </label>
          </>
        )}
        <button onClick={() => store.updateSettings({ activePanel: 'tempo' })} title={t('テンポ・拍子・調号・マーカーは「コンダクター」タブで編集します')}>
          {t('コンダクタートラックを開く')}
        </button>
      </div>
      {filtered && <div className="list-notice">{t('フィルター中: ST は表示されていないイベントも含めた次のイベントまでの距離です。ST の編集はすべて表示したときだけできます。')}</div>}
      {editing && mode !== 'edit-shortcuts' && <div className="list-notice">{t('セル入力中（鍵盤は鳴りません）')}</div>}
      {!editing && performing && focused && <div className="list-notice">{recState.phase === 'idle' ? t('鍵盤を弾くと現在行の K# を書き換えます。同時に押した音は和音として入ります（録音中は録音が優先）。') : t('録音中: 鍵盤は録音され、リストの行は変わりません。')}</div>}
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
          aria-label={t('イベントリスト: {name}。上下で行、左右で列を移動、Enter で編集、+/- で増減、{mod}Enter で前回値。', { name: track.name, mod: MOD_LABEL })}
          aria-rowcount={rows.length}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (!gridRef.current?.contains(e.relatedTarget as Node | null)) setFocused(false);
          }}
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
                      if (isSecondaryClick(e)) return; // the context-menu handler keeps a multi-row selection
                      const col = ((e.target as HTMLElement).dataset.col as Col | undefined) ?? cursor.col;
                      setEditing(null);
                      moveCursor(i, col, e.shiftKey);
                      const nc = NUDGE_COL[col];
                      if (nc && col !== 'name' && canEdit(r, col) === null) startDrag(e, r, nc);
                    }}
                    onDoubleClick={() => startEdit()}
                    onContextMenu={(e) => {
                      if (!selection.eventIds.has(r.id)) moveCursor(i);
                      ctxMenu.open(e, rowMenuItems(r));
                    }}
                  >
                    {COLS.map((c) => {
                      const active = cursor.row === i && cursor.col === c;
                      const numeric = NUDGE_COL[c] !== undefined && c !== 'name' && canEdit(r, c) === null;
                      return (
                        <div key={c} role="gridcell" data-col={c} className={`lc lc-${c}${active ? ' cursor' : ''}${numeric ? ' numeric' : ''}`}>
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
                              onFocus={(e) => {
                                if (editing.selectAll) e.currentTarget.select();
                              }}
                              onChange={(e) => setEditing({ text: e.target.value, selectAll: false })}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') commit(editing.text, e.shiftKey ? 'shift-enter' : 'enter');
                                else if (e.key === 'Tab') {
                                  e.preventDefault();
                                  commit(editing.text, e.shiftKey ? 'shift-tab' : 'tab');
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
      {bytesDialog && (
        <EventBytesDialog
          state={bytesDialog}
          trackId={track.id}
          onClose={() => {
            setBytesDialog(null);
            gridRef.current?.focus();
          }}
          onDone={(ids) => {
            if (ids[0]) pendingFocus.current = { id: ids[0], col: 'name' };
          }}
        />
      )}
      {batchOpen && (
        <ListBatchDialog
          ids={[...selection.eventIds]}
          onClose={() => {
            setBatchOpen(false);
            gridRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
