// Cubase-style drum editor (REQ-EDT-06/07/08, UI_DESIGN 5): instrument-name lanes + diamonds.
// It edits the same track events as the piano roll. Lanes come from the track's drum map, which
// only labels pitches (changing the map never changes Note.pitch).
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { looseNoteIds } from '../../core/model/looseNotes';
import { addEvents, deleteEvents, duplicateEvents, moveEvents, updateEvents, updateTrack } from '../../core/editing/operations';
import { customizeDrumMap, hideLane, moveLane, renameLane, showAllLanes } from '../../core/editing/drumMapOps';
import { BUILT_IN_DRUM_MAPS, drumLanes, findDrumMap, type DrumMapEntry } from '../../core/gm/drumMaps';
import { gridTicks, snapTick } from '../../core/timing/grid';
import type { MidiTrack, NoteEvent } from '../../core/model/types';
import { maxOf } from '../../core/model/numbers';
import { useEditActions, useEditorState, useServices } from '../../app/store/context';
import { isSecondaryClick, useContextMenu } from '../menu/ContextMenu';
import { emptyMenuItems, noteMenuItems } from '../menu/editMenus';
import { conductorMarks, drawLoopRuler, drawPlayhead, drawRulerConductorMarks, drawStepCursor, fitCanvas, readTheme } from '../canvas';
import { ControllerLane } from '../piano-roll/ControllerLane';
import { DrumPads } from './DrumPads';
import { drumColor } from '../drumColors';
import { useAnimationLoop, useDragState, useElementSize, usePlayheadFollow, useSignatureMap, useZoomAnchor } from '../hooks';
import { useThemeVersion } from '../../app/theme';
import { draggedLoop, hitLoop, loopCursor, loopSnap, type LoopDrag } from '../loopDrag';
import { selectedTrack } from '../../core/model/selectedTrack';

const LANE_H = 20;
const NAMES_W = 180;
const RULER_H = 20;
const HIT_PX = 6;

type Drag = { kind: 'move'; anchor: NoteEvent; startX: number; startY: number; dTick: number; dLane: number; duplicate: boolean } | { kind: 'box'; x0: number; y0: number; x1: number; y1: number } | LoopDrag;
/** numbers the undo-merge keys of a duplicate drag (the copy and its lane change are one step) */
let dragCounter = 0;

export function DrumEditor() {
  const { store, transport, audioReady, step, input, recorder, reportError } = useServices();
  const editActions = useEditActions();
  const ctxMenu = useContextMenu();
  const { project, selection, tool } = useEditorState();
  const settings = project.settings;
  const track: MidiTrack | undefined = selectedTrack(project);
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = usePlayheadFollow();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const size = useElementSize(scrollRef, { w: 800, h: 300 });
  const [drag, dragRef, setDrag] = useDragState<Drag>();
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);

  const map = findDrumMap(track?.drumMapId, project.drumMaps);
  const notes = useMemo(() => (track ? track.events.filter((e): e is NoteEvent => e.kind === 'note') : []), [track]);
  const loose = useMemo(() => (track ? looseNoteIds(project, track) : new Set<string>()), [project, track]); // silent notes outside every clip (ADR-064)
  const lanes = useMemo(() => drumLanes(map, notes.map((n) => n.pitch), { onlyUsed }), [map, notes, onlyUsed]);
  const laneOf = useMemo(() => new Map(lanes.map((l, i) => [l.pitch, i])), [lanes]);
  const ppq = project.ppq;
  const pxPerTick = settings.pianoRollZoom / ppq;
  const grid = useMemo(() => gridTicks(ppq, settings.grid), [ppq, settings.grid]);
  const gridLen = grid.num / grid.den;
  const sig = useSignatureMap(project);
  const themeVersion = useThemeVersion();
  /** one bar of margin before bar 1 (ADR-045 追記) */
  const leadPx = Math.round(sig.ticksPerBar(0) * pxPerTick);
  const view = useMemo(() => ({ ...size, ...scroll, x: scroll.x - leadPx }), [size, scroll, leadPx]);
  useZoomAnchor(scrollRef, pxPerTick, leadPx, size.w - NAMES_W);
  const end = useMemo(() => maxOf(notes, (n) => n.tick + n.durationTicks, ppq * 4 * 32) + ppq * 16, [notes, ppq]);
  const gridW = view.w - NAMES_W;
  const totalH = RULER_H + lanes.length * LANE_H;
  const snap = (tk: number) => (settings.snapEnabled ? snapTick(tk, grid, 'floor').tick : Math.round(tk));


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !track) return;
    const h = Math.min(view.h, totalH);
    const ctx = fitCanvas(canvas, gridW, h);
    if (!ctx) return;
    const th = readTheme(canvas);
    ctx.fillStyle = th.panel;
    ctx.fillRect(0, 0, gridW, h);
    if (view.x < 0) {
      ctx.fillStyle = th.blackKey;
      ctx.fillRect(0, 0, -view.x, h);
    }
    const t0 = view.x / pxPerTick;
    const t1 = (view.x + gridW) / pxPerTick;
    lanes.forEach((_, i) => {
      const y = RULER_H + i * LANE_H - view.y;
      if (i % 2 === 1) {
        ctx.fillStyle = th.blackKey;
        ctx.fillRect(0, y, gridW, LANE_H);
      }
    });
    if (gridLen * pxPerTick >= 4) {
      for (let i = Math.max(0, Math.floor(t0 / gridLen)); i * gridLen <= t1; i++) {
        const x = Math.round(i * gridLen * pxPerTick - view.x) + 0.5;
        ctx.strokeStyle = th.grid;
        ctx.beginPath();
        ctx.moveTo(x, RULER_H);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const barLabelEnd = new Map<number, number>();
    let bar = sig.tickToBarBeat(Math.max(0, t0)).bar;
    for (let guard = 0; guard < 2000; guard++, bar++) {
      const tick = sig.barBeatToTick(bar);
      if (tick > t1) break;
      const x = Math.round(tick * pxPerTick - view.x) + 0.5;
      // beat lines (between grid lines and bar lines in weight)
      ctx.strokeStyle = th.gridBeat;
      for (let b = 2; b <= sig.signatureAt(tick).numerator; b++) {
        const bx = Math.round(sig.barBeatToTick(bar, b) * pxPerTick - view.x) + 0.5;
        ctx.beginPath();
        ctx.moveTo(bx, RULER_H);
        ctx.lineTo(bx, h);
        ctx.stroke();
      }
      ctx.strokeStyle = th.gridStrong;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = th.muted;
      ctx.fillText(String(bar), x + 3, RULER_H / 2);
      barLabelEnd.set(Math.round(tick), x + 3 + ctx.measureText(String(bar)).width);
    }
    ctx.fillStyle = th.border;
    ctx.fillRect(0, RULER_H - 1, gridW, 1);
    drawLoopRuler(ctx, drag?.kind === 'loop' ? drag.preview : project.loop, pxPerTick, view.x, RULER_H, th);
    drawRulerConductorMarks(ctx, conductorMarks(project.conductor), pxPerTick, view.x, gridW, RULER_H, th, (tk) => barLabelEnd.get(tk) ?? -Infinity);
    ctx.font = '11px system-ui, sans-serif';
    for (const n of notes) {
      const sel = selection.eventIds.has(n.id);
      let lane = laneOf.get(n.pitch);
      let tick = n.tick;
      if (drag?.kind === 'move' && sel) {
        tick += drag.dTick;
        lane = lane === undefined ? undefined : Math.max(0, Math.min(lanes.length - 1, lane + drag.dLane));
      }
      if (lane === undefined || tick < t0 - gridLen || tick > t1) continue;
      const x = tick * pxPerTick - view.x;
      const y = RULER_H + lane * LANE_H - view.y + LANE_H / 2;
      const r = 5 + (n.velocity / 127) * 2;
      ctx.globalAlpha = loose.has(n.id) ? 0.35 : 1; // loose: drawn faint, not played
      ctx.fillStyle = drumColor(map, n.pitch);
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      // selection: thick outline (the fill keeps the instrument colour)
      ctx.strokeStyle = sel ? th.noteSelected : th.text;
      ctx.lineWidth = sel ? 3 : 0.6;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
      if (drag?.kind === 'move' && drag.duplicate && sel) {
        // Alt+drag: the original stays where it is, drawn faint
        const ox = n.tick * pxPerTick - view.x;
        const ol = laneOf.get(n.pitch);
        if (ol !== undefined) {
          const oy = RULER_H + ol * LANE_H - view.y + LANE_H / 2;
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = drumColor(map, n.pitch);
          ctx.beginPath();
          ctx.moveTo(ox, oy - r);
          ctx.lineTo(ox + r, oy);
          ctx.lineTo(ox, oy + r);
          ctx.lineTo(ox - r, oy);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
    if (drag?.kind === 'box') {
      ctx.fillStyle = th.selection;
      ctx.fillRect(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    }
  }, [track, notes, loose, lanes, laneOf, view, gridW, totalH, pxPerTick, gridLen, sig, selection.eventIds, drag, map, project.loop, project.conductor, themeVersion]);

  useAnimationLoop(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = fitCanvas(canvas, gridW, Math.min(view.h, totalH));
    if (!ctx) return;
    ctx.clearRect(0, 0, gridW, view.h);
    const pos = transport.getPosition();
    const x = Math.round(pos.tick * pxPerTick - view.x) + 0.5;
    drawPlayhead(ctx, canvas, x, view.h);
    const live = recorder.livePreview().get(track?.id ?? '');
    if (live) {
      ctx.fillStyle = 'rgba(229,72,77,0.9)';
      for (const n of live) {
        const li = laneOf.get(n.pitch);
        if (li === undefined) continue;
        const nx = n.tick * pxPerTick - view.x;
        const ny = RULER_H + li * LANE_H - view.y + LANE_H / 2;
        ctx.beginPath();
        ctx.moveTo(nx, ny - 6);
        ctx.lineTo(nx + 6, ny);
        ctx.lineTo(nx, ny + 6);
        ctx.lineTo(nx - 6, ny);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (input.mode === 'step-piano' || input.mode === 'step-drums') drawStepCursor(ctx, Math.round(step.cursor * pxPerTick - view.x) + 0.5, view.h);
    follow(pos, x, gridW, scrollRef.current, sig, pxPerTick, settings.followPlayback);
  }, [transport, view, gridW, totalH, pxPerTick, settings.followPlayback, step, input, recorder, track?.id, laneOf, sig, follow]);

  if (!track) return <p className="placeholder">{t('トラックがありません。')}</p>;

  const toTick = (x: number) => Math.max(0, (x + view.x) / pxPerTick);
  const toLane = (y: number) => Math.floor((y - RULER_H + view.y) / LANE_H);

  function hit(x: number, y: number): NoteEvent | null {
    const lane = lanes[toLane(y)];
    if (!lane) return null;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.pitch === lane.pitch && Math.abs(n.tick * pxPerTick - view.x - x) <= HIT_PX) return n;
    }
    return null;
  }

  const preview = (pitch: number, velocity = 100) => {
    if (!audioReady || !track) return;
    transport.auditionNote(track.id, pitch, velocity, 'drum-editor');
    setTimeout(() => transport.releaseAuditionNote(track.id, pitch, 'drum-editor'), 150);
  };

  function onContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!track) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const tick = snap(toTick(x));
    if (y < RULER_H) return ctxMenu.open(e, [{ label: t('再生位置をここに移動'), action: () => transport.seek(tick) }]);
    const n = hit(x, y);
    if (n) {
      // right-click on an unselected note selects just that note
      if (!store.getState().selection.eventIds.has(n.id)) store.selectEvents([n.id]);
      ctxMenu.open(e, noteMenuItems(editActions, { transpose: false, noteLength: false }));
    } else ctxMenu.open(e, emptyMenuItems(editActions, store, transport, track.id, tick, reportError));
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!track || isSecondaryClick(e)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    if (y < RULER_H) {
      const lh = hitLoop(x, y, project.loop, pxPerTick, view.x, RULER_H);
      if (lh) setDrag({ kind: 'loop', hit: lh, startX: x, origin: project.loop, preview: project.loop });
      else transport.seek(snap(toTick(x)));
      return;
    }
    const n = hit(x, y);
    if (tool === 'draw') {
      if (n) {
        store.run(deleteEvents(store.project, [n.id], 'ドラムノートを削除'));
        return;
      }
      const lane: DrumMapEntry | undefined = lanes[toLane(y)];
      if (!lane) return;
      const tick = settings.snapEnabled ? snapTick(toTick(x) + gridLen / 2, grid, 'floor').tick : Math.round(toTick(x));
      const r = addEvents(store.project, track.id, [{ kind: 'note', tick, pitch: lane.pitch, velocity: lane.defaultVelocity, durationTicks: Math.max(1, Math.round(gridLen)), releaseVelocity: 64 }], { label: 'ドラムノートを入力' });
      if (r) store.run(r.command, { select: r.ids });
      preview(lane.pitch, lane.defaultVelocity);
      return;
    }
    if (n) {
      let sel = new Set(selection.eventIds);
      if (e.shiftKey) {
        if (sel.has(n.id)) sel.delete(n.id);
        else sel.add(n.id);
      } else if (!sel.has(n.id)) sel = new Set([n.id]);
      store.selectEvents(sel);
      setDrag({ kind: 'move', anchor: n, startX: x, startY: y, dTick: 0, dLane: 0, duplicate: e.altKey }); // Alt: duplicate instead of move
      preview(n.pitch, n.velocity);
      return;
    }
    if (!e.shiftKey) store.selectEvents([]);
    setDrag({ kind: 'box', x0: x, y0: y, x1: x, y1: y });
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!drag) {
      e.currentTarget.style.cursor = y < RULER_H ? loopCursor(hitLoop(x, y, project.loop, pxPerTick, view.x, RULER_H)) || 'default' : tool === 'draw' ? 'crosshair' : 'default';
      return;
    }
    if (drag.kind === 'loop') {
      setDrag({ ...drag, preview: draggedLoop(drag.origin, drag.hit, (x - drag.startX) / pxPerTick, loopSnap(sig, e.shiftKey), sig.ticksPerBeat(0)) });
      return;
    }
    if (drag.kind === 'move') {
      const raw = drag.anchor.tick + (x - drag.startX) / pxPerTick;
      const dTick = (settings.snapEnabled ? snapTick(raw + gridLen / 2, grid, 'floor').tick : Math.round(raw)) - drag.anchor.tick;
      setDrag({ ...drag, dTick, dLane: Math.round((y - drag.startY) / LANE_H), duplicate: drag.duplicate || e.altKey });
    } else setDrag({ ...drag, x1: x, y1: y });
  }

  function onPointerUp() {
    const d = dragRef.current;
    setDrag(null);
    if (!d || !track) return;
    if (d.kind === 'loop') {
      if (d.preview.startTick !== d.origin.startTick || d.preview.endTick !== d.origin.endTick) store.setLoop(d.preview);
      return;
    }
    if (d.kind === 'move' && (d.dTick !== 0 || d.dLane !== 0)) {
      const ids = [...selection.eventIds].filter((id) => notes.some((n) => n.id === id));
      // the lane's pitch after the drag (moving between lanes sets the target lane's pitch explicitly)
      const pitchAfter = (n: NoteEvent) => {
        const li = laneOf.get(n.pitch);
        const target = li === undefined ? undefined : lanes[Math.max(0, Math.min(lanes.length - 1, li + d.dLane))];
        return target?.pitch ?? n.pitch;
      };
      if (d.duplicate) {
        // Alt+drag: copies at the new place, the originals stay (one undo step with the lane change)
        const r = duplicateEvents(store.project, ids, d.dTick, '複製');
        if (!r) return;
        const key = `dup-${++dragCounter}`;
        store.run(r.command, { select: r.ids, mergeKey: key });
        if (d.dLane !== 0) {
          const copies = r.ids.map((id, i) => ({ id, changes: { pitch: pitchAfter(notes.find((n) => n.id === ids[i])!) } }));
          store.run(updateEvents(store.project, copies, '複製'), { mergeKey: key });
        }
        return;
      }
      if (d.dLane === 0) {
        store.run(moveEvents(store.project, ids, d.dTick));
        return;
      }
      const updates = ids.map((id) => notes.find((n) => n.id === id)!).map((n) => ({ id: n.id, changes: { tick: Math.max(0, n.tick + d.dTick), pitch: pitchAfter(n) } }));
      store.run(updateEvents(store.project, updates, 'ドラムノートを移動'));
    } else if (d.kind === 'box') {
      const ta = toTick(Math.min(d.x0, d.x1));
      const tb = toTick(Math.max(d.x0, d.x1));
      const la = toLane(Math.min(d.y0, d.y1));
      const lb = toLane(Math.max(d.y0, d.y1));
      const pitches = new Set(lanes.slice(Math.max(0, la), lb + 1).map((l) => l.pitch));
      store.selectEvents(notes.filter((n) => n.tick >= ta && n.tick <= tb && pitches.has(n.pitch)).map((n) => n.id));
    }
  }

  const editMap = (label: string, fn: Parameters<typeof customizeDrumMap>[3]) => store.run(customizeDrumMap(store.project, track.id, label, fn));

  return (
    <div className="drum-editor">
      <div className="drum-toolbar">
        <label className="note">
          {t('ドラムマップ')}{' '}
          <select
            aria-label={t('ドラムマップ')}
            value={map.id}
            onChange={(e) => store.run(updateTrack(store.project, track.id, { drumMapId: e.target.value }, 'ドラムマップを変更'))}
          >
            {[...BUILT_IN_DRUM_MAPS, ...(project.drumMaps ?? [])].map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="note">
          <input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} /> {t('使用中のレーンのみ')}
        </label>
        <button onClick={() => editMap('レーンをすべて表示', showAllLanes)} disabled={!map.hidden?.length}>
          {t('非表示レーンを戻す')}
        </button>
        <span className="note" title={t('ドラムマップは表示名・並び順だけを変えます。ノート番号は変わりません。レーン名のクリックで試聴、ダブルクリックで名前の変更。')}>{t('ⓘ マップは表示名のみ')}</span>
        {track.displayMode !== 'drum' && <span className="warn-text" title={t('Track メニューの「ドラムトラックにする」で切り替えられます')}>{t('メロディ表示のトラックです')}</span>}
      </div>
      <div className="drum-main">
        <div className="drum-scroll" ref={scrollRef} onScroll={(e) => {
          const { scrollLeft, scrollTop } = e.currentTarget;
          setScroll({ x: scrollLeft, y: scrollTop });
        }}>
          <div style={{ width: end * pxPerTick + leadPx + NAMES_W, height: totalH }}>
            <div className="sticky-canvas" style={{ width: view.w, height: Math.min(view.h, totalH) }}>
              <div className="drum-names" style={{ width: NAMES_W, height: Math.min(view.h, totalH) }}>
                <div style={{ height: RULER_H }} />
                <div style={{ transform: `translateY(${-view.y}px)` }}>
                  {lanes.map((l) => (
                    <div key={l.pitch} className="drum-lane-name" style={{ height: LANE_H }} data-testid="drum-lane">
                      {renaming === l.pitch ? (
                        <input
                          autoFocus
                          defaultValue={l.name}
                          aria-label={t('レーン名')}
                          onBlur={(e) => {
                            setRenaming(null);
                            if (e.target.value && e.target.value !== l.name) editMap('レーン名を変更', (m) => renameLane(m, l.pitch, e.target.value));
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        />
                      ) : (
                        <button className="lane-name" title={t('クリックで試聴、ダブルクリックで名前を変更')} onClick={() => preview(l.pitch, l.defaultVelocity)} onDoubleClick={() => setRenaming(l.pitch)}>
                          <span className="lane-swatch" style={{ background: drumColor(map, l.pitch) }} />
                          <span className="pitch">{l.pitch}</span> {l.name}
                        </button>
                      )}
                      <span className="lane-tools">
                        <button aria-label={t('{name} を上へ', { name: l.name })} onClick={() => editMap('レーンを並べ替え', (m) => moveLane(m, l.pitch, -1))}>▲</button>
                        <button aria-label={t('{name} を下へ', { name: l.name })} onClick={() => editMap('レーンを並べ替え', (m) => moveLane(m, l.pitch, 1))}>▼</button>
                        <button aria-label={t('{name} を隠す', { name: l.name })} onClick={() => editMap('レーンを隠す', (m) => hideLane(m, l.pitch))}>×</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <canvas
                ref={canvasRef}
                className="drum-canvas"
                style={{ left: NAMES_W }}
                tabIndex={0}
                data-testid="drum-grid"
                aria-label={t('ドラムエディター: {name}。{tool}', { name: track.name, tool: tool === 'draw' ? t('描画ツール（クリックで入力・削除）') : t('選択ツール') })}
                onPointerDown={onPointerDown}
                onContextMenu={onContextMenu}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    e.stopPropagation();
                    store.run(deleteEvents(store.project, selection.eventIds));
                  }
                }}
              />
              <canvas ref={overlayRef} className="overlay-canvas" style={{ left: NAMES_W }} aria-hidden="true" />
            </div>
          </div>
        </div>
        <DrumPads map={map} />
      </div>
      <ControllerLane track={track} viewX={view.x} width={gridW} offsetLeft={NAMES_W} pxPerTick={pxPerTick} snap={snap} noteColor={(p) => drumColor(map, p)} />
      {ctxMenu.element}
    </div>
  );
}
