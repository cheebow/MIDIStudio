// Horizontal zoom steps shared by the View menu, the on-screen − / + buttons and ⌘+wheel.
import type { ProjectViewSettings } from '../core/model/types';

export const ZOOM_STEP = 1.25;
/** arrangement: pixels per quarter note */
export const ARRANGEMENT_ZOOM = { min: 2, max: 400 } as const;
/** piano roll / drum editor: pixels per quarter note */
export const PIANO_ROLL_ZOOM = { min: 10, max: 800 } as const;

export function arrangementZoomPatch(s: ProjectViewSettings, dir: 'in' | 'out'): Partial<ProjectViewSettings> {
  const z = dir === 'in' ? s.horizontalZoom * ZOOM_STEP : s.horizontalZoom / ZOOM_STEP;
  return { horizontalZoom: Math.min(ARRANGEMENT_ZOOM.max, Math.max(ARRANGEMENT_ZOOM.min, z)) };
}

export function pianoRollZoomPatch(s: ProjectViewSettings, dir: 'in' | 'out'): Partial<ProjectViewSettings> {
  const z = dir === 'in' ? s.pianoRollZoom * ZOOM_STEP : s.pianoRollZoom / ZOOM_STEP;
  return { pianoRollZoom: Math.round(Math.min(PIANO_ROLL_ZOOM.max, Math.max(PIANO_ROLL_ZOOM.min, z))) };
}
