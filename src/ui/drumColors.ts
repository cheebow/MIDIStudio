// Colours per drum instrument: hue by kit group, lightness varied by pitch within the group, so
// kick / snare / hi-hat / toms / cymbals are told apart at a glance.
import type { DrumMap, DrumMapEntry } from '../core/gm/drumMaps';

const HUE: Record<DrumMapEntry['group'], number> = { kick: 4, snare: 30, hihat: 50, tom: 135, cymbal: 190, percussion: 265, fx: 320 };

export function drumColor(map: DrumMap, pitch: number): string {
  const entry = map.entries.find((e) => e.pitch === pitch);
  const group = entry?.group ?? 'percussion';
  const same = map.entries.filter((e) => e.group === group);
  const i = Math.max(0, same.findIndex((e) => e.pitch === pitch));
  const light = 46 + ((i * 9) % 22); // 46..67%
  return `hsl(${HUE[group] + ((i * 7) % 18)}, 72%, ${light}%)`;
}
