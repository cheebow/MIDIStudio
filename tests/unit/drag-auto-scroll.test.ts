import { describe, expect, it } from 'vitest';
import { AUTO_SCROLL_EDGE_PX, AUTO_SCROLL_MAX_PX_PER_S, edgeScrollSpeed } from '../../src/ui/dragAutoScroll';

describe('edgeScrollSpeed (ADR-068)', () => {
  it('does not scroll in the middle of the area', () => {
    expect(edgeScrollSpeed(200, 0, 400)).toBe(0);
    expect(edgeScrollSpeed(AUTO_SCROLL_EDGE_PX, 0, 400)).toBe(0);
    expect(edgeScrollSpeed(400 - AUTO_SCROLL_EDGE_PX, 0, 400)).toBe(0);
  });

  it('scrolls back near the start and forward near the end, faster the deeper', () => {
    expect(edgeScrollSpeed(20, 0, 400)).toBeLessThan(0);
    expect(edgeScrollSpeed(380, 0, 400)).toBeGreaterThan(0);
    expect(Math.abs(edgeScrollSpeed(0, 0, 400))).toBeGreaterThan(Math.abs(edgeScrollSpeed(20, 0, 400)));
    expect(edgeScrollSpeed(420, 0, 400)).toBeGreaterThan(edgeScrollSpeed(390, 0, 400));
  });

  it('keeps scrolling past the edge, up to the maximum', () => {
    expect(edgeScrollSpeed(-1000, 0, 400)).toBe(-AUTO_SCROLL_MAX_PX_PER_S);
    expect(edgeScrollSpeed(5000, 0, 400)).toBe(AUTO_SCROLL_MAX_PX_PER_S);
  });

  it('is gentle at the edge itself (px per second)', () => {
    expect(edgeScrollSpeed(400, 0, 400)).toBe(288);
    expect(edgeScrollSpeed(0, 0, 400)).toBe(-288);
  });

  it('never scrolls an area too small to have a calm middle', () => {
    expect(edgeScrollSpeed(0, 0, AUTO_SCROLL_EDGE_PX * 2)).toBe(0);
  });
});
