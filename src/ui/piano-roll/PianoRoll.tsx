// Piano roll (REQ-EDT-03/04/05, UI_DESIGN 4). Edits go through the shared EditorStore; drags are
// previewed locally and committed once on pointerup (ARCHITECTURE D).
import { useEffect, useMemo, useRef, useState } from 'react';
import { addEvents, deleteEvents, duplicateEvents, moveEvents, updateEvents } from '../../core/editing/operations';
import { gridTicks, snapTick } from '../../core/timing/grid';
import { looseNoteIds } from '../../core/model/looseNotes';
import type { MidiTrack, NoteEvent } from '../../core/model/types';
import { useEditActions, useEditorState, useServices } from '../../app/store/context';
import { t } from '../../i18n';
import { isSecondaryClick, useContextMenu } from '../menu/ContextMenu';
import { emptyMenuItems, noteMenuItems } from '../menu/editMenus';
import { conductorMarks, drawLoopRuler, drawPlayhead, drawRulerConductorMarks, drawStepCursor, fitCanvas, isBlackKey, pitchName, readTheme } from '../canvas';
import { ControllerLane } from './ControllerLane';
import { NoteInfoBar } from '../editing/NoteInfoBar';
import { useAnimationLoop, useDragState, useElementSize, usePlayheadFollow, useSignatureMap, useZoomAnchor } from '../hooks';
import { useThemeVersion } from '../../app/theme';
import { draggedLoop, hitLoop, loopCursor, loopSnap, type LoopDrag } from '../loopDrag';
import { selectedTrack } from '../../core/model/selectedTrack';
import { pointerOf, useDragAutoScroll, type PointerLike } from '../dragAutoScroll';

const ROW_H = 12;
const KEYS_W = 72;
const RULER_H = 20;
const EDGE_PX = 6;
const ALL_H = 128 * ROW_H;

// Drag coordinates (startX/startY, x0..y1) are content px: x from tick 0, y from the top of the
// grid content (scroll offset included), so the drag survives scrolling while it is held (ADR-068).
type Drag =
  | { kind: 'move'; anchor: NoteEvent; startX: number; startY: number; dTick: number; dPitch: number; duplicate: boolean }
  | { kind: 'resize'; ids: string[]; anchor: NoteEvent; startX: number; dLen: number; mergeKey?: string }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | LoopDrag;

let dragCounter = 0;

export function PianoRoll() {
  const { store, transport, audioReady, step, input, recorder, reportError } = useServices();
  const editActions = useEditActions();
  const ctxMenu = useContextMenu();
  const { project, selection, tool } = useEditorState();
  const settings = project.settings;
  const track: MidiTrack | undefined = selectedTrack(project);
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = usePlayheadFollow();
  const gridRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const size = useElementSize(scrollRef, { w: 800, h: 300 });
  const [drag, dragRef, setDrag] = useDragState<Drag>();
  /** velocities being dragged in the lane below: note shading follows them live */
  const [velPreview, setVelPreview] = useState<ReadonlyMap<string, number> | null>(null);
  const [lastLength, setLastLength] = useState<number | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const auditionRef = useRef<number | null>(null);
  /** last pointer of the active drag, re-applied when the view scrolls under it */
  const lastPointer = useRef<PointerLike | null>(null);
  const trackPointer = useDragAutoScroll(scrollRef, gridRef, drag !== null, { top: RULER_H, vertical: drag?.kind !== 'loop' });

  const ppq = project.ppq;
  const pxPerTick = settings.pianoRollZoom / ppq;
  const grid = useMemo(() => gridTicks(ppq, settings.grid), [ppq, settings.grid]);
  const gridLen = grid.num / grid.den;
  const sig = useSignatureMap(project);
  const themeVersion = useThemeVersion();
  /** one bar of margin before bar 1 (ADR-045 追記): view.x = scrollLeft − lead, so tick 0 is drawn `leadPx` from the left */
  const leadPx = Math.round(sig.ticksPerBar(0) * pxPerTick);
  const view = useMemo(() => ({ ...size, ...scroll, x: scroll.x - leadPx }), [size, scroll, leadPx]);
  const anchorZoom = useZoomAnchor(scrollRef, pxPerTick, leadPx, size.w - KEYS_W);
  const geom = useRef({ pxPerTick, leadPx, anchorZoom });
  geom.current = { pxPerTick, leadPx, anchorZoom };
  const notes = useMemo(() => (track ? track.events.filter((e): e is NoteEvent => e.kind === 'note') : []), [track]);
  const loose = useMemo(() => (track ? looseNoteIds(project, track) : new Set<string>()), [project, track]); // silent notes outside every clip (ADR-064)
  const end = useMemo(() => {
    let m = ppq * 4 * 32;
    for (const t of project.tracks) for (const e of t.events) m = Math.max(m, e.tick + (e.kind === 'note' ? e.durationTicks : 0));
    return m + ppq * 4 * 8;
  }, [project.tracks, ppq]);
  const totalW = end * pxPerTick + leadPx;

  const snap = (t: number) => {
    if (!settings.snapEnabled) return Math.round(t);
    const r = snapTick(t, grid, 'floor');
    return r.tick;
  };

  // When the edited track changes, scroll vertically to its notes (or to the saved pitch).
  const trackId = track?.id;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !trackId) return;
    const t = store.project.tracks.find((x) => x.id === trackId);
    const ps = t ? t.events.filter((e) => e.kind === 'note').map((e) => (e as NoteEvent).pitch) : [];
    const center = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : store.project.settings.pianoRollScrollPitch + 12;
    el.scrollTop = Math.max(0, (127 - center) * ROW_H - el.clientHeight / 2);
  }, [trackId, store]);

  // Grid + notes
  useEffect(() => {
    const canvas = gridRef.current;
    if (!canvas || !track) return;
    const w = view.w - KEYS_W;
    const h = view.h;
    const ctx = fitCanvas(canvas, w, h);
    if (!ctx) return;
    const th = readTheme(canvas);
    ctx.fillStyle = th.panel;
    ctx.fillRect(0, 0, w, h);
    if (view.x < 0) {
      ctx.fillStyle = th.blackKey;
      ctx.fillRect(0, 0, -view.x, h);
    }
    const t0 = view.x / pxPerTick;
    const t1 = (view.x + w) / pxPerTick;
    const pTop = 127 - Math.floor(view.y / ROW_H);
    const pBottom = Math.max(0, 127 - Math.ceil((view.y + h) / ROW_H));
    const yOf = (pitch: number) => (127 - pitch) * ROW_H - view.y + RULER_H;
    // rows
    for (let p = pBottom; p <= pTop; p++) {
      const y = yOf(p);
      if (isBlackKey(p)) {
        ctx.fillStyle = th.blackKey;
        ctx.fillRect(0, y, w, ROW_H);
      }
      if (p % 12 === 0) {
        ctx.strokeStyle = th.grid;
        ctx.beginPath();
        ctx.moveTo(0, y + ROW_H + 0.5);
        ctx.lineTo(w, y + ROW_H + 0.5);
        ctx.stroke();
      }
    }
    // loop (the preview while dragged on the ruler)
    const loopView = drag?.kind === 'loop' ? drag.preview : project.loop;
    if (loopView.enabled) {
      ctx.fillStyle = th.loop;
      ctx.fillRect(loopView.startTick * pxPerTick - view.x, 0, (loopView.endTick - loopView.startTick) * pxPerTick, h);
    }
    // vertical grid
    if (gridLen * pxPerTick >= 4) {
      const first = Math.max(0, Math.floor(t0 / gridLen));
      for (let i = first; i * gridLen <= t1; i++) {
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
    ctx.fillRect(0, RULER_H - 1, w, 1);
    drawLoopRuler(ctx, loopView, pxPerTick, view.x, RULER_H, th);
    drawRulerConductorMarks(ctx, conductorMarks(project.conductor), pxPerTick, view.x, w, RULER_H, th, (t) => barLabelEnd.get(t) ?? -Infinity);
    ctx.font = '11px system-ui, sans-serif';
    // ghost notes of other tracks (reference only)
    if (settings.showGhostNotes) {
      ctx.fillStyle = th.ghost;
      for (const t of project.tracks) {
        if (t.id === track.id) continue;
        for (const e of t.events) {
          if (e.kind !== 'note' || e.tick > t1 || e.tick + e.durationTicks < t0 || e.pitch > pTop || e.pitch < pBottom) continue;
          ctx.fillRect(e.tick * pxPerTick - view.x, yOf(e.pitch) + 2, Math.max(2, e.durationTicks * pxPerTick), ROW_H - 4);
        }
      }
    }
    // notes (with drag preview offsets)
    const sel = selection.eventIds;
    for (const n of notes) {
      let tick = n.tick;
      let pitch = n.pitch;
      let len = n.durationTicks;
      const isSel = sel.has(n.id);
      if (drag?.kind === 'move' && isSel) {
        tick += drag.dTick;
        pitch = Math.max(0, Math.min(127, pitch + drag.dPitch));
      }
      if (drag?.kind === 'resize' && drag.ids.includes(n.id)) len = Math.max(1, len + drag.dLen);
      if (tick > t1 || tick + len < t0 || pitch > pTop || pitch < pBottom) continue;
      const x = tick * pxPerTick - view.x;
      const y = yOf(pitch);
      const nw = Math.max(3, len * pxPerTick);
      const isLoose = loose.has(n.id); // outside every clip: drawn faint, not played (ADR-064)
      const alpha = (0.45 + ((velPreview?.get(n.id) ?? n.velocity) / 127) * 0.55) * (isLoose ? 0.35 : 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = isSel ? th.noteSelected : track.color;
      ctx.fillRect(x, y + 1, nw, ROW_H - 2);
      ctx.globalAlpha = isLoose ? 0.35 : 1;
      ctx.strokeStyle = th.text;
      ctx.lineWidth = isSel ? 1.5 : 0.5;
      ctx.strokeRect(x + 0.5, y + 1.5, nw - 1, ROW_H - 3);
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
      if (drag?.kind === 'move' && drag.duplicate && isSel) {
        // original stays in place when duplicating
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = track.color;
        ctx.fillRect(n.tick * pxPerTick - view.x, yOf(n.pitch) + 1, Math.max(3, n.durationTicks * pxPerTick), ROW_H - 2);
        ctx.globalAlpha = 1;
      }
    }
    if (drag?.kind === 'box') {
      ctx.fillStyle = th.selection;
      ctx.strokeStyle = th.accent;
      const x = Math.min(drag.x0, drag.x1) - view.x;
      const y = Math.min(drag.y0, drag.y1) - view.y;
      ctx.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    }
  }, [project, track, notes, loose, view, pxPerTick, gridLen, sig, selection.eventIds, drag, velPreview, settings.showGhostNotes, themeVersion]);

  // Keyboard column: redrawn every frame by the overlay loop, with the keys being played (PC
  // keyboard / MIDI input / click audition) in the playhead colour and the track's sounding notes
  // in the accent colour (ADR-044 追記).
  const drawKeys = (held: ReadonlySet<number>, playing: ReadonlySet<number>) => {
    const canvas = keysRef.current;
    if (!canvas) return;
    const ctx = fitCanvas(canvas, KEYS_W, view.h);
    if (!ctx) return;
    const th = readTheme(canvas);
    ctx.fillStyle = th.panel;
    ctx.fillRect(0, 0, KEYS_W, view.h);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let p = 0; p < 128; p++) {
      const y = (127 - p) * ROW_H - view.y + RULER_H;
      if (y < RULER_H - ROW_H || y > view.h) continue;
      const black = isBlackKey(p);
      const kw = black ? KEYS_W * 0.6 : KEYS_W;
      ctx.fillStyle = black ? th.text : th.panel;
      ctx.fillRect(0, y, kw, ROW_H);
      // a soft tint over the key, not a solid colour (ADR-044 追記)
      if (held.has(p) || playing.has(p)) {
        ctx.globalAlpha = held.has(p) ? 0.45 : 0.3;
        ctx.fillStyle = held.has(p) ? th.playhead : th.accent;
        ctx.fillRect(0, y, kw, ROW_H);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = th.border;
      ctx.strokeRect(0.5, y + 0.5, KEYS_W - 1, ROW_H);
      if (p % 12 === 0) {
        ctx.fillStyle = th.muted;
        ctx.fillText(pitchName(p), KEYS_W - 26, y + ROW_H / 2);
      }
    }
    ctx.fillStyle = th.panel;
    ctx.fillRect(0, 0, KEYS_W, RULER_H);
  };

  // Playhead overlay
  useAnimationLoop(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const w = view.w - KEYS_W;
    const ctx = fitCanvas(canvas, w, view.h);
    if (!ctx) return;
    ctx.clearRect(0, 0, w, view.h);
    const pos = transport.getPosition();
    const x = Math.round(pos.tick * pxPerTick - view.x) + 0.5;
    drawPlayhead(ctx, canvas, x, view.h);
    // keys: held by the player, and (while playing) the track's notes sounding at the playhead
    const held = new Set(input.getSnapshot().pianoHeld);
    if (auditionRef.current !== null) held.add(auditionRef.current);
    const playing = new Set<number>();
    if (pos.playing) for (const n of notes) if (n.tick <= pos.tick && pos.tick < n.tick + n.durationTicks) playing.add(n.pitch);
    drawKeys(held, playing);
    // notes being recorded (live, before they are committed on stop)
    const live = recorder.livePreview().get(track?.id ?? '');
    if (live) {
      for (const n of live) {
        const nx = n.tick * pxPerTick - view.x;
        const ny = (127 - n.pitch) * ROW_H - view.y + RULER_H;
        ctx.fillStyle = n.held ? 'rgba(229,72,77,0.95)' : 'rgba(229,72,77,0.7)';
        ctx.fillRect(nx, ny + 1, Math.max(3, n.durationTicks * pxPerTick), ROW_H - 2);
      }
    }
    if (input.mode === 'step-piano' || input.mode === 'step-drums') drawStepCursor(ctx, Math.round(step.cursor * pxPerTick - view.x) + 0.5, view.h);
    follow(pos, x, w, scrollRef.current, sig, pxPerTick, settings.followPlayback);
  }, [transport, view, pxPerTick, settings.followPlayback, step, input, recorder, track?.id, sig, follow, notes]);

  // Ctrl / ⌘ + wheel (and trackpad pinch, which Chrome reports as wheel + ctrlKey) zooms the roll.
  // React registers wheel listeners as passive, so preventDefault there would not stop the page
  // zoom: a native non-passive listener is needed.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      // the tick under the pointer stays under the pointer (x is measured inside the grid)
      const g = geom.current;
      const x = e.clientX - el.getBoundingClientRect().left - KEYS_W;
      g.anchorZoom((x + el.scrollLeft - g.leadPx) / g.pxPerTick, x);
      const zoom = store.project.settings.pianoRollZoom;
      store.updateSettings({ pianoRollZoom: Math.round(Math.max(10, Math.min(800, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [store]);


  if (!track) return <p className="note">{t('トラックがありません。トラックメニューから追加してください。')}</p>;

  const toTick = (x: number) => Math.max(0, (x + view.x) / pxPerTick);
  const toPitch = (y: number) => Math.max(0, Math.min(127, 127 - Math.floor((y - RULER_H + view.y) / ROW_H)));
  /** content px (see Drag) from a client point, read from the live scroll position */
  const contentPoint = (clientX: number, clientY: number) => {
    const el = scrollRef.current;
    const r = gridRef.current?.getBoundingClientRect();
    const x = clientX - (r?.left ?? 0);
    const y = clientY - (r?.top ?? 0);
    return { x, y, cx: x + (el?.scrollLeft ?? scroll.x) - leadPx, cy: y + (el?.scrollTop ?? scroll.y) };
  };
  const tickAt = (cx: number) => Math.max(0, cx / pxPerTick);
  const pitchAt = (cy: number) => Math.max(0, Math.min(127, 127 - Math.floor((cy - RULER_H) / ROW_H)));

  function hit(x: number, y: number): { note: NoteEvent; edge: boolean } | null {
    const t = (x + view.x) / pxPerTick; // unclamped: the margin before bar 1 is empty space, not tick 0
    if (t < 0) return null;
    const p = toPitch(y);
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.pitch !== p || t < n.tick || t > n.tick + n.durationTicks) continue;
      const rightPx = (n.tick + n.durationTicks) * pxPerTick - view.x;
      return { note: n, edge: rightPx - x <= EDGE_PX };
    }
    return null;
  }

  function audition(pitch: number | null) {
    if (!audioReady || !track) return;
    if (auditionRef.current !== null) transport.releaseAuditionNote(track.id, auditionRef.current, 'roll');
    auditionRef.current = pitch;
    if (pitch !== null) transport.auditionNote(track.id, pitch, 100, 'roll');
  }

  function onContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!track) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const tick = snap(toTick(x));
    if (y < RULER_H) return ctxMenu.open(e, [{ label: t('再生位置をここに移動'), action: () => transport.seek(tick) }]);
    const n = hit(x, y)?.note;
    if (n) {
      // right-click on an unselected note selects just that note
      if (!store.getState().selection.eventIds.has(n.id)) store.selectEvents([n.id]);
      ctxMenu.open(e, noteMenuItems(editActions, {}));
    } else ctxMenu.open(e, emptyMenuItems(editActions, store, transport, track.id, tick, reportError));
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!track || isSecondaryClick(e)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { cx, cy } = contentPoint(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    lastPointer.current = pointerOf(e);
    trackPointer(e.clientX, e.clientY);
    if (y < RULER_H) {
      const lh = hitLoop(x, y, project.loop, pxPerTick, view.x, RULER_H);
      if (lh) setDrag({ kind: 'loop', hit: lh, startX: cx, origin: project.loop, preview: project.loop });
      else transport.seek(snap(toTick(x)));
      return;
    }
    const h = hit(x, y);
    if (h) {
      let sel = new Set(selection.eventIds);
      if (e.shiftKey) {
        if (sel.has(h.note.id)) sel.delete(h.note.id);
        else sel.add(h.note.id);
      } else if (!sel.has(h.note.id)) sel = new Set([h.note.id]);
      store.selectEvents(sel);
      if (h.edge) setDrag({ kind: 'resize', ids: [...sel].filter((id) => notes.some((n) => n.id === id)), anchor: h.note, startX: cx, dLen: 0 });
      else {
        setDrag({ kind: 'move', anchor: h.note, startX: cx, startY: cy, dTick: 0, dPitch: 0, duplicate: e.altKey });
        audition(h.note.pitch);
      }
      return;
    }
    if (tool === 'draw' && e.button === 0) {
      const tick = snap(toTick(x));
      const pitch = toPitch(y);
      const len = lastLength ?? Math.max(1, Math.round(gridLen));
      try {
        const r = addEvents(store.project, track.id, [{ kind: 'note', tick, pitch, velocity: project.inputPresets.defaultVelocity, durationTicks: len, releaseVelocity: 64 }], { label: 'ノートを入力' });
        if (!r) return;
        const key = `draw-${++dragCounter}`;
        store.run(r.command, { mergeKey: key, select: r.ids });
        const created = store.project.tracks.find((t) => t.id === track.id)!.events.find((ev) => ev.id === r.ids[0]) as NoteEvent;
        setDrag({ kind: 'resize', ids: r.ids, anchor: created, startX: cx, dLen: 0, mergeKey: key });
        if (!settings.snapEnabled || snapTick(tick, grid).exact) setWarning(null);
        else setWarning(t('グリッド線が整数 Tick にならないため、位置を最も近い Tick に丸めました。'));
        audition(pitch);
      } catch (err) {
        setWarning((err as Error).message);
      }
      return;
    }
    if (!e.shiftKey) store.selectEvents([]);
    setDrag({ kind: 'box', x0: cx, y0: cy, x1: cx, y1: cy, additive: e.shiftKey });
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
    if (y < RULER_H) {
      e.currentTarget.style.cursor = loopCursor(hitLoop(x, y, project.loop, pxPerTick, view.x, RULER_H)) || 'default';
      return;
    }
    const h = hit(x, y);
    e.currentTarget.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : tool === 'draw' ? 'crosshair' : 'default';
  }

  /** Updates the active drag for a pointer (also called when the view scrolls under a still pointer). */
  function applyDrag(p: PointerLike) {
    const drag = dragRef.current;
    if (!drag) return;
    const { cx, cy } = contentPoint(p.clientX, p.clientY);
    if (drag.kind === 'loop') {
      setDrag({ ...drag, preview: draggedLoop(drag.origin, drag.hit, (cx - drag.startX) / pxPerTick, loopSnap(sig, p.shiftKey), sig.ticksPerBeat(0)) });
      return;
    }
    if (drag.kind === 'move') {
      const rawStart = drag.anchor.tick + (cx - drag.startX) / pxPerTick;
      const dTick = (p.ctrlKey || p.metaKey ? Math.round(rawStart) : snap(rawStart + gridLen / 2)) - drag.anchor.tick;
      const dPitch = pitchAt(cy) - drag.anchor.pitch;
      if (dPitch !== drag.dPitch) audition(drag.anchor.pitch + dPitch);
      setDrag({ ...drag, dTick, dPitch, duplicate: drag.duplicate || p.altKey });
    } else if (drag.kind === 'resize') {
      const rawEnd = drag.anchor.tick + drag.anchor.durationTicks + (cx - drag.startX) / pxPerTick;
      const newEnd = p.ctrlKey || p.metaKey || !settings.snapEnabled ? Math.round(rawEnd) : snap(rawEnd + gridLen / 2);
      const dLen = Math.max(1, newEnd - drag.anchor.tick) - drag.anchor.durationTicks;
      setDrag({ ...drag, dLen });
    } else setDrag({ ...drag, x1: cx, y1: cy });
  }

  function onPointerUp() {
    const d = dragRef.current;
    setDrag(null);
    audition(null);
    if (!d || !track) return;
    if (d.kind === 'loop') {
      if (d.preview.startTick !== d.origin.startTick || d.preview.endTick !== d.origin.endTick) store.setLoop(d.preview);
      return;
    }
    try {
      if (d.kind === 'move' && (d.dTick !== 0 || d.dPitch !== 0)) {
        const ids = [...selection.eventIds].filter((id) => notes.some((n) => n.id === id));
        if (d.duplicate) {
          const r = duplicateEvents(store.project, ids, d.dTick);
          if (r) {
            const key = `dup-${++dragCounter}`;
            store.run(r.command, { select: r.ids, mergeKey: key });
            if (d.dPitch !== 0) store.run(moveEvents(store.project, r.ids, 0, d.dPitch, '複製'), { mergeKey: key });
          }
        } else store.run(moveEvents(store.project, ids, d.dTick, d.dPitch));
      } else if (d.kind === 'resize' && d.dLen !== 0) {
        const updates = d.ids
          .map((id) => store.project.tracks.flatMap((t) => t.events).find((ev) => ev.id === id))
          .filter((n): n is NoteEvent => n?.kind === 'note')
          .map((n) => ({ id: n.id, changes: { durationTicks: Math.max(1, n.durationTicks + d.dLen) } }));
        store.run(updateEvents(store.project, updates, 'ノートの長さを変更'), { mergeKey: d.mergeKey });
        setLastLength(Math.max(1, d.anchor.durationTicks + d.dLen));
      } else if (d.kind === 'box') {
        const [xa, xb] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)];
        const [ya, yb] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)];
        if (xb - xa < 2 && yb - ya < 2) return;
        const ta = tickAt(xa);
        const tb = tickAt(xb);
        const pa = pitchAt(yb);
        const pb = pitchAt(ya);
        const ids = notes.filter((n) => n.tick < tb && n.tick + n.durationTicks > ta && n.pitch >= pa && n.pitch <= pb).map((n) => n.id);
        store.selectEvents(d.additive ? [...selection.eventIds, ...ids] : ids);
      }
    } catch (err) {
      setWarning((err as Error).message);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!track) return;
    // ↑ ↓ shift the PC keyboard's octave while performing / step-entering (global shortcut)
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (input.mode === 'piano-performance' || input.mode === 'step-piano')) return;
    // ← → are rest / back (Shift: step length) while step-entering (ADR-076)
    // (Backspace too: it undoes the last step and moves the cursor back, ADR-083)
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Backspace') && (input.mode === 'step-piano' || input.mode === 'step-drums')) return;
    const ids = [...selection.eventIds].filter((id) => track.events.some((ev) => ev.id === id));
    const step = Math.max(1, Math.round(gridLen));
    const run = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        fn();
      } catch (err) {
        setWarning((err as Error).message);
      }
    };
    if (e.key === 'Delete' || e.key === 'Backspace') run(() => store.run(deleteEvents(store.project, ids)));
    else if (e.altKey) return; // Alt+↑↓ moves the track (App shortcut)
    else if (e.key === 'ArrowUp' && ids.length) run(() => store.run(moveEvents(store.project, ids, 0, e.shiftKey ? 12 : 1, '移調')));
    else if (e.key === 'ArrowDown' && ids.length) run(() => store.run(moveEvents(store.project, ids, 0, e.shiftKey ? -12 : -1, '移調')));
    else if (e.key === 'ArrowRight' && ids.length) run(() => store.run(moveEvents(store.project, ids, step)));
    else if (e.key === 'ArrowLeft' && ids.length) run(() => store.run(moveEvents(store.project, ids, -step)));
  }

  return (
    <div className="piano-roll">
      <NoteInfoBar track={track} />
      <div className="roll-main">
        <div className="roll-scroll" ref={scrollRef} onScroll={(e) => {
          const { scrollLeft, scrollTop } = e.currentTarget;
          setScroll({ x: scrollLeft, y: scrollTop });
          if (dragRef.current && lastPointer.current) applyDrag(lastPointer.current);
        }}>
          <div style={{ width: totalW + KEYS_W, height: ALL_H + RULER_H }}>
            <div className="sticky-canvas roll-sticky" style={{ width: view.w, height: view.h }}>
              <canvas ref={keysRef} className="roll-keys" aria-label={t('鍵盤（クリックで試聴）')} onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const y = e.clientY - rect.top;
                if (y >= RULER_H) audition(toPitch(y));
              }} onPointerUp={() => audition(null)} onPointerLeave={() => audition(null)} />
              <canvas
                ref={gridRef}
                className="roll-grid"
                style={{ left: KEYS_W }}
                tabIndex={0}
                aria-label={t('ピアノロール: {name}。{tool}。矢印キーで移動・移調、Delete で削除', { name: track.name, tool: tool === 'draw' ? t('描画ツール') : t('選択ツール') })}
                data-testid="piano-roll-grid"
                onPointerDown={onPointerDown}
                onContextMenu={onContextMenu}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                  setDrag(null);
                  audition(null);
                }}
                onKeyDown={onKeyDown}
              />
              <canvas ref={overlayRef} className="overlay-canvas" style={{ left: KEYS_W }} aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
      <ControllerLane track={track} viewX={view.x} width={view.w - KEYS_W} offsetLeft={KEYS_W} pxPerTick={pxPerTick} snap={snap} onVelocityPreview={setVelPreview} />
      {warning && (
        <p className="note warn-text" role="status">
          {warning}
        </p>
      )}
      {ctxMenu.element}
    </div>
  );
}
