// Key assignment (REQ-IN-02/03, UI_DESIGN 9): physical keys per slot, JIS / US labels, conflicts.
import { useEffect, useState } from 'react';
import { defaultInputPresets } from '../../core/model/defaults';
import type { KeyMap, SavedInputPresets } from '../../core/model/types';
import { GM_DRUM_MAP, drumName } from '../../core/gm/drumMaps';
import { reassignKey } from '../../input/KeyboardRouter';
import { keyLabel } from '../../input/keyLabels';
import { pitchName } from '../canvas';

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
        setMessage(`${e.code} はショートカット・ブラウザ操作に使うため割り当てられません。`);
        return;
      }
      const map = presets[waiting.map];
      const conflicts = (['pianoKeys', 'drumPadKeys', 'numpadKeys'] as MapKey[]).filter((m) => m !== waiting.map && presets[m][e.code] !== undefined);
      onChange({ ...presets, [waiting.map]: reassignKey(map, waiting.code, e.code) });
      setMessage(conflicts.length ? `${keyLabel(e.code, presets.layout)} は別の割り当て（${conflicts.join(', ')}）にも使われています。演奏中は入力モードで使い分けられます。` : null);
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
                  <button onClick={() => setWaiting({ map: mapKey, code })} aria-label={`${name(pitch)} のキーを変更`}>
                    {waiting?.map === mapKey && waiting.code === code ? 'キーを押してください…（Esc で中止）' : '変更'}
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
          キーボード配列（表示）{' '}
          <select value={presets.layout} onChange={(e) => onChange({ ...presets, layout: e.target.value as 'jis' | 'us' })}>
            <option value="jis">JIS（日本語）</option>
            <option value="us">US</option>
          </select>
        </label>
        <label>
          Velocity <input type="number" min={1} max={127} value={presets.defaultVelocity} onChange={(e) => onChange({ ...presets, defaultVelocity: Math.max(1, Math.min(127, Number(e.target.value) || 100)) })} />
        </label>
        <label>
          アクセント（Shift）{' '}
          <input type="number" min={1} max={127} value={presets.accentVelocity} onChange={(e) => onChange({ ...presets, accentVelocity: Math.max(1, Math.min(127, Number(e.target.value) || 120)) })} />
        </label>
        <button onClick={() => onChange(defaultInputPresets())}>既定に戻す</button>
      </div>
      <p className="note">キーは物理的な位置（KeyboardEvent.code）で記録します。配列の切替は表示だけを変えます。PC キーボードには打鍵の強さがないため、固定 Velocity と Shift のアクセントを使います。</p>
      {message && <p className="warn-text">{message}</p>}
      {table('ドラムパッド（文字キー、テンキーなし PC 向け）', 'drumPadKeys', (p) => `${p} ${drumName(GM_DRUM_MAP, p)}`)}
      {table('ドラムパッド（テンキー）', 'numpadKeys', (p) => `${p} ${drumName(GM_DRUM_MAP, p)}`)}
      {table('PC 鍵盤（オクターブ移動前）', 'pianoKeys', (p) => `${pitchName(p)} (${p})`)}
    </div>
  );
}
