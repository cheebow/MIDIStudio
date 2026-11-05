// ADR-087: core bugs found in the third review (whole-codebase pass).
import { describe, expect, it } from 'vitest';
import { openMidiFile } from '../../src/core/project-io/midiFile';
import { build, on, meta, tempo } from '../fixtures/songs';

describe('r3 core d', () => {
  it('a malformed tempo meta (length 4) is kept with a warning, not a whole-file error', () => {
    const bytes = build(1, 480, [tempo(0, 500000), meta(1920, 0x51, [0x07, 0xa1, 0x20, 0x00])], [on(0, 0, 60), [480, 0x80, 60, 64]]);
    const o = openMidiFile(bytes);
    expect(o.ok).toBe(true);
  });
});
