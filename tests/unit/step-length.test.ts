import { describe, expect, it } from 'vitest';
import { changeStepLength, stepLengthSpec } from '../../src/core/recording/stepLength';

describe('step length keys (ADR-076)', () => {
  it('maps a tick count back to its grid value', () => {
    expect(stepLengthSpec(480, 240)).toEqual({ division: 8, kind: 'straight' });
    expect(stepLengthSpec(480, 360)).toEqual({ division: 8, kind: 'dotted' });
    expect(stepLengthSpec(480, 160)).toEqual({ division: 8, kind: 'triplet' });
    expect(stepLengthSpec(480, 1920)).toEqual({ division: 1, kind: 'straight' });
    expect(stepLengthSpec(480, 250)).toBeNull();
  });

  it('halves and doubles along the grid table, keeping dotted / triplet', () => {
    expect(changeStepLength(480, 240, 'halve')).toEqual({ ok: true, ticks: 120, spec: { division: 16, kind: 'straight' } });
    expect(changeStepLength(480, 240, 'double')).toEqual({ ok: true, ticks: 480, spec: { division: 4, kind: 'straight' } });
    expect(changeStepLength(480, 360, 'halve')).toEqual({ ok: true, ticks: 180, spec: { division: 16, kind: 'dotted' } });
    expect(changeStepLength(480, 160, 'double')).toEqual({ ok: true, ticks: 320, spec: { division: 4, kind: 'triplet' } });
  });

  it('stops at 1/1 and 1/64', () => {
    expect(changeStepLength(480, 1920, 'double')).toEqual({ ok: false, reason: 'out-of-range' });
    expect(changeStepLength(480, 30, 'halve')).toEqual({ ok: false, reason: 'out-of-range' });
  });

  it('toggles dotted and triplet; one replaces the other', () => {
    expect(changeStepLength(480, 240, 'dotted')).toEqual({ ok: true, ticks: 360, spec: { division: 8, kind: 'dotted' } });
    expect(changeStepLength(480, 360, 'dotted')).toEqual({ ok: true, ticks: 240, spec: { division: 8, kind: 'straight' } });
    expect(changeStepLength(480, 240, 'triplet')).toEqual({ ok: true, ticks: 160, spec: { division: 8, kind: 'triplet' } });
    expect(changeStepLength(480, 160, 'triplet')).toEqual({ ok: true, ticks: 240, spec: { division: 8, kind: 'straight' } });
    expect(changeStepLength(480, 160, 'dotted')).toEqual({ ok: true, ticks: 360, spec: { division: 8, kind: 'dotted' } });
    expect(changeStepLength(480, 360, 'triplet')).toEqual({ ok: true, ticks: 160, spec: { division: 8, kind: 'triplet' } });
  });

  it('refuses a result that is not a whole tick at this PPQ instead of rounding', () => {
    // PPQ 96: 1/64 = 6 ticks, 1/64 triplet = 4, 1/32 triplet = 8 → fine; 1/64 dotted = 9 → fine; PPQ 100: 1/16 triplet = 50/3
    expect(changeStepLength(100, 25, 'triplet')).toEqual({ ok: false, reason: 'inexact' });
    expect(changeStepLength(100, 25, 'dotted')).toEqual({ ok: false, reason: 'inexact' }); // 37.5
    expect(changeStepLength(100, 25, 'halve')).toEqual({ ok: false, reason: 'inexact' }); // 1/32 = 12.5
  });

  it('a free tick count (not on the table) halves / doubles arithmetically and cannot be dotted', () => {
    expect(changeStepLength(480, 250, 'double')).toEqual({ ok: true, ticks: 500, spec: null });
    expect(changeStepLength(480, 250, 'halve')).toEqual({ ok: true, ticks: 125, spec: null });
    expect(changeStepLength(480, 125, 'halve')).toEqual({ ok: false, reason: 'inexact' });
    expect(changeStepLength(480, 250, 'dotted')).toEqual({ ok: false, reason: 'not-grid' });
    expect(changeStepLength(480, 250, 'triplet')).toEqual({ ok: false, reason: 'not-grid' });
  });
});
