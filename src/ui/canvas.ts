import type { ConductorEvent } from '../core/model/types';
import { chordIndexAtOrBefore, type ChordSegment } from '../core/theory/chords';
import { noteName } from '../core/list/noteNames';
import { bpmFromUs, shownBpm } from '../core/timing/tempoMap';
import { DEFAULT_TEMPO_US } from '../core/model/defaults';

// Canvas helpers: device-pixel-ratio sizing and theme colours from CSS variables.

/**
 * Sizes the bitmap of `canvas` to `width` × `height` CSS pixels at the device pixel ratio.
 * By default the CSS size is pinned with inline styles (canvases placed by the editors). A canvas
 * whose size comes from CSS (`cssSized`, e.g. `width: 100%` in a flex box) must not be pinned:
 * the inline size would stick after the layout changed (visual mode: 2 rows → 1 pane).
 */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number, opts: { cssSized?: boolean } = {}): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    if (!opts.cssSized) {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export interface Theme {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  border: string;
  grid: string;
  gridStrong: string;
  gridBeat: string;
  accent: string;
  note: string;
  noteSelected: string;
  ghost: string;
  blackKey: string;
  whiteKey: string;
  playhead: string;
  loop: string;
  loopRuler: string;
  selection: string;
  tempo: string;
  signature: string;
  keysig: string;
  marker: string;
}

export function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--bg', '#f6f7f9'),
    panel: v('--panel', '#fff'),
    text: v('--text', '#1d2330'),
    muted: v('--muted', '#5d6677'),
    border: v('--border', '#d5d9e0'),
    grid: v('--grid', 'rgba(0,0,0,0.06)'),
    gridStrong: v('--grid-strong', 'rgba(0,0,0,0.18)'),
    gridBeat: v('--grid-beat', 'rgba(0,0,0,0.12)'),
    accent: v('--accent', '#2f6fdb'),
    note: v('--note', '#4f8ef7'),
    noteSelected: v('--note-selected', '#f2994a'),
    ghost: v('--ghost', 'rgba(120,120,120,0.25)'),
    blackKey: v('--black-key', 'rgba(0,0,0,0.05)'),
    whiteKey: v('--white-key', 'transparent'),
    playhead: v('--playhead', '#e5484d'),
    loop: v('--loop', 'rgba(47,111,219,0.15)'),
    loopRuler: v('--loop-ruler', '#2fa36b'),
    selection: v('--selection', 'rgba(47,111,219,0.2)'),
    tempo: v('--tempo', '#c4661f'),
    signature: v('--signature', '#8a4fd6'),
    keysig: v('--keysig', '#16837a'),
    marker: v('--marker', '#c23c74'),
  };
}

export { NOTE_SHARP as NOTE_NAMES } from '../core/list/noteNames';

/** C4 = MIDI 60 (UI_DESIGN 4). */
export const pitchName = (pitch: number): string => noteName(pitch);

export function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitch % 12);
}

/**
 * Follow scrolling by whole bars: the left edge goes to the start of the bar that contains the
 * playhead (page-like, easier to read than a continuous scroll).
 */
export function barPageScrollLeft(sig: { tickToBarBeat(t: number): { bar: number }; barBeatToTick(bar: number): number }, tick: number, pxPerTick: number): number {
  return Math.max(0, sig.barBeatToTick(sig.tickToBarBeat(Math.max(0, tick)).bar) * pxPerTick);
}

/**
 * Loop (repeat) range on the ruler: a coloured band with a bar under it when looping is on, a
 * faint outline when it is off (so the range is visible before switching it on).
 */
export function drawLoopRuler(ctx: CanvasRenderingContext2D, loop: { enabled: boolean; startTick: number; endTick: number }, pxPerTick: number, viewX: number, rulerH: number, th: Theme): void {
  if (loop.endTick <= loop.startTick) return;
  const x0 = Math.round(loop.startTick * pxPerTick - viewX);
  const x1 = Math.round(loop.endTick * pxPerTick - viewX);
  ctx.save();
  if (loop.enabled) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = th.loopRuler;
    ctx.fillRect(x0, 0, x1 - x0, rulerH);
    ctx.globalAlpha = 1;
    ctx.fillRect(x0, rulerH - 4, x1 - x0, 4);
    // bracket ends
    ctx.fillRect(x0, 0, 2, rulerH);
    ctx.fillRect(x1 - 2, 0, 2, rulerH);
  } else {
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = th.loopRuler;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x0 + 0.5, 1.5, x1 - x0 - 1, rulerH - 3);
    ctx.setLineDash([]);
    ctx.fillStyle = th.loopRuler;
    ctx.fillRect(x0, rulerH - 4, x1 - x0, 4); // handle strip: drag to move the range (ADR-053)
  }
  ctx.restore();
}

/** BPM for display: up to 2 decimals, trailing zeros dropped (120, 98.5, 133.33). */
export function formatBpm(usPerQuarter: number): string {
  return String(shownBpm(usPerQuarter));
}

export interface ConductorMark {
  tick: number;
  kind: 'tempo' | 'signature' | 'key' | 'marker';
  text: string;
  usPerQuarter?: number;
}

const MAJOR_KEYS = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const MINOR_KEYS = ['A♭m', 'E♭m', 'B♭m', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F♯m', 'C♯m', 'G♯m', 'D♯m', 'A♯m'];

/** Key signature name from SMF FF 59 (sharps > 0, flats < 0): (1, false) → "G", (-3, true) → "Cm". */
export function keyName(sharpsFlats: number, minor: boolean): string {
  const name = (minor ? MINOR_KEYS : MAJOR_KEYS)[sharpsFlats + 7];
  return name ?? `${sharpsFlats}${minor ? 'm' : ''}`;
}

const KIND_ORDER: Record<ConductorMark['kind'], number> = { signature: 0, key: 1, tempo: 2, marker: 3 };

/**
 * Tempo, time-signature, key-signature changes and markers for display, sorted by tick (at one
 * tick: signature, key, tempo, marker). For tempo / signatures / keys, several events at one tick:
 * the last one wins (SMF semantics), and repeats of the current value are left out so only real
 * changes are marked. Every marker is listed.
 */
export function conductorMarks(conductor: readonly ConductorEvent[]): ConductorMark[] {
  const tempos = new Map<number, number>();
  const sigs = new Map<number, string>();
  const keys = new Map<number, string>();
  const out: ConductorMark[] = [];
  for (const e of conductor) {
    if (e.kind === 'tempo') tempos.set(e.tick, e.usPerQuarter);
    else if (e.kind === 'time-signature') sigs.set(e.tick, `${e.numerator}/${e.denominator}`);
    else if (e.kind === 'key-signature') keys.set(e.tick, keyName(e.sharpsFlats, e.minor));
    else if (e.kind === 'marker') out.push({ tick: e.tick, kind: 'marker', text: e.text || '(marker)' });
  }
  const changes = (m: Map<number, string>, kind: 'signature' | 'key') => {
    let last = '';
    for (const [tick, text] of [...m].sort((a, b) => a[0] - b[0])) {
      if (text !== last || tick === 0) out.push({ tick, kind, text: kind === 'key' ? `Key ${text}` : text });
      last = text;
    }
  };
  changes(sigs, 'signature');
  changes(keys, 'key');
  let lastUs = -1;
  for (const [tick, us] of [...tempos].sort((a, b) => a[0] - b[0])) {
    if (us !== lastUs) out.push({ tick, kind: 'tempo', text: `♩=${formatBpm(us)}`, usPerQuarter: us });
    lastUs = us;
  }
  return out.sort((a, b) => a.tick - b.tick || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

export function markColor(kind: ConductorMark['kind'], th: Theme): string {
  return kind === 'tempo' ? th.tempo : kind === 'signature' ? th.signature : kind === 'key' ? th.keysig : th.marker;
}

function pill(ctx: CanvasRenderingContext2D, x: number, cy: number, text: string, color: string, bold = false): number {
  ctx.font = `${bold ? '600 ' : ''}10px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 6;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = color;
  ctx.fillRect(x, cy - 7, w, 14);
  ctx.restore();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 3, cy + 0.5);
  return w;
}

/**
 * Tempo / time-signature labels on a bar ruler (piano roll, drum editor). `labelEnd(tick)` gives
 * the x where the bar number drawn at that tick ends (or -Infinity), so labels go after it.
 */
export function drawRulerConductorMarks(ctx: CanvasRenderingContext2D, marks: readonly ConductorMark[], pxPerTick: number, viewX: number, viewW: number, rulerH: number, th: Theme, labelEnd: (tick: number) => number): void {
  let nextFree = -Infinity;
  for (const m of marks) {
    const mx = m.tick * pxPerTick - viewX;
    if (mx > viewW) break;
    const x = Math.max(mx + 2, labelEnd(m.tick) + 3, nextFree);
    if (x > viewW) break;
    // a small tick at the exact position when the label had to move right
    const color = markColor(m.kind, th);
    ctx.fillStyle = color;
    if (x - mx > 4 && mx >= 0) ctx.fillRect(Math.round(mx), rulerH - 5, 1, 4);
    const text = m.text.length > 16 ? `${m.text.slice(0, 15)}…` : m.text;
    const w = pill(ctx, x, rulerH / 2, text, color, m.kind !== 'tempo');
    nextFree = x + w + 2;
    if (x + w < 0) nextFree = -Infinity;
  }
}

/**
 * The tempo lane of the track view: the tempo as a step graph (scaled between the song's lowest
 * and highest tempo) with the BPM written at each change. The tempo in effect at the left edge is
 * always labelled, so a long passage without changes still says its tempo.
 */
export function drawTempoLane(ctx: CanvasRenderingContext2D, marks: readonly ConductorMark[], pxPerTick: number, viewX: number, viewW: number, y0: number, h: number, th: Theme): void {
  const tempos = marks.filter((m) => m.kind === 'tempo');
  if (tempos.length === 0 || tempos[0].tick > 0) tempos.unshift({ tick: 0, kind: 'tempo', text: `♩=${formatBpm(DEFAULT_TEMPO_US)}`, usPerQuarter: DEFAULT_TEMPO_US });
  const bpms = tempos.map((t) => bpmFromUs(t.usPerQuarter!));
  const lo = Math.min(...bpms);
  const hi = Math.max(...bpms);
  const top = y0 + 4;
  const bottom = y0 + h - 4;
  const yOf = (bpm: number) => (hi === lo ? (top + bottom) / 2 : bottom - ((bpm - lo) / (hi - lo)) * (bottom - top));
  // step graph
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y0, viewW, h);
  ctx.clip();
  ctx.beginPath();
  // the graph starts at the first tempo (tick 0 sits after the margin before bar 1), not at the canvas edge
  ctx.moveTo(Math.max(-1, tempos[0].tick * pxPerTick - viewX), bottom + 4);
  for (let i = 0; i < tempos.length; i++) {
    const x0 = tempos[i].tick * pxPerTick - viewX;
    const x1 = i + 1 < tempos.length ? tempos[i + 1].tick * pxPerTick - viewX : viewW + 1;
    if (x1 < -1) continue;
    const y = yOf(bpms[i]);
    ctx.lineTo(Math.max(-1, x0), y);
    ctx.lineTo(Math.min(viewW + 1, x1), y);
    if (x0 > viewW) break;
  }
  ctx.lineTo(viewW + 1, bottom + 4);
  ctx.closePath();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = th.tempo;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.tempo;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < tempos.length; i++) {
    const x0 = tempos[i].tick * pxPerTick - viewX;
    const x1 = i + 1 < tempos.length ? tempos[i + 1].tick * pxPerTick - viewX : viewW + 1;
    if (x1 < -1) continue;
    if (x0 > viewW) break;
    const y = yOf(bpms[i]);
    if (i === 0 || x0 < -1) ctx.moveTo(Math.max(-1, x0), y);
    else ctx.lineTo(x0, y);
    ctx.lineTo(Math.min(viewW + 1, x1), y);
  }
  ctx.stroke();
  ctx.lineWidth = 1;
  // labels: the one in effect at the left edge, then each change (skipped when crowded)
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  let nextFree = -Infinity;
  for (let i = 0; i < tempos.length; i++) {
    const x0 = tempos[i].tick * pxPerTick - viewX;
    const x1 = i + 1 < tempos.length ? tempos[i + 1].tick * pxPerTick - viewX : Infinity;
    if (x1 <= 0) continue;
    if (x0 > viewW) break;
    const x = Math.max(2, x0 + 2);
    const text = tempos[i].text.slice(2); // number only; the lane is labelled ♩
    const w = ctx.measureText(text).width;
    // crowded (label would overlap the previous one or run past the next change): the step in
    // the line still shows the change; the value is in the List editor's tempo track
    if (x < nextFree || x + w > x1 - 2) continue;
    const y = yOf(bpms[i]);
    const ty = y - top > 9 ? y - 6 : y + 7;
    ctx.fillStyle = th.text;
    ctx.fillText(text, x, ty);
    nextFree = x + w + 6;
  }
  ctx.restore();
}

/**
 * The marker lane of the track view: a flag line at each marker with its text, cut off where the
 * next marker starts. The marker in effect at the left edge stays visible there.
 */
export function drawMarkerLane(ctx: CanvasRenderingContext2D, marks: readonly ConductorMark[], pxPerTick: number, viewX: number, viewW: number, y0: number, h: number, th: Theme): void {
  const markers = marks.filter((m) => m.kind === 'marker');
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y0, viewW, h);
  ctx.clip();
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < markers.length; i++) {
    const x0 = markers[i].tick * pxPerTick - viewX;
    const x1 = i + 1 < markers.length ? markers[i + 1].tick * pxPerTick - viewX : Infinity;
    if (x1 <= 0) continue;
    if (x0 > viewW) break;
    if (x0 >= 0) {
      ctx.fillStyle = th.marker;
      ctx.fillRect(Math.round(x0), y0 + 2, 2, h - 4);
    }
    const x = Math.max(4, x0 + 5);
    const room = Math.min(x1, viewW) - x - 4;
    if (room < 8) continue;
    let text = markers[i].text;
    while (text.length > 1 && ctx.measureText(text).width > room) text = text.slice(0, -2) + '…';
    ctx.fillStyle = th.marker;
    ctx.fillText(text, x, y0 + h / 2 + 0.5);
  }
  ctx.restore();
}

/** Faint full-height lines at the markers (section boundaries) over the track lanes. */
export function drawMarkerLines(ctx: CanvasRenderingContext2D, marks: readonly ConductorMark[], pxPerTick: number, viewX: number, viewW: number, y0: number, y1: number, th: Theme): void {
  ctx.save();
  ctx.strokeStyle = th.marker;
  ctx.globalAlpha = 0.45;
  ctx.setLineDash([3, 3]);
  for (const m of marks) {
    if (m.kind !== 'marker') continue;
    const x = Math.round(m.tick * pxPerTick - viewX) + 0.5;
    if (x < 0 || x > viewW) continue;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
  }
  ctx.restore();
}

/** The playhead line (theme colour) over the full height of an overlay canvas. */
export function drawPlayhead(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, x: number, height: number): void {
  ctx.strokeStyle = readTheme(canvas).playhead;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
}

/** The shared step-recording cursor (INPUT_RECORDING 6): dashed green line. */
export function drawStepCursor(ctx: CanvasRenderingContext2D, x: number, height: number): void {
  ctx.strokeStyle = '#27ae60';
  ctx.setLineDash([5, 3]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.setLineDash([]);
}


/**
 * Chord names in a strip (ADR-090): a thin line at each change and the name clipped to its span.
 * Only the segments between t0 and t1 are drawn. The current chord is tinted by the caller.
 */
export function drawChordStrip(
  ctx: CanvasRenderingContext2D,
  segments: readonly ChordSegment[],
  x: (tick: number) => number,
  t0: number,
  t1: number,
  y: number,
  h: number,
  colors: { text: string; line: string },
  font = '11px system-ui, sans-serif',
): void {
  // from the segment holding t0 (segments are sorted and do not overlap)
  const first = Math.max(0, chordIndexAtOrBefore(segments, t0));
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = 'middle';
  for (let i = first; i < segments.length && segments[i].tick <= t1; i++) {
    const s = segments[i];
    if (s.endTick <= t0) continue;
    const x0 = x(s.tick);
    const x1 = x(s.endTick);
    ctx.fillStyle = colors.line;
    ctx.fillRect(Math.round(x0), y + 2, 1, h - 4);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 + 1, y, Math.max(0, x1 - x0 - 2), h);
    ctx.clip();
    ctx.fillStyle = colors.text;
    ctx.fillText(s.name, x0 + 4, y + h / 2);
    ctx.restore();
  }
  ctx.restore();
}
