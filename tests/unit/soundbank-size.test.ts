// ADR-070: a sound bank larger than the limit is refused with a reason instead of crashing the tab.
import { describe, expect, it } from 'vitest';
import { MAX_SOUND_BANK_BYTES, soundBankSizeError } from '../../src/playback/SoundFontLoader';

describe('soundBankSizeError (ADR-070)', () => {
  it('accepts banks up to the limit, including the large GM banks', () => {
    expect(soundBankSizeError(0)).toBeNull();
    expect(soundBankSizeError(32 * 1024 * 1024)).toBeNull(); // GeneralUser GS
    expect(soundBankSizeError(400 * 1024 * 1024)).toBeNull();
    expect(soundBankSizeError(MAX_SOUND_BANK_BYTES)).toBeNull();
  });

  it('refuses a larger bank and says how large it is and what the limit is', () => {
    const m = soundBankSizeError(MAX_SOUND_BANK_BYTES + 1);
    expect(m).not.toBeNull();
    expect(m).toContain('512 MiB');
    expect(soundBankSizeError(2 * 1024 * 1024 * 1024)).toContain('2048 MiB');
  });
});
