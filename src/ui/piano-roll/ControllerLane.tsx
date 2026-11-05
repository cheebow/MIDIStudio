// Velocity / CC / Pitch Bend lane under the piano roll (REQ-EDT-05).
// Velocity: drag across bars to paint values; where notes start together (a chord, drum parts),
// grabbing one bar's head changes only that note (ADR-072); the drum editor can narrow the lane to
// one part (pitchFilter). CC / Pitch Bend (ADR-040): a click on empty space
// adds a point at the snapped tick; a click on a point selects it (Shift adds / removes); a drag
// on empty space selects the points inside the box; dragging a selected point moves the values of
// every selected point; Delete, Alt+click or the right-click menu delete. Points share the editor
// selection with the piano roll and the list. Saved data is never thinned out.
import { useEffect, useMemo, useRef } from 'react';
import { useThemeVersion } from '../../app/theme';
import { addEvents, deleteEvents, updateEvents } from '../../core/editing/operations';
import type { MidiEvent, MidiTrack } from '../../core/model/types';
import { useEditorState, useServices } from '../../app/store/context';
import { t } from '../../i18n';
import { fitCanvas, readTheme } from '../canvas';
import { CC_NAMES } from '../../core/gm/ccNames';
import { Splitter } from '../Splitter';
import { isSecondaryClick, useContextMenu } from '../menu/ContextMenu';
import { useDragState } from '../hooks';

type LaneEvent = Extract<MidiEvent, { kind: 'cc' | 'pitch-bend' }>;

type Drag =
  /** velocity paint; onlySelected: the drag started on a selected note, so only selected notes change */
  | { kind: 'paint'; values: Map<string, number>; onlySelected: boolean }
  /** one note of a stack, grabbed by its bar's head (ADR-072) */
  | { kind: 'one'; id: string; value: number }
  /** value drag of the selected points; delta in value units */
  | { kind: 'points'; ids: Set<string>; startY: number; delta: number; min: number; max: number }
  /** pointer down on empty space: a click adds a point, a move turns it into a box selection */
  | { kind: 'pending'; x: number; y: number; additive: boolean }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; additive: boolean };

/** px around a bar's head that grab it */
const HEAD_HIT_PX = 6;

export function ControllerLane({
  track,
  viewX,
  width,
  offsetLeft,
  pxPerTick,
  snap,
  noteColor,
  pitchFilter,
  onVelocityPreview,
}: {
  track: MidiTrack;
  viewX: number;
  width: number;
  offsetLeft: number;
  pxPerTick: number;
  snap: (t: number) => number;
  noteColor?: (pitch: number) => string;
  /** velocity lane shows and edits only this pitch (a drum part, ADR-072); the label names it and offers to clear it */
  pitchFilter?: { pitch: number; name: string; onClear: () => void } | null;
  /** velocities being dragged (id → value), null when no velocity drag is active: the editor draws its notes with them live */
  onVelocityPreview?: (values: ReadonlyMap<string, number> | null) => void;
}) {
  useThemeVersion(); // re-render (and redraw) when the theme changes
  const { store } = useServices();
  const { project, selection } = useEditorState();
  const lane = project.settings.controllerLane;
  const LANE_H = project.settings.laneHeight;
  const collapsed = project.settings.laneCollapsed;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, dragRef, setDrag] = useDragState<Drag>();
  const ctxMenu = useContextMenu();

  const isPb = lane === 'pitch-bend';
  const range = isPb ? { min: -8192, max: 8191 } : { min: 0, max: 127 };
  const laneEvents = useMemo<LaneEvent[]>(
    () => (lane === 'velocity' ? [] : track.events.filter((e): e is LaneEvent => (isPb ? e.kind === 'pitch-bend' : e.kind === 'cc' && e.controller === lane))),
    [track.events, lane, isPb],
  );
  const filterPitch = pitchFilter?.pitch;
  const notes = useMemo(() => track.events.filter((e): e is Extract<MidiEvent, { kind: 'note' }> => e.kind === 'note' && (filterPitch === undefined || e.pitch === filterPitch)), [track.events, filterPitch]);
  const selectedPoints = useMemo(() => laneEvents.filter((e) => selection.eventIds.has(e.id)), [laneEvents, selection.eventIds]);

  const valueToY = (v: number) => LANE_H - 4 - ((v - range.min) / (range.max - range.min)) * (LANE_H - 8);
  const yToValue = (y: number) => Math.round(Math.max(range.min, Math.min(range.max, range.min + ((LANE_H - 4 - y) / (LANE_H - 8)) * (range.max - range.min))));
  /** pixels → value units (no clamping), for drag deltas */
  const dyToDelta = (dy: number) => Math.round((-dy / (LANE_H - 8)) * (range.max - range.min));
  const clampValue = (v: number) => Math.max(range.min, Math.min(range.max, v));
  // tell the editor what the drag would set, so its notes follow the pointer instead of changing on release
  useEffect(() => {
    if (!onVelocityPreview) return;
    onVelocityPreview(drag?.kind === 'paint' ? drag.values : drag?.kind === 'one' ? new Map([[drag.id, drag.value]]) : null);
  }, [drag, onVelocityPreview]);
  useEffect(() => () => onVelocityPreview?.(null), [onVelocityPreview]);
  const valueOf = (e: LaneEvent) => (drag?.kind === 'points' && drag.ids.has(e.id) ? clampValue(e.value + drag.delta) : e.value);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || collapsed) return;
    const ctx = fitCanvas(canvas, width, LANE_H);
    if (!ctx) return;
    const th = readTheme(canvas);
    ctx.fillStyle = th.panel;
    ctx.fillRect(0, 0, width, LANE_H);
    if (viewX < 0) {
      ctx.fillStyle = th.blackKey;
      ctx.fillRect(0, 0, -viewX, LANE_H);
    }
    ctx.strokeStyle = th.border;
    ctx.strokeRect(0.5, 0.5, width - 1, LANE_H - 1);
    const t0 = viewX / pxPerTick;
    const t1 = (viewX + width) / pxPerTick;
    if (lane === 'velocity') {
      const visible = notes.filter((n) => n.tick >= t0 - 1 && n.tick <= t1);
      // notes sharing a pixel column: their heads are drawn larger, as each one can be grabbed alone
      const perColumn = new Map<number, number>();
      for (const n of visible) {
        const c = Math.round(n.tick * pxPerTick - viewX);
        perColumn.set(c, (perColumn.get(c) ?? 0) + 1);
      }
      for (const n of visible) {
        const v = velocityOf(n);
        const x = n.tick * pxPerTick - viewX;
        ctx.fillStyle = selection.eventIds.has(n.id) || (drag?.kind === 'one' && drag.id === n.id) ? th.noteSelected : noteColor ? noteColor(n.pitch) : track.color;
        const y = valueToY(v);
        ctx.fillRect(x, y, 3, LANE_H - 4 - y);
        ctx.beginPath();
        ctx.arc(x + 1.5, y, (perColumn.get(Math.round(x)) ?? 0) > 1 ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    if (isPb) {
      ctx.strokeStyle = th.grid;
      ctx.beginPath();
      ctx.moveTo(0, valueToY(0) + 0.5);
      ctx.lineTo(width, valueToY(0) + 0.5);
      ctx.stroke();
    }
    // Step line + points. Points are drawn at most one per pixel; the data itself is not thinned.
    let prevY = valueToY(isPb ? 0 : laneEvents.length ? valueOf(laneEvents[0]) : 0);
    ctx.strokeStyle = track.color;
    ctx.beginPath();
    ctx.moveTo(0, prevY);
    let lastX = -Infinity;
    let lastSelected = false;
    for (const e of laneEvents) {
      const x = e.tick * pxPerTick - viewX;
      const y = valueToY(valueOf(e));
      ctx.lineTo(x, prevY);
      ctx.lineTo(x, y);
      prevY = y;
      const selected = selection.eventIds.has(e.id);
      // a selected point is drawn even when it shares the pixel with an unselected one
      if ((x - lastX >= 1 || (selected && !lastSelected)) && x >= -4 && x <= width + 4) {
        ctx.fillStyle = selected ? th.noteSelected : track.color;
        if (selected) ctx.fillRect(x - 3, y - 3, 6, 6);
        else ctx.fillRect(x - 2, y - 2, 4, 4);
        lastX = x;
        lastSelected = selected;
      }
    }
    ctx.lineTo(width, prevY);
    ctx.stroke();
    if (drag?.kind === 'box') {
      ctx.strokeStyle = th.accent;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(drag.x0, drag.x1) + 0.5, Math.min(drag.y0, drag.y1) + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      ctx.setLineDash([]);
    }
  });

  function velocityOf(n: Extract<MidiEvent, { kind: 'note' }>): number {
    if (drag?.kind === 'paint') return drag.values.get(n.id) ?? n.velocity;
    if (drag?.kind === 'one' && drag.id === n.id) return drag.value;
    return n.velocity;
  }

  /** where several notes start at x: the one whose bar head is nearest to y (within HEAD_HIT_PX) */
  function stackHeadAt(x: number, y: number): string | null {
    const ids = new Set(notesAt(x));
    if (ids.size < 2) return null; // a lone bar keeps painting, so a stroke can start on it
    let best: string | null = null;
    let bestD = HEAD_HIT_PX + 1;
    for (const n of notes) {
      if (!ids.has(n.id)) continue;
      const d = Math.abs(valueToY(n.velocity) - y);
      // equal heights: prefer a selected note, so the one picked in the editor is the one grabbed
      if (d < bestD || (d === bestD && selection.eventIds.has(n.id))) {
        best = n.id;
        bestD = d;
      }
    }
    return bestD <= HEAD_HIT_PX ? best : null;
  }

  function notesAt(x: number): string[] {
    const t = (x + viewX) / pxPerTick;
    const tol = 4 / pxPerTick;
    return notes.filter((n) => Math.abs(n.tick - t) <= tol).map((n) => n.id);
  }

  /** the nearest point within a few pixels of (x, y) */
  function pointAt(x: number, y: number): LaneEvent | null {
    let best: LaneEvent | null = null;
    let bestD = Infinity;
    for (const e of laneEvents) {
      const dx = Math.abs(e.tick * pxPerTick - viewX - x);
      const dy = Math.abs(valueToY(e.value) - y);
      if (dx > 4 || dy > 6) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  /** points whose tick and value fall inside the box (every event, drawn or not) */
  function pointsInBox(x0: number, y0: number, x1: number, y1: number): string[] {
    const ta = (Math.min(x0, x1) + viewX) / pxPerTick;
    const tb = (Math.max(x0, x1) + viewX) / pxPerTick;
    const lo = yToValue(Math.max(y0, y1));
    const hi = yToValue(Math.min(y0, y1));
    return laneEvents.filter((e) => e.tick >= ta && e.tick <= tb && e.value >= lo && e.value <= hi).map((e) => e.id);
  }

  const laneIds = (ids: Iterable<string>) => {
    const own = new Set(laneEvents.map((e) => e.id));
    return [...ids].filter((id) => own.has(id));
  };

  function deletePoints(ids: string[]) {
    store.run(deleteEvents(store.project, ids, isPb ? 'Pitch Bend を削除' : 'コントローラーを削除'));
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (isSecondaryClick(e)) return; // the context menu handles it
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (lane === 'velocity') {
      const head = stackHeadAt(x, y);
      if (head) {
        setDrag({ kind: 'one', id: head, value: Math.max(1, yToValue(y)) });
        return;
      }
      const values = new Map<string, number>();
      const targets = notesAt(x);
      const sel = targets.filter((id) => selection.eventIds.has(id));
      for (const id of sel.length ? sel : targets) values.set(id, Math.max(1, yToValue(y)));
      setDrag({ kind: 'paint', values, onlySelected: sel.length > 0 });
      return;
    }
    const hit = pointAt(x, y);
    if (hit && e.altKey) {
      deletePoints(selection.eventIds.has(hit.id) ? laneIds(selection.eventIds) : [hit.id]);
      return;
    }
    if (hit && e.shiftKey) {
      const next = new Set(selection.eventIds);
      if (next.has(hit.id)) next.delete(hit.id);
      else next.add(hit.id);
      store.selectEvents(next);
      return;
    }
    if (hit) {
      // drag the whole selection when the point is part of it, otherwise just this point
      const ids = selection.eventIds.has(hit.id) ? new Set(laneIds(selection.eventIds)) : new Set([hit.id]);
      if (!selection.eventIds.has(hit.id)) store.selectEvents(ids);
      const values = laneEvents.filter((p) => ids.has(p.id)).map((p) => p.value);
      setDrag({ kind: 'points', ids, startY: y, delta: 0, min: Math.min(...values), max: Math.max(...values) });
      return;
    }
    setDrag({ kind: 'pending', x, y, additive: e.shiftKey });
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = dragRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!d) {
      e.currentTarget.style.cursor = (lane === 'velocity' ? stackHeadAt(x, y) : pointAt(x, y)) ? 'ns-resize' : 'crosshair';
      return;
    }
    if (d.kind === 'one') {
      setDrag({ ...d, value: Math.max(1, yToValue(y)) });
    } else if (d.kind === 'paint') {
      const values = new Map(d.values);
      const v = Math.max(1, yToValue(y));
      const under = notesAt(x);
      for (const id of d.onlySelected ? under.filter((id) => selection.eventIds.has(id)) : under) values.set(id, v);
      setDrag({ ...d, values });
    } else if (d.kind === 'points') {
      // the group keeps its shape: no point may leave the value range
      const delta = Math.max(range.min - d.min, Math.min(range.max - d.max, dyToDelta(y - d.startY)));
      setDrag({ ...d, delta });
    } else if (d.kind === 'pending') {
      if (Math.abs(x - d.x) > 3 || Math.abs(y - d.y) > 3) setDrag({ kind: 'box', x0: d.x, y0: d.y, x1: x, y1: y, additive: d.additive });
    } else setDrag({ ...d, x1: x, y1: y });
  }

  function onPointerUp() {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    if (d.kind === 'one') {
      const n = notes.find((x) => x.id === d.id);
      if (n && n.velocity !== d.value) store.run(updateEvents(store.project, [{ id: d.id, changes: { velocity: d.value } }], 'ベロシティを変更'));
    } else if (d.kind === 'paint') {
      if (d.values.size > 0) store.run(updateEvents(store.project, [...d.values].map(([id, velocity]) => ({ id, changes: { velocity } })), 'ベロシティを変更'));
    } else if (d.kind === 'points') {
      if (d.delta !== 0) {
        const updates = laneEvents.filter((p) => d.ids.has(p.id)).map((p) => ({ id: p.id, changes: { value: clampValue(p.value + d.delta) } }));
        store.run(updateEvents(store.project, updates, isPb ? 'Pitch Bend を変更' : 'コントローラー値を変更'));
      }
    } else if (d.kind === 'pending') {
      const tick = Math.max(0, snap((d.x + viewX) / pxPerTick));
      const value = yToValue(d.y);
      const ev = isPb ? { kind: 'pitch-bend' as const, tick, value } : { kind: 'cc' as const, tick, controller: lane as number, value };
      const r = addEvents(store.project, track.id, [ev], { label: isPb ? 'Pitch Bend を入力' : t('CC{n} を入力', { n: lane }) });
      if (r) store.run(r.command, { select: r.ids });
    } else {
      const ids = pointsInBox(d.x0, d.y0, d.x1, d.y1);
      store.selectEvents(d.additive ? [...selection.eventIds, ...ids] : ids);
    }
  }

  function onContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    if (lane === 'velocity') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = pointAt(e.clientX - rect.left, e.clientY - rect.top);
    const selectedIds = selectedPoints.map((p) => p.id);
    const what = isPb ? 'Pitch Bend' : `CC${lane}`;
    ctxMenu.open(e, [
      ...(hit ? [{ label: t('このポイントを削除'), action: () => deletePoints([hit.id]) }] : []),
      { label: t('選択したポイントを削除（{n}）', { n: selectedIds.length }), shortcut: 'Delete', disabled: selectedIds.length === 0, reason: t('ポイントをクリックまたはドラッグで選択してください'), action: () => deletePoints(selectedIds) },
      { separator: true, label: '' },
      { label: t('このレーンの {what} をすべて選択（{n}）', { what, n: laneEvents.length }), disabled: laneEvents.length === 0, reason: t('ポイントがありません'), action: () => store.selectEvents(laneEvents.map((p) => p.id)) },
    ]);
  }

  return (
    <>
    {!collapsed && <Splitter label={t('コントローラーレーンの高さ')} height={LANE_H} min={40} max={320} onResize={(h) => store.updateSettings({ laneHeight: h })} onToggle={() => store.updateSettings({ laneCollapsed: true })} />}
    <div className={`controller-lane${collapsed ? ' collapsed' : ''}`}>
      <div className="lane-label" style={{ width: offsetLeft }}>
      <button className="collapse-btn" onClick={() => store.updateSettings({ laneCollapsed: !collapsed })} aria-label={collapsed ? t('レーンを開く') : t('レーンを折り畳む')} title={collapsed ? t('レーンを開く') : t('レーンを折り畳む')}>
        {collapsed ? '▴' : '▾'}
      </button>
      <select
        className="lane-select"
        aria-label={t('コントローラーレーン')}
        value={String(lane)}
        onChange={(e) => {
          const v = e.target.value;
          store.updateSettings({ controllerLane: v === 'velocity' || v === 'pitch-bend' ? v : Number(v) });
        }}
      >
        <option value="velocity">Velocity</option>
        <option value="pitch-bend">Pitch Bend</option>
        {[1, 7, 10, 11, 64, 71, 74, 91, 93].map((c) => (
          <option key={c} value={c}>
            CC{c} {CC_NAMES[c] ?? ''}
          </option>
        ))}
      </select>
      {lane === 'velocity' && pitchFilter && !collapsed && (
        <button className="lane-filter" onClick={pitchFilter.onClear} title={t('すべてのパーツを表示')} aria-label={t('{name} だけを表示中。すべてのパーツを表示', { name: pitchFilter.name })}>
          {t('{name} だけ', { name: pitchFilter.name })} ×
        </button>
      )}
      </div>
      {!collapsed && <canvas
        ref={canvasRef}
        className="lane-canvas"
        aria-label={t('コントローラーレーン: {lane}', { lane: lane === 'velocity' ? 'Velocity' : isPb ? 'Pitch Bend' : `CC${lane}` })}
        title={lane === 'velocity' ? t('ドラッグでベロシティを描く。同じ位置に重なったノートは、棒の先の丸をつかむとその 1 音だけ変わる') : t('クリックでポイントを追加、ポイントをクリックで選択（Shift で追加）、空いているところをドラッグで範囲選択、選択したポイントをドラッグで値を変更、Delete / Alt+クリックで削除')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onLostPointerCapture={(e) => e.buttons !== 0 && setDrag(null)} // only while the button is down (ADR-087)
        onContextMenu={onContextMenu}
      />}
      {ctxMenu.element}
    </div>
    </>
  );
}
