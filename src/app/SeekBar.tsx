// Seek bar of the transport (ADR-053): the whole song as a strip with bar numbers, the loop range
// (draggable: ends resize, band moves) and the playhead. Click / drag seeks; ← → move a bar
// (Shift: a beat), Home / End jump to the start / end.
import { useEffect, useRef } from 'react';
import type { MidiProject } from '../core/model/types';
import type { TimeSignatureMap } from '../core/timing/timeSignatureMap';
import type { Transport } from '../playback/Transport';
import { fitCanvas, readTheme } from '../ui/canvas';
import { useDragState, useElementSize } from '../ui/hooks';
import { draggedLoop, hitLoop, loopCursor, loopSnap, type LoopDrag } from '../ui/loopDrag';
import { useThemeVersion } from './theme';
import { usePlaybackPosition } from './hooks/usePlayback';
import { useServices } from './store/context';

const H = 22;
type Drag = { kind: 'seek' } | LoopDrag;

export function SeekBar({ transport, project, sig, endTick }: { transport: Transport; project: MidiProject; sig: TimeSignatureMap; endTick: number }) {
  const { store } = useServices();
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { w } = useElementSize(wrap, { w: 300, h: H });
  const pos = usePlaybackPosition(transport);
  const themeVersion = useThemeVersion();
  const [drag, dragRef, setDrag] = useDragState<Drag>();
  const pxPerTick = w / Math.max(1, endTick);
  const loopView = drag?.kind === 'loop' ? drag.preview : project.loop;
  const tickAt = (x: number) => Math.max(0, Math.min(endTick, x / pxPerTick));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || w <= 0) return;
    const ctx = fitCanvas(canvas, w, H, { cssSized: true }); // the canvas always spans the strip (CSS), whatever was measured so far
    if (!ctx) return;
    const th = readTheme(canvas);
    ctx.fillStyle = th.panel;
    ctx.fillRect(0, 0, w, H);
    // played part
    const px = Math.max(0, Math.min(w, pos.tick * pxPerTick));
    ctx.fillStyle = th.selection;
    ctx.fillRect(0, 0, px, H);
    // loop range
    if (loopView.endTick > loopView.startTick) {
      const x0 = loopView.startTick * pxPerTick;
      const x1 = loopView.endTick * pxPerTick;
      ctx.save();
      ctx.fillStyle = th.loopRuler;
      if (loopView.enabled) {
        ctx.globalAlpha = 0.28;
        ctx.fillRect(x0, 0, x1 - x0, H);
        ctx.globalAlpha = 1;
        ctx.fillRect(x0, H - 3, x1 - x0, 3);
      } else {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = th.loopRuler;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x0 + 0.5, 1.5, x1 - x0 - 1, H - 3);
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
      ctx.fillRect(Math.round(x0), 0, 2, H);
      ctx.fillRect(Math.round(x1) - 2, 0, 2, H);
      ctx.restore();
    }
    // bar lines and numbers, thinned to keep labels apart
    const bars = sig.tickToBarBeat(endTick).bar;
    const barPx = w / Math.max(1, bars);
    const step = [1, 2, 4, 8, 16, 32, 64, 128].find((s) => s * barPx >= 34) ?? 256;
    ctx.font = '9px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    for (let bar = 1; bar <= bars + 1; bar++) {
      const x = Math.round(sig.barBeatToTick(bar) * pxPerTick) + 0.5;
      if (x > w) break;
      const major = (bar - 1) % step === 0;
      ctx.strokeStyle = major ? th.gridStrong : th.grid;
      ctx.beginPath();
      ctx.moveTo(x, major ? 0 : H - 6);
      ctx.lineTo(x, H);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = th.muted;
        ctx.fillText(String(bar), x + 3, 2);
      }
    }
    // playhead
    ctx.fillStyle = th.playhead;
    ctx.fillRect(Math.round(px) - 1, 0, 2, H);
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = th.border;
    ctx.strokeRect(0.5, 0.5, w - 1, H - 1);
  }, [w, pos.tick, loopView, sig, endTick, pxPerTick, themeVersion]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    e.currentTarget.setPointerCapture(e.pointerId);
    const hit = hitLoop(x, e.clientY - rect.top, project.loop, pxPerTick, 0, H);
    if (hit) setDrag({ kind: 'loop', hit, startX: x, origin: project.loop, preview: project.loop });
    else {
      transport.seek(tickAt(x));
      setDrag({ kind: 'seek' });
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const d = dragRef.current;
    if (!d) {
      e.currentTarget.style.cursor = loopCursor(hitLoop(x, e.clientY - rect.top, project.loop, pxPerTick, 0, H)) || 'pointer';
      return;
    }
    if (d.kind === 'seek') transport.seek(tickAt(x));
    else setDrag({ ...d, preview: draggedLoop(d.origin, d.hit, (x - d.startX) / pxPerTick, loopSnap(sig, e.shiftKey), sig.ticksPerBeat(0)) });
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    setDrag(null);
    if (d?.kind === 'loop' && (d.preview.startTick !== d.origin.startTick || d.preview.endTick !== d.origin.endTick)) store.setLoop(d.preview);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = Math.round(pos.tick);
    const bb = sig.tickToBarBeat(t);
    let to: number | null = null;
    if (e.key === 'ArrowRight') to = e.shiftKey ? t + sig.ticksPerBeat(t) : sig.barBeatToTick(bb.bar + 1);
    else if (e.key === 'ArrowLeft') to = e.shiftKey ? t - sig.ticksPerBeat(t) : sig.barBeatToTick(Math.max(1, bb.beat > 1 || t > sig.barBeatToTick(bb.bar) ? bb.bar : bb.bar - 1));
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = endTick;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    transport.seek(Math.max(0, Math.min(endTick, Math.round(to))));
  };

  return (
    <div className="seek-bar" ref={wrap} data-testid="seek-bar" data-end-tick={endTick}>
      <canvas
        ref={canvasRef}
        role="slider"
        tabIndex={0}
        aria-label="再生位置"
        aria-valuemin={0}
        aria-valuemax={endTick}
        aria-valuenow={Math.round(pos.tick)}
        aria-valuetext={sig.format(pos.tick)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
