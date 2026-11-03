// Key assignment (REQ-IN-02/03, UI_DESIGN 9): physical keys per slot, JIS / US labels, conflicts.
import { useEffect, useState } from 'react';
import { defaultInputPresets } from '../../core/model/defaults';
import type { KeyMap, SavedInputPresets } from '../../core/model/types';
import { GM_DRUM_MAP, drumName } from '../../core/gm/drumMaps';
import { reassignKey } from '../../input/KeyboardRouter';
import { keyLabel } from '../../input/keyLabels';
import { pitchName } from '../canvas';
import { t } from '../../i18n';

type MapKey = 'pianoKeys' | 'drumPadKeys' | 'numpadKeys';
const RESERVED = new Set(['Escape', 'Space', 'Tab', 'Enter', 'MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'CapsLock']);

export function KeyBindings({ presets, onChange }: { presets: SavedInputPresets; onChange: (p: SavedInputPresets) => void }) {
  const [waiting, setWaiting] = useState<{ map: MapKey; code: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!waiting) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setWaiting(null);
        return;
      }
      if (RESERVED.has(e.code)) {
        setMessage(t('{code} はショートカット・ブラウザ操作に使うため割り当てられません。', { code: e.code }));
        return;
      }
      const map = presets[waiting.map];
      const conflicts = (['pianoKeys', 'drumPadKeys', 'numpadKeys'] as MapKey[]).filter((m) => m !== waiting.map && presets[m][e.code] !== undefined);
      onChange({ ...presets, [waiting.map]: reassignKey(map, waiting.code, e.code) });
      setMessage(conflicts.length ? t('{key} は別の割り当て（{maps}）にも使われています。演奏中は入力モードで使い分けられます。', { key: keyLabel(e.code, presets.layout), maps: conflicts.join(', ') }) : null);
      setWaiting(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [waiting, presets, onChange]);

  const table = (title: string, mapKey: MapKey, name: (pitch: number) => string) => {
    const map: KeyMap = presets[mapKey];
    const rows = Object.entries(map).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    return (
      <section>
        <h3>{title}</h3>
        <table className="summary">
          <tbody>
            {rows.map(([code, pitch]) => (
              <tr key={code}>
                <td>{name(pitch)}</td>
                <td>
                  <kbd>{keyLabel(code, presets.layout)}</kbd> <span className="note">{code}</span>
                </td>
                <td>
                  <button onClick={() => setWaiting({ map: mapKey, code })} aria-label={t('{name} のキーを変更', { name: name(pitch) })}>
                    {waiting?.map === mapKey && waiting.code === code ? t('キーを押してください…（Esc で中止）') : t('変更')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  };

  return (
    <div className="key-bindings">
      <div className="row">
        <label>
          {t('キーボード配列（表示）')}{' '}
          <select value={presets.layout} onChange={(e) => onChange({ ...presets, layout: e.target.value as 'jis' | 'us' })}>
            <option value="jis">{t('JIS（日本語）')}</option>
            <option value="us">US</option>
          </select>
        </label>
        <label>
          Velocity <input type="number" min={1} max={127} value={presets.defaultVelocity} onChange={(e) => onChange({ ...presets, defaultVelocity: Math.max(1, Math.min(127, Number(e.target.value) || 100)) })} />
        </label>
        <label>
          {t('アクセント（Shift）')}{' '}
          <input type="number" min={1} max={127} value={presets.accentVelocity} onChange={(e) => onChange({ ...presets, accentVelocity: Math.max(1, Math.min(127, Number(e.target.value) || 120)) })} />
        </label>
        <button onClick={() => onChange(defaultInputPresets())}>{t('既定に戻す')}</button>
      </div>
      <p className="note">{t('キーは物理的な位置（KeyboardEvent.code）で記録します。配列の切替は表示だけを変えます。PC キーボードには打鍵の強さがないため、固定 Velocity と Shift のアクセントを使います。')}</p>
      {message && <p className="warn-text">{message}</p>}
      {table(t('ドラムパッド（文字キー、テンキーなし PC 向け）'), 'drumPadKeys', (p) => `${p} ${drumName(GM_DRUM_MAP, p)}`)}
      {table(t('ドラムパッド（テンキー）'), 'numpadKeys', (p) => `${p} ${drumName(GM_DRUM_MAP, p)}`)}
      {table(t('PC 鍵盤（オクターブ移動前）'), 'pianoKeys', (p) => `${pitchName(p)} (${p})`)}
    </div>
  );
}
