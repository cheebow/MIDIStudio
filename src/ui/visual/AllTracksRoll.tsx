// Visual mode: piano roll of every track, scrolling under a fixed playhead. Notes use the track
// colour; sounding notes light up. Drawn on one canvas per animation frame (only this view).
import { useEffect, useMemo, useRef } from 'react';
import { t } from '../../i18n';
import type { MidiProject } from '../../core/model/types';
import { buildMonitorData, notesIn } from '../../core/visual/monitorData';
import { useServices } from '../../app/store/context';
import { fitCanvas, isBlackKey, pitchName } from '../canvas';
import { useSignatureMap } from '../hooks';

const PLAYHEAD_AT = 0.22; // playhead position from the left edge
const BARS_VISIBLE = 6;
const KEYS_W = 40; // keyboard on the left (sounding keys light up in the track colour)

export function AllTracksRoll({ project }: { project: MidiProject }) {
  const { transport } = useServices();
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useMemo(() => buildMonitorData(project), [project]);
  const sig = useSignatureMap(project);
  const anySolo = project.tracks.some((tk) => tk.solo);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const draw = () => {
      const cw = canvas.clientWidth;
      const h = canvas.clientHeight;
      const ctx = fitCanvas(canvas, cw, h, { cssSized: true });
      const w = Math.max(1, cw - KEYS_W); // width of the note area, right of the keyboard
      if (ctx) {
        const cs = getComputedStyle(canvas);
        const bg = cs.getPropertyValue('--tm-bg').trim() || '#000';
        const dim = cs.getPropertyValue('--tm-dim').trim() || '#335';
        const head = cs.getPropertyValue('--tm-now').trim() || '#fe5';
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, cw, h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(KEYS_W, 0, w, h);
        ctx.clip();
        ctx.translate(KEYS_W, 0);
        const tick = Math.max(0, transport.getPosition().tick);
        const barTicks = sig.ticksPerBar(tick);
        const pxPerTick = w / (barTicks * BARS_VISIBLE);
        const t0 = tick - (w * PLAYHEAD_AT) / pxPerTick;
        const t1 = t0 + w / pxPerTick;
        const lo = Math.max(0, data.minPitch - 2);
        const hi = Math.min(127, data.maxPitch + 2);
        const rowH = h / (hi - lo + 1);
        const x = (tk: number) => (tk - t0) * pxPerTick;
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
        // notes; the keyboard lights the keys of sounding notes (the track drawn last wins)
        const lit = new Map<number, string>();
        for (const tk of data.tracks) {
          const silent = tk.track.mute || (anySolo && !tk.track.solo);
          for (const n of notesIn(tk, t0, t1)) {
            const nx = x(n.tick);
            const nw = Math.max(2, n.durationTicks * pxPerTick);
            const ny = y(n.pitch);
            const now = n.tick <= tick && tick < n.tick + n.durationTicks;
            ctx.globalAlpha = silent ? 0.15 : now ? 1 : 0.55;
            ctx.fillStyle = tk.track.color;
            ctx.fillRect(nx, ny + 0.5, nw, Math.max(1.5, rowH - 1));
            if (now && !silent) {
              lit.set(n.pitch, tk.track.color);
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
        ctx.restore();
        drawKeys(ctx, lo, hi, rowH, h, lit, dim);
        const litText = [...lit.keys()].sort((p, q) => p - q).join(',');
        if (canvas.dataset.lit !== litText) canvas.dataset.lit = litText; // for tests; written only on change
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data, sig, transport, anySolo]);

  return (
    <div className="visual-roll">
      <div className="visual-legend">
        {data.tracks.map((tk) => (
          <span key={tk.track.id} className={tk.track.mute || (anySolo && !tk.track.solo) ? 'off' : ''}>
            <i style={{ background: tk.track.color }} />
            {tk.track.name}
          </span>
        ))}
      </div>
      <canvas ref={ref} className="visual-canvas" data-testid="visual-roll" aria-label={t('全トラックのピアノロール（再生に追従）')} />
    </div>
  );
}

/** Keyboard column at the left edge: one row per pitch, C labels when rows are tall enough. */
function drawKeys(ctx: CanvasRenderingContext2D, lo: number, hi: number, rowH: number, h: number, lit: ReadonlyMap<number, string>, line: string): void {
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 0, KEYS_W, h);
  ctx.font = `${Math.min(10, Math.floor(rowH))}px ui-monospace, monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (let p = lo; p <= hi; p++) {
    const y = (hi - p) * rowH;
    const black = isBlackKey(p);
    const color = lit.get(p);
    if (black) {
      ctx.fillStyle = color ?? '#222';
      ctx.fillRect(0, y, KEYS_W * 0.6, rowH);
    } else if (color) {
      ctx.fillStyle = color;
      ctx.fillRect(0, y, KEYS_W, rowH);
    }
    // boundaries between neighbouring white keys (B-C, E-F)
    if (p % 12 === 0 || p % 12 === 5) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, Math.round(y + rowH) - 0.5, KEYS_W, 1);
    }
    if (p % 12 === 0 && rowH >= 7) {
      ctx.fillStyle = color ? '#fff' : '#555';
      ctx.fillText(pitchName(p), KEYS_W - 3, y + rowH / 2);
    }
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = line;
  ctx.fillRect(KEYS_W - 1, 0, 1, h);
}
