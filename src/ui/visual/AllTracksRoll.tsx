// Visual mode: piano roll of every track, scrolling under a fixed playhead. Notes use the track
// colour; sounding notes light up. Drawn on one canvas per animation frame (only this view).
import { useEffect, useMemo, useRef } from 'react';
import type { MidiProject } from '../../core/model/types';
import { buildMonitorData, notesIn } from '../../core/visual/monitorData';
import { useServices } from '../../app/store/context';
import { fitCanvas } from '../canvas';
import { useSignatureMap } from '../hooks';

const PLAYHEAD_AT = 0.22; // playhead position from the left edge
const BARS_VISIBLE = 6;

export function AllTracksRoll({ project }: { project: MidiProject }) {
  const { transport } = useServices();
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useMemo(() => buildMonitorData(project), [project]);
  const sig = useSignatureMap(project);
  const anySolo = project.tracks.some((t) => t.solo);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const ctx = fitCanvas(canvas, w, h, { cssSized: true });
      if (ctx) {
        const cs = getComputedStyle(canvas);
        const bg = cs.getPropertyValue('--tm-bg').trim() || '#000';
        const dim = cs.getPropertyValue('--tm-dim').trim() || '#335';
        const head = cs.getPropertyValue('--tm-now').trim() || '#fe5';
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        const tick = Math.max(0, transport.getPosition().tick);
        const barTicks = sig.ticksPerBar(tick);
        const pxPerTick = w / (barTicks * BARS_VISIBLE);
        const t0 = tick - (w * PLAYHEAD_AT) / pxPerTick;
        const t1 = t0 + w / pxPerTick;
        const lo = Math.max(0, data.minPitch - 2);
        const hi = Math.min(127, data.maxPitch + 2);
        const rowH = h / (hi - lo + 1);
        const x = (t: number) => (t - t0) * pxPerTick;
        const y = (p: number) => (hi - p) * rowH;
        // octave bands and bar / beat lines
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        for (let p = lo; p <= hi; p++) if (Math.floor(p / 12) % 2 === 0) ctx.fillRect(0, y(p), w, rowH);
        let bar = sig.tickToBarBeat(Math.max(0, t0)).bar;
        for (let g = 0; g < 500; g++, bar++) {
          const bt = sig.barBeatToTick(bar);
          if (bt > t1) break;
          for (let b = 1; b <= sig.signatureAt(bt).numerator; b++) {
            const bx = Math.round(x(sig.barBeatToTick(bar, b))) + 0.5;
            ctx.strokeStyle = dim;
            ctx.globalAlpha = b === 1 ? 0.9 : 0.3;
            ctx.lineWidth = b === 1 ? 1.5 : 1;
            ctx.beginPath();
            ctx.moveTo(bx, 0);
            ctx.lineTo(bx, h);
            ctx.stroke();
          }
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = dim;
          ctx.font = '11px ui-monospace, monospace';
          ctx.fillText(String(bar), Math.round(x(bt)) + 3, 12);
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        // notes
        for (const t of data.tracks) {
          const silent = t.track.mute || (anySolo && !t.track.solo);
          for (const n of notesIn(t, t0, t1)) {
            const nx = x(n.tick);
            const nw = Math.max(2, n.durationTicks * pxPerTick);
            const ny = y(n.pitch);
            const now = n.tick <= tick && tick < n.tick + n.durationTicks;
            ctx.globalAlpha = silent ? 0.15 : now ? 1 : 0.55;
            ctx.fillStyle = t.track.color;
            ctx.fillRect(nx, ny + 0.5, nw, Math.max(1.5, rowH - 1));
            if (now && !silent) {
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(nx + 0.5, ny + 0.5, nw - 1, Math.max(1.5, rowH - 1));
              ctx.lineWidth = 1;
            }
          }
        }
        ctx.globalAlpha = 1;
        // playhead
        const px = Math.round(w * PLAYHEAD_AT) + 0.5;
        ctx.strokeStyle = head;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data, sig, transport, anySolo]);

  return (
    <div className="visual-roll">
      <div className="visual-legend">
        {data.tracks.map((t) => (
          <span key={t.track.id} className={t.track.mute || (anySolo && !t.track.solo) ? 'off' : ''}>
            <i style={{ background: t.track.color }} />
            {t.track.name}
          </span>
        ))}
      </div>
      <canvas ref={ref} className="visual-canvas" data-testid="visual-roll" aria-label="全トラックのピアノロール（再生に追従）" />
    </div>
  );
}
