import { describe, expect, it } from 'vitest';
import { AUTO_SCROLL_EDGE_PX, AUTO_SCROLL_MAX_PX_PER_S, autoScrollStep, edgeScrollSpeed } from '../../src/ui/dragAutoScroll';

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

describe('autoScrollStep (ADR-068)', () => {
  const run = (hz: number, seconds: number, speedX: number, speedY = 0) => {
    const carry = { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    for (let i = 0; i < hz * seconds; i++) {
      const { dx, dy } = autoScrollStep(carry, speedX, speedY, 1000 / hz);
      x += dx;
      y += dy;
    }
    return { x, y };
  };

  it('scrolls the same distance per second at 60 Hz and 120 Hz', () => {
    expect(run(60, 1, 288).x).toBe(run(120, 1, 288).x);
    expect(Math.abs(run(120, 1, 288).x - 288)).toBeLessThanOrEqual(1);
  });

  it('carries fractions of a px, so a slow speed still moves (and backwards too)', () => {
    // 30 px/s at 120 Hz is 0.25 px per frame: whole browsers would never move without the carry
    expect(run(120, 1, 30).x).toBeGreaterThanOrEqual(29);
    expect(run(120, 1, -30, -30).x).toBeLessThanOrEqual(-29);
    expect(run(120, 1, -30, -30).y).toBeLessThanOrEqual(-29);
  });

  it('does not jump after a stalled frame', () => {
    const carry = { x: 0, y: 0 };
    expect(autoScrollStep(carry, AUTO_SCROLL_MAX_PX_PER_S, 0, 5000).dx).toBeLessThanOrEqual(AUTO_SCROLL_MAX_PX_PER_S * 0.1);
    expect(autoScrollStep({ x: 0, y: 0 }, 300, 0, -16).dx).toBe(0); // clock going backwards: nothing
  });
});
