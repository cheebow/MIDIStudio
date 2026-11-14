// Track view (REQ-EDT-01/02, UI_DESIGN 3): track headers + a canvas with ruler, clips, loop range
// and playhead. Only the visible range is drawn; the playhead lives on its own overlay canvas
// redrawn per animation frame (the song is not redrawn every frame).
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { arrangementZoomPatch } from '../zoom';
import { draggedLoop, hitLoop, loopCursor, loopSnap, type LoopDrag } from '../loopDrag';
import { adoptFreeEvents, clampedTrackOffset, createClip, deleteClip, duplicateClip, freeEventsInClip, mergeClips, moveClips, reorderTracks, resizeClip, splitClip, updateClip, updateTrack } from '../../core/editing/operations';
import { duplicateClips, pasteClips, pasteEvents, tracksRelativeTo } from '../../core/editing/clipboard';
import { MOD_LABEL as MOD } from '../platform';
import { isSecondaryClick, useContextMenu } from '../menu/ContextMenu';
import { Dialog } from '../Dialog';
import { deleteConductorEvent } from '../../core/editing/conductorOps';
import { ConductorEventDialog, conductorValueText, KIND_NAMES, type ConductorDialogTarget, type ConductorKind } from '../tempo/conductorUi';
import type { MenuItem } from '../menu/MenuBar';
import type { MidiClip, MidiProject, MidiTrack } from '../../core/model/types';
import { snapTick, gridTicks } from '../../core/timing/grid';
import { noteMenu } from '../menu/editMenus';
import { useEditActions, useEditorState, useServices } from '../../app/store/context';
import { conductorMarks, drawLoopRuler, drawMarkerLane, drawMarkerLines, drawPlayhead, drawRulerConductorMarks, drawTempoLane, fitCanvas, readTheme } from '../canvas';
import { useAnimationLoop, useDragState, useElementSize, usePlayheadFollow, useSignatureMap, useZoomAnchor } from '../hooks';
import { useThemeVersion } from '../../app/theme';
import { GlueIcon, PencilIcon, ScissorsIcon, SelectIcon } from '../icons';
import { selectedTrack } from '../../core/model/selectedTrack';
import { autoScrollStep, edgeScrollSpeed, pointerOf, useDragAutoScroll, type PointerLike } from '../dragAutoScroll';

const RULER_H = 24;
/** tempo lane under the bar ruler */
const COND_H = 26;
/** marker lane between the ruler and the tempo lane (only when the song has markers) */
const MARKER_H = 18;
const TRACK_H = 48;

function songEnd(p: MidiProject): number {
  let end = p.ppq * 4 * 16;
  for (const tk of p.tracks) {
    end = Math.max(end, tk.endOfTrackTick ?? 0);
    for (const e of tk.events) end = Math.max(end, e.kind === 'note' ? e.tick + e.durationTicks : e.tick);
  }
  for (const c of p.clips) end = Math.max(end, c.endTick);
  return end + p.ppq * 4 * 8;
}

/** half width in px of the grab zone at a clip edge */
const EDGE_PX = 4;

// Pointer positions kept in a drag (startX / startY of a clip move and of a loop drag) are content
// px: x from tick 0, y from the top of the canvas plus the vertical scroll, so a drag survives the
// view scrolling under it (ADR-071). The other drags keep ticks and track rows.
type Drag =
  /** moving the selected clips; `clip` is the one under the pointer, `ids` every clip that moves (ADR-057) */
  | { kind: 'clip'; clip: MidiClip; ids: string[]; startX: number; dx: number; duplicate: boolean; trackOffset: number; startY: number }
  /** Shift+drag on empty space: a rubber band over ticks × track rows selecting clips (ADR-057) */
  | { kind: 'marquee'; tick0: number; row0: number; tick1: number; row1: number; add: boolean }
  /** dragging a clip edge: the new tick of that edge (ADR-040) */
  | { kind: 'resize'; clip: MidiClip; edge: 'start' | 'end'; tick: number }
  | { kind: 'create'; trackId: string; startTick: number; endTick: number }
  | { kind: 'seek' }
  | LoopDrag;

/** track-header drag: the track being moved and the insertion index under the pointer (0..n) */
interface HeaderDrag {
  trackId: string;
  from: number;
  to: number;
}

export function Arrangement() {
  const { store, transport, recorder, reportError } = useServices();
  const actions = useEditActions();
  const { project, selection, tool } = useEditorState();
  const settings = project.settings;
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = usePlayheadFollow();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [scrollLeft, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const { w: viewW, h: viewH } = useElementSize(scrollRef);
  const [drag, dragRef, setDrag] = useDragState<Drag>();
  /** last pointer of the active drag, re-applied when the view scrolls under it (ADR-071) */
  const lastPointer = useRef<PointerLike | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [headerDrag, setHeaderDragState] = useState<HeaderDrag | null>(null);
  const headerDragRef = useRef<HeaderDrag | null>(null);
  const headersClipRef = useRef<HTMLDivElement>(null);
  const setHeaderDrag = (d: HeaderDrag | null) => {
    headerDragRef.current = d;
    setHeaderDragState(d);
  };
  /** last pointer y of a header drag (client coordinates), for the auto-scroll loop */
  const headerDragY = useRef(0);
  const headerDragActive = headerDrag !== null;

  /** insertion index under clientY, read from the live scroll position (not the render-time state) */
  const updateDropIndex = (clientY: number) => {
    const d = headerDragRef.current;
    const el = headersClipRef.current;
    const sc = scrollRef.current;
    if (!d || !el || !sc) return;
    const n = store.project.tracks.length;
    const to = Math.max(0, Math.min(n, Math.round((clientY - el.getBoundingClientRect().top + sc.scrollTop) / TRACK_H)));
    if (to !== d.to) setHeaderDrag({ ...d, to });
  };

  const finishHeaderDrag = () => {
    const d = headerDragRef.current;
    setHeaderDrag(null);
    if (!d) return;
    const ids = store.project.tracks.map((x) => x.id);
    const insertAt = d.to > d.from ? d.to - 1 : d.to;
    if (insertAt === d.from || d.from >= ids.length) return;
    ids.splice(insertAt, 0, ...ids.splice(d.from, 1));
    store.run(reorderTracks(store.project, ids));
  };

  // While a header drag is active: auto-scroll near the top / bottom edge of the header list, and
  // make sure the drag always ends (pointerup anywhere, window blur, Escape cancels) so a header
  // can never stay in its faded "dragging" state.
  useEffect(() => {
    if (!headerDragActive) return;
    const end = () => finishHeaderDrag();
    const cancel = () => setHeaderDrag(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', onKey, true);
    // same speed rule as the other drags (ADR-072): px per second, ramping up near and past the edge
    let raf = 0;
    let last = performance.now();
    const carry = { x: 0, y: 0 };
    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;
      const el = headersClipRef.current;
      const sc = scrollRef.current;
      if (el && sc) {
        const r = el.getBoundingClientRect();
        const y = headerDragY.current;
        const { dy } = autoScrollStep(carry, 0, edgeScrollSpeed(y, r.top, r.bottom), elapsed);
        if (dy) {
          const before = sc.scrollTop;
          sc.scrollTop += dy;
          if (sc.scrollTop !== before) updateDropIndex(y);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(raf);
    };
    // the handlers only read refs and the store, which do not change while a drag is active
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerDragActive]);
  const [clipEdit, setClipEdit] = useState<MidiClip | null>(null);
  const [conductorEdit, setConductorEdit] = useState<ConductorDialogTarget | null>(null);
  const ctxMenu = useContextMenu();

  const ppq = project.ppq;
  const pxPerTick = settings.horizontalZoom / ppq;
  const sig = useSignatureMap(project);
  const themeVersion = useThemeVersion();
  const end = useMemo(() => songEnd(project), [project]);
  const marks = useMemo(() => conductorMarks(project.conductor), [project.conductor]);
  const markerH = marks.some((m) => m.kind === 'marker') ? MARKER_H : 0;
  /** fixed area above the track lanes: ruler, marker lane (if any), tempo lane */
  const HEAD_H = RULER_H + markerH + COND_H;
  /** one bar of margin before bar 1 (ADR-045 追記): drawing uses scrollX = scrollLeft − lead, so tick 0 sits `leadPx` in */
  const leadPx = Math.round(sig.ticksPerBar(0) * pxPerTick);
  const scrollX = scrollLeft - leadPx;
  useZoomAnchor(scrollRef, pxPerTick, leadPx, viewW);
  const totalW = end * pxPerTick + leadPx;
  // the canvas fills the view even with few tracks, so a rubber band can start below the last track (ADR-057)
  const height = Math.max(HEAD_H + project.tracks.length * TRACK_H, viewH);
  const snapGrid = useMemo(() => (settings.snapEnabled ? gridTicks(ppq, { division: 4, kind: 'straight' }) : null), [ppq, settings.snapEnabled]);
  const selectedTrackId = selectedTrack(project)?.id;

  const tickAt = (x: number) => Math.max(0, (x + scrollX) / pxPerTick);
  // Edge auto-scroll while dragging (ADR-071). Not for a seek on the ruler: the playhead follow
  // pages the view on its own there. A loop drag scrolls sideways only.
  const trackPointer = useDragAutoScroll(scrollRef, canvasRef, drag !== null && drag.kind !== 'seek', { top: HEAD_H, vertical: drag?.kind !== 'loop' });
  /** content px (see Drag) from a client point, read from the live scroll position */
  const contentPoint = (clientX: number, clientY: number) => {
    const el = scrollRef.current;
    const r = canvasRef.current?.getBoundingClientRect();
    return { cx: clientX - (r?.left ?? 0) + (el?.scrollLeft ?? scrollLeft) - leadPx, cy: clientY - (r?.top ?? 0) + (el?.scrollTop ?? scrollY) };
  };
  const tickAtContent = (cx: number) => Math.max(0, cx / pxPerTick);
  const rowAtContent = (cy: number) => (cy - HEAD_H) / TRACK_H;
  const snap = (tk: number) => (snapGrid ? snapTick(tk, snapGrid).tick : Math.round(tk));

  // Static layer: ruler, lanes, clips. Redrawn when the project / view changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const h = Math.max(HEAD_H, Math.min(height, viewH));
    const ctx = fitCanvas(canvas, viewW, h);
    if (!ctx) return;
    const th = readTheme(canvas);
    ctx.fillStyle = th.panel;
    ctx.fillRect(0, 0, viewW, h);
    if (scrollX < 0) {
      // the margin before bar 1 is shaded like a black-key row: outside the song
      ctx.fillStyle = th.blackKey;
      ctx.fillRect(0, 0, -scrollX, h);
    }
    const t0 = scrollX / pxPerTick;
    const t1 = (scrollX + viewW) / pxPerTick;
    // loop range (the preview while its edges / band are dragged on the ruler)
    const loopView = drag?.kind === 'loop' ? drag.preview : project.loop;
    if (loopView.enabled) {
      ctx.fillStyle = th.loop;
      const lx = loopView.startTick * pxPerTick - scrollX;
      ctx.fillRect(lx, 0, (loopView.endTick - loopView.startTick) * pxPerTick, h);
    }
    // bar lines and ruler labels
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    let bar = sig.tickToBarBeat(Math.max(0, t0)).bar;
    for (let guard = 0; guard < 2000; guard++, bar++) {
      const tick = sig.barBeatToTick(bar);
      if (tick > t1) break;
      const x = Math.round(tick * pxPerTick - scrollX) + 0.5;
      ctx.strokeStyle = th.gridStrong;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    // lanes
    project.tracks.forEach((track, i) => {
      const y = HEAD_H + i * TRACK_H - scrollY;
      if (y + TRACK_H < HEAD_H || y > h) return;
      if (track.id === selectedTrackId) {
        ctx.fillStyle = th.selection;
        ctx.fillRect(0, y, viewW, TRACK_H);
      }
      ctx.strokeStyle = th.border;
      ctx.beginPath();
      ctx.moveTo(0, y + TRACK_H + 0.5);
      ctx.lineTo(viewW, y + TRACK_H + 0.5);
      ctx.stroke();
      drawTrackClips(ctx, project, track, y, t0, t1, pxPerTick, scrollX, selection.clipIds, th);
    });
    drawMarkerLines(ctx, marks, pxPerTick, scrollX, viewW, HEAD_H, h, th);
    // ruler + tempo lane on top (fixed while the lanes scroll vertically)
    ctx.fillStyle = th.panel;
    ctx.fillRect(0, 0, viewW, HEAD_H);
    if (scrollX < 0) {
      ctx.fillStyle = th.blackKey;
      ctx.fillRect(0, 0, -scrollX, HEAD_H);
    }
    drawLoopRuler(ctx, loopView, pxPerTick, scrollX, RULER_H, th);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const barLabelEnd = new Map<number, number>();
    let rbar = sig.tickToBarBeat(Math.max(0, t0)).bar;
    for (let guard = 0; guard < 2000; guard++, rbar++) {
      const tick = sig.barBeatToTick(rbar);
      if (tick > t1) break;
      const x = Math.round(tick * pxPerTick - scrollX) + 0.5;
      ctx.strokeStyle = th.gridStrong;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HEAD_H);
      ctx.stroke();
      ctx.fillStyle = th.muted;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(String(rbar), x + 3, RULER_H / 2);
      barLabelEnd.set(Math.round(tick), x + 3 + ctx.measureText(String(rbar)).width);
    }
    drawRulerConductorMarks(ctx, marks.filter((m) => m.kind === 'signature' || m.kind === 'key'), pxPerTick, scrollX, viewW, RULER_H, th, (tk) => barLabelEnd.get(tk) ?? -Infinity);
    ctx.strokeStyle = th.border;
    ctx.beginPath();
    ctx.moveTo(0, RULER_H + 0.5);
    ctx.lineTo(viewW, RULER_H + 0.5);
    ctx.stroke();
    if (markerH) {
      drawMarkerLane(ctx, marks, pxPerTick, scrollX, viewW, RULER_H, markerH, th);
      ctx.strokeStyle = th.border;
      ctx.beginPath();
      ctx.moveTo(0, RULER_H + markerH + 0.5);
      ctx.lineTo(viewW, RULER_H + markerH + 0.5);
      ctx.stroke();
    }
    drawTempoLane(ctx, marks, pxPerTick, scrollX, viewW, RULER_H + markerH, COND_H, th);
    ctx.strokeStyle = th.border;
    ctx.beginPath();
    ctx.moveTo(0, HEAD_H + 0.5);
    ctx.lineTo(viewW, HEAD_H + 0.5);
    ctx.stroke();
    // drag previews
    if (drag?.kind === 'create') {
      const i = project.tracks.findIndex((tk) => tk.id === drag.trackId);
      const a = Math.min(drag.startTick, drag.endTick);
      const b = Math.max(drag.startTick, drag.endTick);
      ctx.strokeStyle = th.accent;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a * pxPerTick - scrollX + 0.5, HEAD_H + i * TRACK_H - scrollY + 4.5, (b - a) * pxPerTick, TRACK_H - 9);
      ctx.setLineDash([]);
    }
    if (drag?.kind === 'clip' && (drag.dx !== 0 || drag.trackOffset !== 0)) {
      const ids = new Set(drag.ids);
      const last = project.tracks.length - 1;
      // a move keeps the group's shape (offset clamped for the group); a duplicate clamps each copy on its own
      const groupOffset = drag.duplicate ? drag.trackOffset : clampedTrackOffset(project, project.clips.filter((c) => ids.has(c.id)), drag.trackOffset);
      ctx.strokeStyle = th.accent;
      ctx.setLineDash([4, 3]);
      for (const c of project.clips) {
        if (!ids.has(c.id)) continue;
        const i = Math.max(0, Math.min(last, project.tracks.findIndex((tk) => tk.id === c.trackId) + groupOffset));
        ctx.strokeRect((c.startTick + drag.dx) * pxPerTick - scrollX + 0.5, HEAD_H + i * TRACK_H - scrollY + 3.5, (c.endTick - c.startTick) * pxPerTick, TRACK_H - 7);
      }
      ctx.setLineDash([]);
    }
    if (drag?.kind === 'marquee') {
      const x0 = Math.min(drag.tick0, drag.tick1) * pxPerTick - scrollX;
      const x1 = Math.max(drag.tick0, drag.tick1) * pxPerTick - scrollX;
      const y0 = HEAD_H + Math.min(drag.row0, drag.row1) * TRACK_H - scrollY;
      const y1 = HEAD_H + Math.max(drag.row0, drag.row1) * TRACK_H - scrollY;
      ctx.fillStyle = th.selection;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = th.accent;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
      ctx.setLineDash([]);
    }
    if (drag?.kind === 'resize') {
      const i = project.tracks.findIndex((tk) => tk.id === drag.clip.trackId);
      const a = drag.edge === 'start' ? drag.tick : drag.clip.startTick;
      const b = drag.edge === 'end' ? drag.tick : drag.clip.endTick;
      ctx.strokeStyle = th.accent;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a * pxPerTick - scrollX + 0.5, HEAD_H + i * TRACK_H - scrollY + 3.5, (b - a) * pxPerTick, TRACK_H - 7);
      ctx.setLineDash([]);
    }
  }, [project, viewW, viewH, height, scrollX, scrollY, pxPerTick, sig, selection.clipIds, selectedTrackId, drag, marks, markerH, HEAD_H, themeVersion]);

  // Playhead overlay: redrawn every animation frame, nothing else.
  useAnimationLoop(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const oh = Math.max(HEAD_H, Math.min(height, viewH));
    const ctx = fitCanvas(canvas, viewW, oh);
    if (!ctx) return;
    ctx.clearRect(0, 0, viewW, oh);
    const pos = transport.getPosition();
    const x = Math.round(pos.tick * pxPerTick - scrollX) + 0.5;
    drawPlayhead(ctx, canvas, x, oh);
    // notes being recorded, as mini notes in their lanes
    const live = recorder.livePreview();
    if (live.size) {
      ctx.fillStyle = 'rgba(229,72,77,0.9)';
      project.tracks.forEach((tk, i) => {
        const notes = live.get(tk.id);
        if (!notes) return;
        const y0 = HEAD_H + i * TRACK_H - scrollY;
        for (const n of notes) ctx.fillRect(n.tick * pxPerTick - scrollX, y0 + 6 + ((127 - n.pitch) / 127) * (TRACK_H - 12), Math.max(2, n.durationTicks * pxPerTick), 2);
      });
    }
    follow.update(pos, scrollRef.current, viewW, leadPx, sig, pxPerTick, settings.followPlayback);
  }, [transport, viewW, viewH, height, pxPerTick, scrollX, scrollY, settings.followPlayback, recorder, project.tracks, sig, HEAD_H, follow]);

  function hitClip(x: number, y: number): MidiClip | null {
    const i = Math.floor((y - HEAD_H + scrollY) / TRACK_H);
    const track = project.tracks[i];
    if (!track) return null;
    // unclamped: the margin before bar 1 is empty space, not tick 0 of a clip that starts there
    const tk = (x + scrollX) / pxPerTick;
    if (tk < 0) return null;
    // the last one is drawn on top: where clips overlap, the visible one is the one hit
    return project.clips.findLast((c) => c.trackId === track.id && tk >= c.startTick && tk < c.endTick) ?? null;
  }

  /** a clip edge within EDGE_PX of x in the lane at y (edges win over the clip body) */
  function hitClipEdge(x: number, y: number): { clip: MidiClip; edge: 'start' | 'end' } | null {
    const i = Math.floor((y - HEAD_H + scrollY) / TRACK_H);
    const track = project.tracks[i];
    if (!track) return null;
    let best: { clip: MidiClip; edge: 'start' | 'end' } | null = null;
    let bestD = EDGE_PX + 0.001;
    for (const c of project.clips) {
      if (c.trackId !== track.id) continue;
      const startPx = c.startTick * pxPerTick - scrollX;
      const endPx = c.endTick * pxPerTick - scrollX;
      // inside a narrow clip the edges take a third each, so its body can still be grabbed and moved
      const inner = Math.min(EDGE_PX, (endPx - startPx) / 3);
      const inside = x >= startPx && x <= endPx;
      // where two clips meet, the edge of the clip the pointer is in wins
      const ds = Math.abs(startPx - x) - (inside ? 0.01 : 0);
      const de = Math.abs(endPx - x) - (inside ? 0.01 : 0);
      if (ds < bestD && (!inside || ds <= inner)) {
        best = { clip: c, edge: 'start' };
        bestD = ds;
      }
      if (de < bestD && (!inside || de <= inner)) {
        best = { clip: c, edge: 'end' };
        bestD = de;
      }
    }
    return best;
  }

  /**
   * Scissors / glue on a clip (ADR-095): the scissors split it at the (snapped) position; the glue
   * joins it with the next clip of its track, or — when it is one of several selected clips — joins
   * the selection (per track, as ⌘J does). The notes are not changed by either.
   */
  function applyClipTool(which: 'scissors' | 'glue', clip: MidiClip, x: number) {
    try {
      if (which === 'scissors') {
        const inside = (tk: number) => tk > clip.startTick && tk < clip.endTick;
        const raw = Math.round(tickAt(x));
        const tk = inside(snap(tickAt(x))) ? snap(tickAt(x)) : raw;
        if (!inside(tk)) return;
        const before = new Set(project.clips.map((c) => c.id));
        store.run(splitClip(store.project, clip.id, tk));
        const made = store.project.clips.filter((c) => !before.has(c.id)).map((c) => c.id);
        store.setSelection({ ...store.getState().selection, eventIds: new Set(), clipIds: new Set([clip.id, ...made]) });
        return;
      }
      const group = selection.clipIds.size > 1 && selection.clipIds.has(clip.id);
      const next = project.clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id && c.startTick >= clip.startTick).sort((a, b) => a.startTick - b.startTick)[0];
      const ids = group ? [...selection.clipIds] : next ? [clip.id, next.id] : [];
      const cmd = ids.length ? mergeClips(store.project, ids) : null;
      if (!cmd) {
        reportError(group ? t('同じトラックのクリップを 2 つ以上選んでください。') : t('このクリップのあとに、同じトラックのクリップがありません。'));
        return;
      }
      store.run(cmd);
      const alive = new Set(store.project.clips.map((c) => c.id));
      store.setSelection({ ...store.getState().selection, eventIds: new Set(), clipIds: new Set(ids.filter((id) => alive.has(id))) });
    } catch (err) {
      reportError((err as Error).message);
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (isSecondaryClick(e)) return; // the context menu handles it
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { cx, cy } = contentPoint(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
    lastPointer.current = pointerOf(e);
    trackPointer(e.clientX, e.clientY, true);
    if (y < HEAD_H) {
      const hit = y < RULER_H ? hitLoop(x, y, project.loop, pxPerTick, scrollX, RULER_H) : null;
      if (hit) setDrag({ kind: 'loop', hit, startX: cx, origin: project.loop, preview: project.loop });
      else {
        transport.seek(snap(tickAt(x)));
        setDrag({ kind: 'seek' });
      }
      return;
    }
    const i = Math.floor((y - HEAD_H + scrollY) / TRACK_H);
    const track = project.tracks[i];
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!track) {
      // below the last track: a rubber band can still start here (selection tool)
      if (tool !== 'draw') {
        const tk = tickAt(x);
        const row = rowAt(y);
        setDrag({ kind: 'marquee', tick0: tk, row0: row, tick1: tk, row1: row, add });
      }
      return;
    }
    store.updateSettings({ selectedTrackId: track.id });
    if ((tool === 'scissors' || tool === 'glue') && e.button === 0) {
      const target = hitClip(x, y);
      if (target) {
        applyClipTool(tool, target, x);
        return;
      }
    }
    // Shift / Ctrl / ⌘ + click adds to the selection also near an edge (it used to start a resize there,
    // which replaced the selection with that one clip)
    const edge = tool === 'scissors' || tool === 'glue' || add ? null : hitClipEdge(x, y);
    if (edge) {
      store.setSelection({ ...selection, eventIds: new Set(), clipIds: new Set([edge.clip.id]), trackIds: new Set([track.id]) });
      setDrag({ kind: 'resize', clip: edge.clip, edge: edge.edge, tick: edge.edge === 'start' ? edge.clip.startTick : edge.clip.endTick });
      return;
    }
    const clip = hitClip(x, y);
    if (clip) {
      // Shift / Ctrl / ⌘ + click toggles the clip in the selection; a plain click on an already
      // selected clip keeps the group so the drag moves all of them. Selecting regions clears the
      // note selection so Delete / copy act on the regions.
      const ids = new Set(add || selection.clipIds.has(clip.id) ? selection.clipIds : []);
      if (add && ids.has(clip.id)) ids.delete(clip.id);
      else ids.add(clip.id);
      store.setSelection({ ...selection, eventIds: new Set(), clipIds: ids, trackIds: new Set([track.id]) });
      if (ids.has(clip.id)) setDrag({ kind: 'clip', clip, ids: [...ids], startX: cx, dx: 0, duplicate: e.altKey, trackOffset: 0, startY: cy });
    } else if (tool === 'draw') {
      // the draw tool (P) creates a clip; the selection tool (V) drags a rubber band over the clips
      store.setSelection({ ...selection, clipIds: new Set(), trackIds: new Set([track.id]) });
      const tk = snap(tickAt(x));
      setDrag({ kind: 'create', trackId: track.id, startTick: tk, endTick: tk });
    } else {
      if (!add) store.setSelection({ ...selection, clipIds: new Set(), trackIds: new Set([track.id]) });
      const tk = tickAt(x);
      const row = rowAt(y);
      setDrag({ kind: 'marquee', tick0: tk, row0: row, tick1: tk, row1: row, add });
    }
  }

  /** track row (fractional) at a canvas y */
  const rowAt = (y: number) => (y - HEAD_H + scrollY) / TRACK_H;

  /** clips whose range overlaps the tick span and whose track row lies in the row span */
  function clipsInBox(tickA: number, tickB: number, rowA: number, rowB: number): string[] {
    const [t0, t1] = tickA <= tickB ? [tickA, tickB] : [tickB, tickA];
    const [r0, r1] = rowA <= rowB ? [rowA, rowB] : [rowB, rowA];
    const rows = new Map(project.tracks.map((tk, i) => [tk.id, i]));
    return project.clips.filter((c) => c.startTick < t1 && c.endTick > t0 && (rows.get(c.trackId) ?? -1) + 1 > r0 && (rows.get(c.trackId) ?? -1) < r1).map((c) => c.id);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (drag) {
      lastPointer.current = pointerOf(e);
      trackPointer(e.clientX, e.clientY);
      applyDrag(lastPointer.current);
      return;
    }
    if ((tool === 'scissors' || tool === 'glue') && y >= HEAD_H) {
      e.currentTarget.style.cursor = hitClip(x, y) ? (tool === 'scissors' ? 'col-resize' : 'pointer') : 'default';
      return;
    }
    e.currentTarget.style.cursor = y < RULER_H ? loopCursor(hitLoop(x, y, project.loop, pxPerTick, scrollX, RULER_H)) || 'default' : y >= HEAD_H && hitClipEdge(x, y) ? 'ew-resize' : y >= HEAD_H && tool === 'draw' && !hitClip(x, y) ? 'crosshair' : 'default';
  }

  /** Updates the active drag for a pointer (also called when the view scrolls under a still pointer). */
  function applyDrag(p: PointerLike) {
    const drag = dragRef.current;
    if (!drag) return;
    const { cx, cy } = contentPoint(p.clientX, p.clientY);
    if (drag.kind === 'loop') setDrag({ ...drag, preview: draggedLoop(drag.origin, drag.hit, (cx - drag.startX) / pxPerTick, loopSnap(sig, p.shiftKey), sig.ticksPerBeat(0)) });
    else if (drag.kind === 'seek') transport.seek(snap(tickAtContent(cx)));
    else if (drag.kind === 'create') setDrag({ ...drag, endTick: snap(tickAtContent(cx)) });
    else if (drag.kind === 'marquee') setDrag({ ...drag, tick1: tickAtContent(cx), row1: rowAtContent(cy) });
    else if (drag.kind === 'resize') {
      const tk = snap(tickAtContent(cx));
      // the clip keeps at least one tick
      const tick = drag.edge === 'start' ? Math.max(0, Math.min(drag.clip.endTick - 1, tk)) : Math.max(drag.clip.startTick + 1, tk);
      setDrag({ ...drag, tick });
    } else {
      const raw = (cx - drag.startX) / pxPerTick;
      // limited by the earliest clip of the group, as moveClips does: the preview is what the drop
      // gives, and an Alt-copy never starts before bar 1 (ADR-087)
      const ids = new Set(drag.ids);
      const first = Math.min(drag.clip.startTick, ...project.clips.filter((c) => ids.has(c.id)).map((c) => c.startTick));
      const newStart = Math.max(drag.clip.startTick - first, snap(drag.clip.startTick + raw));
      const trackOffset = Math.round((cy - drag.startY) / TRACK_H); // up / down moves (or, with Alt, copies) to another track (ADR-062)
      setDrag({ ...drag, dx: newStart - drag.clip.startTick, duplicate: drag.duplicate || p.altKey, trackOffset });
    }
  }

  function onPointerUp() {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    try {
      if (d.kind === 'loop') {
        if (d.preview.startTick !== d.origin.startTick || d.preview.endTick !== d.origin.endTick) store.setLoop(d.preview);
      } else if (d.kind === 'create') {
        const a = Math.min(d.startTick, d.endTick);
        const b = Math.max(d.startTick, d.endTick);
        if (b - a >= 1) {
          const r = createClip(store.project, d.trackId, a, b);
          store.run(r.command);
          store.setSelection({ ...store.getState().selection, clipIds: new Set([r.clipId]) });
        }
      } else if (d.kind === 'resize') {
        store.run(resizeClip(store.project, d.clip.id, d.edge === 'start' ? { startTick: d.tick } : { endTick: d.tick }));
      } else if (d.kind === 'marquee') {
        const hit = clipsInBox(d.tick0, d.tick1, d.row0, d.row1);
        const sel = store.getState().selection;
        store.setSelection({ ...sel, eventIds: new Set(), clipIds: new Set(d.add ? [...sel.clipIds, ...hit] : hit) });
      } else if (d.kind === 'clip' && (d.dx !== 0 || d.trackOffset !== 0)) {
        if (d.duplicate) {
          const r = duplicateClips(store.project, d.ids, { deltaTick: d.dx, trackOffset: d.trackOffset });
          if (r) {
            store.run(r.command);
            store.setSelection({ ...store.getState().selection, clipIds: new Set(r.clipIds) });
          }
        } else store.run(moveClips(store.project, d.ids, d.dx, { trackOffset: d.trackOffset }));
      }
    } catch (err) {
      reportError((err as Error).message); // shown in the banner like the other editors (ADR-084)
    }
  }

  /** which header lane a y falls in */
  const headLane = (y: number): 'ruler' | 'marker' | 'tempo' | null => (y < RULER_H ? 'ruler' : y < RULER_H + markerH ? 'marker' : y < HEAD_H ? 'tempo' : null);

  /** tempo-track event of `kind` drawn near x (within a few px), the nearest one */
  function conductorNear(kind: ConductorKind, x: number) {
    let best: (typeof project.conductor)[number] | undefined;
    let bestD = 7;
    for (const c of project.conductor) {
      if (c.kind !== kind) continue;
      const d = Math.abs(c.tick * pxPerTick - scrollX - x);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  function conductorItems(kind: ConductorKind, x: number, tick: number, addTick = tick): MenuItem[] {
    const near = conductorNear(kind, x);
    const name = KIND_NAMES[kind];
    return [
      { label: t('ここに{name}を追加…', { name: t(name) }), action: () => setConductorEdit({ kind, tick: addTick }) },
      ...(near
        ? [
            { label: t('この{name}（{value}）を変更…', { name: t(name), value: conductorValueText(near) }), action: () => setConductorEdit({ kind, tick: near.tick, id: near.id }) },
            { label: t('この{name}を削除', { name: t(name) }), action: () => store.run(deleteConductorEvent(store.project, near.id)) },
          ]
        : []),
    ];
  }

  function onHeadContextMenu(e: React.MouseEvent<HTMLCanvasElement>, lane: 'ruler' | 'marker' | 'tempo', x: number) {
    const raw = Math.round(tickAt(x));
    const tick = snap(raw);
    const barStart = Math.round(sig.barBeatToTick(sig.tickToBarBeat(raw).bar));
    const sep: MenuItem = { separator: true, label: '' };
    const open: MenuItem = { label: t('コンダクタートラックを開く'), action: () => store.updateSettings({ activePanel: 'tempo', editorCollapsed: false }) };
    const seek: MenuItem = { label: t('再生位置をここに移動'), action: () => transport.seek(tick) };
    if (lane === 'tempo') return ctxMenu.open(e, [...conductorItems('tempo', x, tick), sep, seek, open]);
    if (lane === 'marker') return ctxMenu.open(e, [...conductorItems('marker', x, tick), sep, seek, open]);
    ctxMenu.open(e, [seek, sep, ...conductorItems('time-signature', x, barStart), ...conductorItems('key-signature', x, barStart), ...(markerH ? [] : conductorItems('marker', x, tick)), sep, open]);
  }

  function onHeadDoubleClick(lane: 'ruler' | 'marker' | 'tempo', x: number) {
    const kind: ConductorKind = lane === 'tempo' ? 'tempo' : lane === 'marker' ? 'marker' : 'time-signature';
    const near = conductorNear(kind, x);
    const raw = Math.round(tickAt(x));
    if (near) setConductorEdit({ kind, tick: near.tick, id: near.id });
    else setConductorEdit({ kind, tick: kind === 'time-signature' ? Math.round(sig.barBeatToTick(sig.tickToBarBeat(raw).bar)) : snap(raw) });
  }

  /** selects every clip (on any track) that contains the tick (ADR-057) */
  function selectClipsAt(tick: number, trackId: string) {
    const ids = project.clips.filter((c) => tick >= c.startTick && tick < c.endTick).map((c) => c.id);
    store.setSelection({ ...store.getState().selection, eventIds: new Set(), clipIds: new Set(ids), trackIds: new Set([trackId]) });
  }

  function onContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const lane = headLane(y);
    if (lane) return onHeadContextMenu(e, lane, x);
    const tick = snap(tickAt(x));
    const i = Math.floor((y - HEAD_H + scrollY) / TRACK_H);
    const track = y >= HEAD_H ? project.tracks[i] : undefined;
    const clip = hitClip(x, y);
    const run = (fn: () => void) => () => {
      try {
        fn();
      } catch (err) {
        reportError((err as Error).message);
      }
    };
    if (clip && track) {
      store.updateSettings({ selectedTrackId: track.id });
      // a right-click on one of several selected clips keeps the group: copy / duplicate / delete act on all of them
      const group = store.getState().selection.clipIds.has(clip.id) ? store.getState().selection.clipIds : new Set([clip.id]);
      store.setSelection({ ...store.getState().selection, eventIds: new Set(), clipIds: new Set(group), trackIds: new Set([track.id]) });
      if (group.size > 1) {
        const n = group.size;
        const tracksOf = project.clips.filter((c) => group.has(c.id)).map((c) => c.trackId);
        const mergeable = new Set(tracksOf).size < tracksOf.length; // some track has two of them
        ctxMenu.open(e, [
          { label: t('コピー（{n} 個のクリップ）', { n }), shortcut: `${MOD}C`, action: actions.copy },
          { label: t('切り取り'), shortcut: `${MOD}X`, action: run(actions.cut) },
          { label: t('複製'), shortcut: `${MOD}D`, action: run(actions.duplicate) },
          { label: t('結合（同じトラックのクリップを 1 つに）'), shortcut: `${MOD}J`, action: run(actions.mergeClips), disabled: !mergeable, reason: t('同じトラックのクリップを 2 つ以上選択してください') },
          { separator: true, label: '' },
          { label: t('削除（中のノートごと）'), shortcut: 'Delete', action: run(actions.delete) },
        ]);
        return;
      }
      // quantize acts on the selection: the clip's notes are selected for it, and only for it —
      // afterwards the clip alone is selected again, so Delete / copy act on the clip (ADR-098)
      const ids = new Set(clip.eventIds);
      const noteIds = track.events.filter((ev) => ev.kind === 'note' && ids.has(ev.id)).map((ev) => ev.id);
      const free = freeEventsInClip(store.project, clip.id).length;
      const withNotes = (fn: () => void) => () => actions.onClipNotes(noteIds, fn);
      ctxMenu.open(e, [
        { label: t('ピアノロールで開く'), action: () => store.updateSettings({ selectedTrackId: track.id, activePanel: track.displayMode === 'drum' ? 'drum' : 'piano-roll', editorCollapsed: false }) },
        { label: t('名前と色…'), action: () => setClipEdit(clip) },
        { separator: true, label: '' },
        { label: t('コピー'), shortcut: `${MOD}C`, action: actions.copy },
        { label: t('切り取り'), shortcut: `${MOD}X`, action: run(actions.cut) },
        { label: t('この位置のクリップを全トラックで選択'), action: () => selectClipsAt(tick, track.id) },
        { separator: true, label: '' },
        // ノート ▸ as in the 編集 menu (ADR-100), acting on the notes of this clip
        noteMenu(
          { ...actions, quantize: withNotes(actions.quantize), quantizeDialog: withNotes(actions.quantizeDialog), humanizeDialog: withNotes(actions.humanizeDialog), velocityDialog: withNotes(actions.velocityDialog) },
          { grid: settings.grid, noteLength: false, disabledReason: noteIds.length === 0 ? t('クリップにノートがありません') : undefined },
        ),
        { separator: true, label: '' },
        { label: `${t('範囲内の外れたノートを取り込む')}${free ? t('（{n} 個）', { n: free }) : ''}`, action: run(() => store.run(adoptFreeEvents(store.project, clip.id))), disabled: free === 0, reason: t('クリップの範囲内に、クリップに属していないイベントはありません') },
        { label: t('ここで分割'), action: run(() => store.run(splitClip(store.project, clip.id, tick))), disabled: tick <= clip.startTick || tick >= clip.endTick, reason: t('クリップの内側で右クリックしてください') },
        { label: t('複製'), shortcut: `${MOD}D`, action: run(() => store.run(duplicateClip(store.project, clip.id, clip.endTick).command)) },
        { separator: true, label: '' },
        { label: t('削除（中のノートごと）'), shortcut: 'Delete', action: run(() => store.run(deleteClip(store.project, clip.id, { deleteEvents: true }))) },
      ]);
      return;
    }
    const clipboard = store.getState().clipboard;
    ctxMenu.open(e, [
      { label: t('再生位置をここに移動'), action: () => transport.seek(tick) },
      ...(track
        ? [
            { label: t('ここに1小節のクリップを作成'), action: run(() => {
              const start = Math.round(sig.barBeatToTick(sig.tickToBarBeat(tick).bar));
              const r = createClip(store.project, track.id, start, start + Math.round(sig.ticksPerBar(start)));
              store.run(r.command);
              store.setSelection({ ...store.getState().selection, clipIds: new Set([r.clipId]) });
            }) },
            { label: t('ここに貼り付け'), disabled: !clipboard, reason: t('コピーしたノートやクリップがありません'), action: run(() => {
              if (!clipboard) return;
              if (clipboard.clips) {
                // the topmost copied clip lands on the clicked track, the others keep their relative lanes (ADR-062)
                const r = pasteClips(store.project, tick, clipboard, tracksRelativeTo(store.project, clipboard, track.id));
                if (r) {
                  store.run(r.command);
                  store.setSelection({ ...store.getState().selection, eventIds: new Set(), clipIds: new Set(r.clipIds) });
                }
                return;
              }
              const r = pasteEvents(store.project, track.id, tick, clipboard);
              if (r) store.run(r.command, { select: r.ids });
            }) },
            { label: t('この位置のクリップを全トラックで選択'), action: () => selectClipsAt(tick, track.id), disabled: !project.clips.some((c) => tick >= c.startTick && tick < c.endTick), reason: t('この位置にクリップがありません') },
          ]
        : []),
    ]);
  }

  return (
    <div className="arrangement">
      <div className="track-headers" onWheel={(e) => scrollRef.current && (scrollRef.current.scrollTop += e.deltaY)}>
        <div className="arr-corner" style={{ height: RULER_H }}>
          {/* same tool state as the piano roll / drum editor; shown here too so the draw mode is discoverable from the track view */}
          <span className="segmented arr-tools" role="group" aria-label={t('トラックビューのツール')}>
            <button aria-label={t('選択')} aria-pressed={tool === 'select'} className={`icon-btn${tool === 'select' ? ' on' : ''}`} onClick={() => store.setTool('select')} title={t('選択ツール (V): クリックで選択、ドラッグで移動、空いているところのドラッグで範囲選択')} data-testid="arr-tool-select">
              <SelectIcon />
            </button>
            <button aria-label={t('描画')} aria-pressed={tool === 'draw'} className={`icon-btn${tool === 'draw' ? ' on' : ''}`} onClick={() => store.setTool('draw')} title={t('描画ツール (P): 空いているところをドラッグでクリップ（リージョン）を作成')} data-testid="arr-tool-draw">
              <PencilIcon />
            </button>
            <button aria-label={t('ハサミ')} aria-pressed={tool === 'scissors'} className={`icon-btn${tool === 'scissors' ? ' on' : ''}`} onClick={() => store.setTool('scissors')} title={t('ハサミツール (C): クリップをクリックした位置で 2 つに分ける')} data-testid="arr-tool-scissors">
              <ScissorsIcon />
            </button>
            <button aria-label={t('ノリ')} aria-pressed={tool === 'glue'} className={`icon-btn${tool === 'glue' ? ' on' : ''}`} onClick={() => store.setTool('glue')} title={t('ノリツール (G): クリックしたクリップを、次のクリップとつなげる（複数選んでいれば、まとめて）')} data-testid="arr-tool-glue">
              <GlueIcon />
            </button>
          </span>
          <span className="segmented zoom-buttons" role="group" aria-label={t('トラックビューの拡大・縮小')}>
            <button onClick={() => store.updateSettings(arrangementZoomPatch(settings, 'out'))} aria-label={t('トラックビューを縮小')} title={t('横方向に縮小')}>
              −
            </button>
            <button onClick={() => store.updateSettings(arrangementZoomPatch(settings, 'in'))} aria-label={t('トラックビューを拡大')} title={t('横方向に拡大')}>
              +
            </button>
          </span>
        </div>
        {markerH > 0 && (
          <div className="tempo-lane-label marker-lane-label" style={{ height: markerH }} role="button" tabIndex={0} onClick={() => store.updateSettings({ activePanel: 'tempo', editorCollapsed: false })} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && store.updateSettings({ activePanel: 'tempo', editorCollapsed: false })} title={t('マーカー（SMF のマーカーイベント）。クリックで「コンダクター」タブを開きます。右クリック・ダブルクリックで追加・変更できます。')}>
            {t('マーカー')}
          </div>
        )}
        <div className="tempo-lane-label" style={{ height: COND_H }} role="button" tabIndex={0} data-testid="tempo-lane-label" onClick={() => store.updateSettings({ activePanel: 'tempo', editorCollapsed: false })} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && store.updateSettings({ activePanel: 'tempo', editorCollapsed: false })} title={t('テンポの変化（線の高さ）と、変わる位置の BPM。拍子と調号の変化は小節番号の横に表示します。クリックで「コンダクター」タブを開きます。右クリック・ダブルクリックで追加・変更できます。')}>
          {t('テンポ')}
        </div>
        <div className="track-headers-clip" ref={headersClipRef}>
        <div style={{ transform: `translateY(${-scrollY}px)` }}>
        {project.tracks.map((tk, i) => (
          <TrackHeader
            key={tk.id}
            track={tk}
            selected={tk.id === selectedTrackId}
            dragging={headerDrag?.trackId === tk.id}
            renaming={renaming === tk.id}
            onSelect={() => store.updateSettings({ selectedTrackId: tk.id })}
            onDragStart={(clientY) => {
              headerDragY.current = clientY;
              setHeaderDrag({ trackId: tk.id, from: i, to: i });
            }}
            onDragMove={(clientY) => {
              headerDragY.current = clientY;
              updateDropIndex(clientY);
            }}
            onDragEnd={finishHeaderDrag}
            onRename={(name) => {
              setRenaming(null);
              if (name !== null && name !== tk.name) store.run(updateTrack(store.project, tk.id, { name }, 'トラック名を変更'));
            }}
            onStartRename={() => setRenaming(tk.id)}
            onFlag={(flags) => store.setTrackFlags(tk.id, flags)}
          />
        ))}
        </div>
        {headerDrag && <div className="track-drop-line" style={{ top: headerDrag.to * TRACK_H - scrollY }} aria-hidden="true" />}
        </div>
      </div>
      <div className="arrangement-scroll" ref={scrollRef} onScroll={(e) => {
          setScrollX(e.currentTarget.scrollLeft);
          setScrollY(e.currentTarget.scrollTop);
          if (dragRef.current && lastPointer.current) applyDrag(lastPointer.current);
        }}>
        <div style={{ width: totalW, height }} className="arrangement-spacer">
          <div className="sticky-canvas" style={{ width: viewW, height: Math.max(HEAD_H, Math.min(height, viewH)) }}>
            <canvas
              ref={canvasRef}
              className="arrangement-canvas"
              aria-label={t('トラックビュー（クリップの配置）')}
              data-testid="arrangement-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              // capture lost while the button is still down (app switch): cancel the drag. Chrome also
              // sends it when the button is released, before pointerup: then pointerup finishes it (ADR-087)
              onLostPointerCapture={(e) => e.buttons !== 0 && setDrag(null)}
              onContextMenu={onContextMenu}
              onDoubleClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const lane = headLane(e.clientY - rect.top);
                if (lane) return onHeadDoubleClick(lane, e.clientX - rect.left);
                const clip = hitClip(e.clientX - rect.left, e.clientY - rect.top);
                const track = clip && project.tracks.find((tk) => tk.id === clip.trackId);
                if (!clip || !track) return;
                store.updateSettings({ selectedTrackId: track.id, activePanel: track.displayMode === 'drum' ? 'drum' : 'piano-roll', editorCollapsed: false });
                store.revealTick(track.id, clip.startTick); // the editor shows the clip's first bar (ADR-085)
              }}
            />
            <canvas ref={overlayRef} className="overlay-canvas" aria-hidden="true" />
          </div>
        </div>
      </div>
      {ctxMenu.element}
      {conductorEdit && <ConductorEventDialog target={conductorEdit} onClose={() => setConductorEdit(null)} />}
      {clipEdit && (
        <Dialog title={t('クリップの名前と色')} onClose={() => setClipEdit(null)}>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              // A clip without its own colour follows its track: the picker shows the track colour, and
              // only a different pick gives the clip a colour. OK without a change adds no undo step (ADR-087).
              const name = String(f.get('name') ?? '') || undefined;
              const picked = String(f.get('color'));
              const shown = (clipEdit.color ?? project.tracks.find((tk) => tk.id === clipEdit.trackId)?.color ?? '#4f8ef7').slice(0, 7);
              const color = clipEdit.color !== undefined || picked !== shown ? picked : undefined;
              if (name !== clipEdit.name || color !== clipEdit.color) store.run(updateClip(store.project, clipEdit.id, { name, ...(color !== undefined ? { color } : {}) }));
              setClipEdit(null);
            }}
          >
            <label>
              {t('名前')}
              <input name="name" defaultValue={clipEdit.name ?? ''} placeholder={project.tracks.find((tk) => tk.id === clipEdit.trackId)?.name} autoFocus />
            </label>
            <label>
              {t('色')}
              <input name="color" type="color" defaultValue={(clipEdit.color ?? project.tracks.find((tk) => tk.id === clipEdit.trackId)?.color ?? '#4f8ef7').slice(0, 7)} />
            </label>
            <div className="row">
              <button className="primary" type="submit">
                OK
              </button>
              <button type="button" onClick={() => setClipEdit(null)}>
                {t('キャンセル')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

/** rounded-rectangle path (own helper so every tested browser draws the same) */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** `#rrggbb` with an alpha (0..1); other colour formats are returned unchanged */
function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** relative luminance of `#rrggbb` (0..1); 0.5 when the format is unknown */
function luminance(color: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

const CLIP_PAD = 3;
const CLIP_HEAD = 13;
const CLIP_RADIUS = 4;

/**
 * Clips as DAW-style regions: a rounded block in the clip colour with a solid name strip on top,
 * the notes drawn inside in the same colour (drum tracks as dots), the selected ones with an
 * accent outline and a soft glow, a muted track faded. Events outside any clip stay visible.
 */
function drawTrackClips(ctx: CanvasRenderingContext2D, project: MidiProject, track: MidiTrack, y: number, t0: number, t1: number, pxPerTick: number, scrollX: number, selectedClips: ReadonlySet<string>, th: ReturnType<typeof readTheme>) {
  const clips = project.clips.filter((c) => c.trackId === track.id && c.endTick >= t0 && c.startTick <= t1);
  const clipOf = new Map<string, MidiClip>();
  for (const c of clips) for (const id of c.eventIds) clipOf.set(id, c);
  const faded = track.mute || (project.tracks.some((tk) => tk.solo) && !track.solo);
  const top = y + CLIP_PAD;
  const h = TRACK_H - CLIP_PAD * 2;
  const dark = luminance(th.panel) < 0.5;
  ctx.save();
  if (faded) ctx.globalAlpha = 0.45;
  for (const c of clips) {
    const x = c.startTick * pxPerTick - scrollX;
    const w = Math.max(3, (c.endTick - c.startTick) * pxPerTick);
    const color = c.color ?? track.color;
    const selected = selectedClips.has(c.id);
    // body
    roundRect(ctx, x, top, w, h, CLIP_RADIUS);
    ctx.fillStyle = withAlpha(color, selected ? (dark ? 0.34 : 0.26) : dark ? 0.22 : 0.16);
    ctx.fill();
    // name strip (clipped to the rounded top)
    ctx.save();
    roundRect(ctx, x, top, w, h, CLIP_RADIUS);
    ctx.clip();
    ctx.fillStyle = withAlpha(color, 0.92);
    ctx.fillRect(x, top, w, CLIP_HEAD);
    if (w > 18) {
      ctx.fillStyle = luminance(color) > 0.55 ? '#1d2330' : '#ffffff';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.name ?? track.name, x + 5, top + CLIP_HEAD / 2 + 0.5, w - 8);
    }
    ctx.restore();
    // outline (+ glow when selected)
    roundRect(ctx, x + 0.5, top + 0.5, w - 1, h - 1, CLIP_RADIUS);
    if (selected) {
      ctx.save();
      ctx.shadowColor = withAlpha(th.noteSelected, 0.7);
      ctx.shadowBlur = 6;
      ctx.strokeStyle = th.noteSelected;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = withAlpha(color, 0.75);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.lineWidth = 1;
  // Mini notes: inside a clip in the clip colour, outside any clip in the accent colour (nothing is hidden).
  let lo = 127;
  let hi = 0;
  for (const e of track.events) if (e.kind === 'note') {
    lo = Math.min(lo, e.pitch);
    hi = Math.max(hi, e.pitch);
  }
  const range = Math.max(12, hi - lo + 1);
  const bodyTop = top + CLIP_HEAD + 3;
  const bodyH = h - CLIP_HEAD - 6;
  const drums = track.displayMode === 'drum';
  for (const e of track.events) {
    if (e.kind !== 'note' || e.tick > t1 || e.tick + e.durationTicks < t0) continue;
    const c = clipOf.get(e.id);
    const nx = e.tick * pxPerTick - scrollX;
    const ny = bodyTop + ((hi - e.pitch) / range) * (bodyH - 3);
    const nw = drums ? 3 : Math.max(2, e.durationTicks * pxPerTick - 0.5);
    if (!c) continue; // loose notes (outside every clip) are silent and not part of the arrangement (ADR-064)
    ctx.fillStyle = withAlpha(c.color ?? track.color, 0.95);
    ctx.fillRect(nx, ny, nw, 3);
  }
  ctx.restore();
}

/** pointer movement before a header press becomes a reorder drag */
const HEADER_DRAG_PX = 6;

function TrackHeader({
  track,
  selected,
  dragging,
  renaming,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRename,
  onStartRename,
  onFlag,
}: {
  track: MidiTrack;
  selected: boolean;
  dragging: boolean;
  renaming: boolean;
  onSelect: () => void;
  onDragStart: (clientY: number) => void;
  onDragMove: (clientY: number) => void;
  onDragEnd: () => void;
  onRename: (name: string | null) => void;
  onStartRename: () => void;
  onFlag: (f: Partial<Pick<MidiTrack, 'mute' | 'solo'>>) => void;
}) {
  // press state of a reorder drag (ADR-040): armed on pointer down on the grip, dragging after
  // HEADER_DRAG_PX. Any end of the pointer sequence (up, cancel, lost capture) releases it.
  const press = useRef<{ y: number; dragging: boolean } | null>(null);
  // Enter / Esc end the rename; the input then unmounts and Chromium fires blur on it, which must
  // not commit a second time (or commit the typed name after Esc).
  const renameDone = useRef(false);
  const release = () => {
    const p = press.current;
    press.current = null;
    if (p?.dragging) onDragEnd();
  };
  return (
    <div className={`track-header${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}`} style={{ height: TRACK_H }} onClick={onSelect} data-testid="track-header">
      <span
        className="track-grip"
        role="button"
        aria-label={t('{name} を並べ替え', { name: track.name })}
        title={t('ドラッグで並べ替え（Alt / Option+↑↓ でも移動）')}
        draggable={false}
        onPointerDown={(e) => {
          if (e.button !== 0 || press.current) return;
          e.preventDefault(); // no text selection / native drag from the grip
          press.current = { y: e.clientY, dragging: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p) return;
          if (!p.dragging) {
            if (Math.abs(e.clientY - p.y) < HEADER_DRAG_PX) return;
            p.dragging = true;
            onDragStart(e.clientY);
          }
          onDragMove(e.clientY);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        ⋮⋮
      </span>
      <span className="track-color" style={{ background: track.color }} />
      {renaming ? (
        <input
          className="track-name-input"
          defaultValue={track.name}
          autoFocus
          aria-label={t('トラック名')}
          onFocus={() => (renameDone.current = false)}
          onBlur={(e) => !renameDone.current && onRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== 'Escape') return;
            renameDone.current = true;
            onRename(e.key === 'Enter' ? (e.target as HTMLInputElement).value : null);
          }}
        />
      ) : (
        <span className="track-name" onDoubleClick={onStartRename} title={t('ダブルクリックで名前を変更')}>
          {track.name}
        </span>
      )}
      <span className="track-meta">
        {track.port}
        {track.channel + 1}
        {track.displayMode === 'drum' ? ' 🥁' : ''}
      </span>
      <button className={`toggle${track.mute ? ' on' : ''}`} aria-pressed={track.mute} aria-label={t('{name} をミュート', { name: track.name })} onClick={(e) => (e.stopPropagation(), onFlag({ mute: !track.mute }))}>
        M
      </button>
      <button className={`toggle${track.solo ? ' on' : ''}`} aria-pressed={track.solo} aria-label={t('{name} をソロ', { name: track.name })} onClick={(e) => (e.stopPropagation(), onFlag({ solo: !track.solo }))}>
        S
      </button>
    </div>
  );
}
