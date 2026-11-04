// ADR-074: the startup dialog names the connected MIDI devices so "use / don't use" has a referent.
import { describe, expect, it } from 'vitest';
import { connectedDevices } from '../../src/app/dialogs/StartupDialog';
import { setLocale } from '../../src/i18n';

describe('startup dialog: connected MIDI devices (ADR-074)', () => {
  it('lists the names, and folds the rest into a count', () => {
    setLocale('ja');
    expect(connectedDevices([])).toBe('接続している機器はありません');
    expect(connectedDevices(['KeyStep 37'])).toBe('接続中: KeyStep 37');
    expect(connectedDevices(['KeyStep 37', 'nanoKEY2', 'MPK mini'])).toBe('接続中: KeyStep 37、nanoKEY2、MPK mini');
    expect(connectedDevices(['A', 'B', 'C', 'D', 'E'])).toBe('接続中: A、B、C ほか 2 台');
  });

  it('reads naturally in English too', () => {
    setLocale('en');
    try {
      expect(connectedDevices(['A', 'B', 'C', 'D'])).toBe('Connected: A, B, C and 1 more');
    } finally {
      setLocale('ja');
    }
  });
});
