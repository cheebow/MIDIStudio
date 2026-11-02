// Semantic SMF comparison (REQ-MIDI-03 / C13): files are equal when the same MIDI messages,
// SysEx and meta events happen at the same ticks on the same port/channel, regardless of byte
// layout, running status, track split or chunk order.
import type { SmfFile } from './types';

/** Metas that only describe the file layout: compared separately or not at all. */
const LAYOUT_META = new Set([0x03, 0x21, 0x2f]);

interface Normalized {
  ppq: number;
  /** tick -> key -> ordered payloads */
  byTick: Map<number, Map<string, string[]>>;
  endTick: number;
}

const hex = (bytes: ArrayLike<number>) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function normalize(f: SmfFile): Normalized {
  const byTick = new Map<number, Map<string, string[]>>();
  let endTick = 0;
  const add = (tick: number, key: string, payload: string) => {
    let m = byTick.get(tick);
    if (!m) byTick.set(tick, (m = new Map()));
    const list = m.get(key);
    if (list) list.push(payload);
    else m.set(key, [payload]);
  };
  for (const t of f.tracks) {
    let port = 0;
    endTick = Math.max(endTick, t.endOfTrackTick);
    for (const e of t.events) {
      endTick = Math.max(endTick, e.tick);
      if (e.kind === 'channel') add(e.tick, `ch:${port}:${e.status & 0x0f}`, hex([e.status, ...e.data]));
      else if (e.kind === 'sysex') add(e.tick, `sysex:${port}`, `${e.status.toString(16)}:${hex(e.data)}`);
      else if (e.metaType === 0x21 && e.data.length === 1) port = e.data[0];
      else if (!LAYOUT_META.has(e.metaType)) add(e.tick, `meta:${e.metaType}`, hex(e.data));
    }
  }
  // Meta events from different tracks have no defined relative order: compare as multisets.
  for (const m of byTick.values()) for (const [k, v] of m) if (k.startsWith('meta:')) v.sort();
  return { ppq: f.ppq, byTick, endTick };
}

export interface SemanticDiff {
  equal: boolean;
  differences: string[];
}

export function compareSmfSemantics(a: SmfFile, b: SmfFile, maxDifferences = 20): SemanticDiff {
  const differences: string[] = [];
  const na = normalize(a);
  const nb = normalize(b);
  if (na.ppq !== nb.ppq) differences.push(`PPQ が異なります: ${na.ppq} / ${nb.ppq}`);
  if (na.endTick !== nb.endTick) differences.push(`曲の終わり（End of Track）が異なります: ${na.endTick} / ${nb.endTick}`);
  const ticks = [...new Set([...na.byTick.keys(), ...nb.byTick.keys()])].sort((x, y) => x - y);
  for (const tick of ticks) {
    const ma = na.byTick.get(tick) ?? new Map<string, string[]>();
    const mb = nb.byTick.get(tick) ?? new Map<string, string[]>();
    for (const key of new Set([...ma.keys(), ...mb.keys()])) {
      const la = ma.get(key) ?? [];
      const lb = mb.get(key) ?? [];
      if (la.join(',') !== lb.join(',')) {
        differences.push(`Tick ${tick} ${key}: [${la.join(' ')}] ≠ [${lb.join(' ')}]`);
        if (differences.length >= maxDifferences) return { equal: false, differences };
      }
    }
  }
  return { equal: differences.length === 0, differences };
}
