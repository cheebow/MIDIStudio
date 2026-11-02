// Visual mode: keyboard monitor (after MML Studio's channel monitor, same author): one row per
// track with the sound, Volume / Expression bars, Pan / Pitch Bend markers, a level meter and a
// full-range keyboard that lights the sounding keys in the track colour.
import { useEffect, useMemo, useRef } from 'react';
import type { MidiProject } from '../../core/model/types';
import { buildMonitorData, notesAt, valueAt } from '../../core/visual/monitorData';
import { GM_PROGRAMS } from '../../core/gm/instruments';
import { useServices } from '../../app/store/context';
import { fitCanvas, isBlackKey } from '../canvas';

const WHITE_BEFORE = (() => {
  const a: number[] = [];
  let w = 0;
  for (let p = 0; p < 128; p++) {
    a.push(w);
    if (!isBlackKey(p)) w++;
  }
  return a;
})();
const WHITE_COUNT = 75;

export function KeyboardMonitor({ project }: { project: MidiProject }) {
  const { transport } = useServices();
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useMemo(() => buildMonitorData(project), [project]);
  const anySolo = project.tracks.some((t) => t.solo);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    let lastLabel = '';
    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const ctx = fitCanvas(canvas, w, h, { cssSized: true });
      if (ctx) {
        const cs = getComputedStyle(canvas);
        const bg = cs.getPropertyValue('--tm-bg').trim() || '#000';
        const text = cs.getPropertyValue('--tm-text').trim() || '#5ec8f0';
        const dim = cs.getPropertyValue('--tm-dim').trim() || '#2f7f9a';
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        const tick = Math.max(0, transport.getPosition().tick);
        const head = 18;
        const rows = Math.max(1, data.tracks.length);
        const rowH = Math.max(18, Math.min(54, (h - head) / rows));
        const nameW = Math.min(150, w * 0.13);
        const voiceW = Math.min(170, w * 0.14);
        const meter = 40;
        const xName = 6;
        const xVoice = xName + nameW + 6;
        const xVol = xVoice + voiceW + 6;
        const xExp = xVol + meter + 6;
        const xPan = xExp + meter + 6;
        const xPb = xPan + meter + 6;
        const xLvl = xPb + meter + 6;
        const xKeys = xLvl + 50 + 8;
        const keysW = Math.max(60, w - xKeys - 6);
        const wk = keysW / WHITE_COUNT;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = dim;
        for (const [label, x] of [['トラック', xName], ['音色', xVoice], ['Vol', xVol], ['Exp', xExp], ['Pan', xPan], ['PB', xPb], ['Level', xLvl]] as const) ctx.fillText(label, x, head / 2);
        for (let oct = 0; oct <= 9; oct++) {
          const x = xKeys + WHITE_BEFORE[oct * 12 + 12] * wk;
          if (x < xKeys + keysW - 12) ctx.fillText(`C${oct}`, x + 1, head / 2);
        }
        const labels: string[] = [];
        data.tracks.forEach((t, i) => {
          const y = head + i * rowH;
          const mid = y + rowH / 2;
          const silent = t.track.mute || (anySolo && !t.track.solo);
          ctx.globalAlpha = silent ? 0.35 : 1;
          const clip = (s: string, x: number, width: number) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, width, rowH);
            ctx.clip();
            ctx.fillText(s, x, mid);
            ctx.restore();
          };
          ctx.fillStyle = t.track.color;
          ctx.fillRect(xName - 4, y + 3, 3, rowH - 6);
          ctx.fillStyle = text;
          clip(`${t.track.port}${t.track.channel + 1} ${t.track.name}`, xName, nameW);
          const prog = valueAt(t.program, tick, -1);
          clip(t.track.displayMode === 'drum' ? 'ドラム' : prog >= 0 ? `${prog + 1} ${GM_PROGRAMS[prog] ?? ''}` : '—', xVoice, voiceW);
          const bar = (x: number, v: number) => {
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(x, mid - 4, meter, 8);
            ctx.fillStyle = t.track.color;
            ctx.fillRect(x, mid - 4, (meter * v) / 127, 8);
          };
          const centre = (x: number, r: number) => {
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(x, mid - 1, meter, 2);
            ctx.fillStyle = dim;
            ctx.fillRect(x + meter / 2 - 0.5, mid - 5, 1, 10);
            ctx.fillStyle = t.track.color;
            ctx.fillRect(x + r * (meter - 4), mid - 5, 4, 10);
          };
          bar(xVol, valueAt(t.volume, tick, 100));
          bar(xExp, valueAt(t.expression, tick, 127));
          centre(xPan, valueAt(t.pan, tick, 64) / 127);
          centre(xPb, (valueAt(t.bend, tick, 0) + 8192) / 16383);
          const sounding = notesAt(t, tick);
          const level = sounding.reduce((m, n) => Math.max(m, n.velocity), 0) / 127;
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(xLvl, mid - 4, 50, 8);
          ctx.fillStyle = t.track.color;
          ctx.fillRect(xLvl, mid - 4, 50 * level, 8);
          const lit = new Set(sounding.map((n) => n.pitch));
          if (lit.size) labels.push(`${t.track.name}:${[...lit].sort((a, b) => a - b).join(',')}`);
          const ky = y + 3;
          const kh = rowH - 6;
          ctx.fillStyle = '#555';
          ctx.fillRect(xKeys, ky, keysW, kh);
          for (let p = 0; p < 128; p++) {
            if (isBlackKey(p)) continue;
            ctx.fillStyle = lit.has(p) ? t.track.color : '#f2f2f2';
            ctx.fillRect(xKeys + WHITE_BEFORE[p] * wk + 0.5, ky, Math.max(1, wk - 1), kh);
          }
          for (let p = 0; p < 128; p++) {
            if (!isBlackKey(p)) continue;
            ctx.fillStyle = lit.has(p) ? t.track.color : '#222';
            ctx.fillRect(xKeys + WHITE_BEFORE[p] * wk - wk * 0.3, ky, wk * 0.6, kh * 0.6);
          }
          ctx.globalAlpha = 1;
        });
        const label = labels.join(';');
        if (label !== lastLabel) {
          lastLabel = label;
          canvas.setAttribute('data-sounding', label);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data, transport, anySolo]);

  return <canvas ref={ref} className="visual-canvas" data-testid="visual-keys" aria-label="トラックごとの鍵盤（鳴っている音が光る）" />;
}
