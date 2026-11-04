// Step length changes from the keyboard (INPUT_RECORDING 6, ADR-076): halve / double the step,
// toggle dotted / triplet. Pure: the step length is a tick count in the project settings, so this
// maps it back to a grid value (1/8, 1/8., 1/8T ...) and moves within the grid table. A result
// that would not be a whole number of ticks at this PPQ is refused with a reason instead of being
// rounded (rule 4: integer ticks).
import { GRID_DIVISIONS, gridTicks, type GridKind, type GridSpec } from '../timing/grid';

export type StepLengthChange = 'halve' | 'double' | 'dotted' | 'triplet';

export type StepLengthResult =
  | { ok: true; ticks: number; spec: GridSpec | null }
  | { ok: false; reason: 'not-grid' | 'out-of-range' | 'inexact' };

const KINDS: readonly GridKind[] = ['straight', 'dotted', 'triplet'];

/** The grid value whose length is exactly `ticks` at this PPQ, or null for a free tick count. */
export function stepLengthSpec(ppq: number, ticks: number): GridSpec | null {
  for (const division of GRID_DIVISIONS)
    for (const kind of KINDS) {
      const t = gridTicks(ppq, { division, kind });
      if (t.den === 1 && t.num === ticks) return { division, kind };
    }
  return null;
}

function fromSpec(ppq: number, spec: GridSpec): StepLengthResult {
  const t = gridTicks(ppq, spec);
  if (t.den !== 1) return { ok: false, reason: 'inexact' };
  return { ok: true, ticks: t.num, spec };
}

export function changeStepLength(ppq: number, ticks: number, change: StepLengthChange): StepLengthResult {
  const spec = stepLengthSpec(ppq, ticks);
  if (change === 'halve' || change === 'double') {
    if (!spec) {
      // a free tick count (not on the grid table): plain arithmetic, still whole ticks only
      if (change === 'double') return { ok: true, ticks: ticks * 2, spec: null };
      if (ticks % 2 !== 0 || ticks < 2) return { ok: false, reason: 'inexact' };
      return { ok: true, ticks: ticks / 2, spec: null };
    }
    const i = GRID_DIVISIONS.indexOf(spec.division as (typeof GRID_DIVISIONS)[number]) + (change === 'halve' ? 1 : -1);
    if (i < 0 || i >= GRID_DIVISIONS.length) return { ok: false, reason: 'out-of-range' };
    return fromSpec(ppq, { division: GRID_DIVISIONS[i], kind: spec.kind });
  }
  if (!spec) return { ok: false, reason: 'not-grid' };
  // dotted ↔ straight, triplet ↔ straight; dotted on a triplet (or the reverse) replaces it
  const kind: GridKind = spec.kind === change ? 'straight' : change;
  return fromSpec(ppq, { division: spec.division, kind });
}
