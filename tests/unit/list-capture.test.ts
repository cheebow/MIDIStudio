// LIST-07: pitch capture state machine (ADR-066 追記): first key -> K# of the row, held keys -> chord, release -> advance.
import { describe, expect, it } from 'vitest';
import { CAPTURE_IDLE, captureInserted, captureStep, type CaptureState } from '../../src/core/list/listCapture';

const row = { id: 'r1', tick: 480, key: 60 };
const on = (pitch: number, velocity = 100) => ({ type: 'note-on' as const, pitch, velocity });
const off = (pitch: number) => ({ type: 'note-off' as const, pitch });

describe('list pitch capture (LIST-07)', () => {
  it('a single key rewrites the row and advances on release', () => {
    let s: CaptureState = CAPTURE_IDLE;
    let r = captureStep(s, on(62), row, true);
    expect(r.actions).toEqual([{ type: 'set-key', rowId: 'r1', pitch: 62, velocity: 100 }]);
    s = r.state;
    r = captureStep(s, off(62), row, true);
    expect(r.actions).toEqual([{ type: 'advance', afterIds: ['r1'] }]);
    expect(r.state).toEqual(CAPTURE_IDLE);
  });

  it('keys held together form a chord at the row position; the cursor advances past every inserted note', () => {
    let s: CaptureState = CAPTURE_IDLE;
    s = captureStep(s, on(60), row, true).state;
    let r = captureStep(s, on(64, 90), row, true);
    expect(r.actions).toEqual([{ type: 'insert', likeRowId: 'r1', tick: 480, pitch: 64, velocity: 90 }]);
    s = captureInserted(r.state, 'n2');
    r = captureStep(s, on(67), { id: 'other', tick: 0, key: 50 }, true); // the current row changed meanwhile: still the same chord
    expect(r.actions).toEqual([{ type: 'insert', likeRowId: 'r1', tick: 480, pitch: 67, velocity: 100 }]);
    s = captureInserted(r.state, 'n3');
    expect(captureStep(s, off(64), row, true).actions).toEqual([]);
    s = captureStep(s, off(64), row, true).state;
    s = captureStep(s, off(60), row, true).state;
    r = captureStep(s, off(67), row, true);
    expect(r.actions).toEqual([{ type: 'advance', afterIds: ['r1', 'n2', 'n3'] }]);
    expect(r.state).toEqual(CAPTURE_IDLE);
  });

  it('a row without a K#, an empty list, or a passive list writes nothing; releases without a chord are ignored', () => {
    expect(captureStep(CAPTURE_IDLE, on(60), { id: 'cc', tick: 0, key: null }, true).actions).toEqual([{ type: 'no-key-row' }]);
    expect(captureStep(CAPTURE_IDLE, on(60), null, true).actions).toEqual([{ type: 'no-key-row' }]);
    expect(captureStep(CAPTURE_IDLE, on(60), row, false)).toEqual({ state: CAPTURE_IDLE, actions: [] });
    expect(captureStep(CAPTURE_IDLE, off(60), row, true)).toEqual({ state: CAPTURE_IDLE, actions: [] });
    // the key that hit a CC row is held: its release must not advance anything
    const s = captureStep(CAPTURE_IDLE, on(60), { id: 'cc', tick: 0, key: null }, true).state;
    expect(captureStep(s, off(60), row, true)).toEqual({ state: CAPTURE_IDLE, actions: [] });
  });
});
