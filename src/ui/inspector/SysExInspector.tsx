// SysEx / event inspector (MIDI_GS_SPEC 5): tick, track / port, maker, length, hex, GS meaning and
// whether the built-in engine processes it. Raw hex editing for anything.
import { useState } from 'react';
import { t } from '../../i18n';
import { base64ToBytes } from '../../core/model/base64';
import { decodeGs } from '../../core/gs/gsSysex';
import { setGsValue, setSysExPayload } from '../../core/gs/gsProject';
import { HexBytesField, hexFieldState, toHex } from './HexBytesField';
import { useSignatureMap } from '../hooks';
import { useEditorState, useServices } from '../../app/store/context';

const MAKERS: Record<number, string> = { 0x41: 'Roland', 0x43: 'Yamaha', 0x42: 'Korg', 0x7e: 'Universal Non-Real Time', 0x7f: 'Universal Real Time' };

export function SysExInspector() {
  const { store, reportError } = useServices();
  const { project, selection } = useEditorState();
  const sig = useSignatureMap(project);
  const items = project.tracks.flatMap((tk) => tk.events.filter((e) => e.kind === 'sysex' && selection.eventIds.has(e.id)).map((e) => ({ tk, e })));
  const all = project.tracks.flatMap((tk) => tk.events.filter((e) => e.kind === 'sysex').map((e) => ({ tk, e })));
  const list = items.length ? items : all;
  const [hexEdit, setHexEdit] = useState<Record<string, string>>({});
  if (list.length === 0) return <p className="note">{t('この曲には SysEx がありません。MIDI → GS Reset を挿入、またはインスペクターから GS の設定を追加できます。')}</p>;
  return (
    <div className="sysex-inspector">
      <p className="note">{items.length ? t('選択中の SysEx') : t('曲内のすべての SysEx（リストやピアノロールで選択すると絞り込めます）')}</p>
      {list.map(({ tk, e }) => {
        if (e.kind !== 'sysex') return null;
        const bytes = base64ToBytes(e.dataBase64) ?? new Uint8Array();
        const gs = e.status === 'F0' ? decodeGs(bytes) : null;
        const hex = toHex(bytes);
        return (
          <section key={e.id} className="sysex-item" data-testid="sysex-item">
            <div>
              <strong>{sig.format(e.tick)}</strong>（Tick {e.tick}）— {tk.name}（Port {tk.port}）— {MAKERS[bytes[0]] ?? `Maker 0x${(bytes[0] ?? 0).toString(16)}`} — {bytes.length + (e.status === 'F0' ? 1 : 0)} bytes（{e.status}）
            </div>
            <div className="hex">
              {e.status === 'F0' ? 'F0 ' : ''}
              {hex}
            </div>
            {gs && (
              <div>
                {t('解釈:')} {gs.text}
                {gs.param && <span className="note">{t('（内蔵音源 SpessaSynth: {state}）', { state: gs.param.engine ? t('処理する') : t('処理しない') })}</span>}
                {gs.param && gs.param.max > gs.param.min && (
                  <label className="note">
                    {' '}
                    {t('値')}{' '}
                    <input
                      type="number"
                      min={gs.param.min}
                      max={gs.param.max}
                      key={gs.data[0]} // uncontrolled: remount when the value changes elsewhere (undo)
                      defaultValue={gs.data[0]}
                      onBlur={(ev) => {
                        if (ev.target.value.trim() === '' || Number(ev.target.value) === gs.data[0]) return;
                        try {
                          store.run(setGsValue(store.project, e.id, Number(ev.target.value)));
                        } catch (err) {
                          reportError((err as Error).message);
                        }
                      }}
                    />
                    {t('（チェックサムは自動で再計算）')}
                  </label>
                )}
              </div>
            )}
            {!gs && <div className="note">{t('解釈できない SysEx です。内容は変更せずに保存・書き出しします。')}</div>}
            <div
              onBlur={() => {
                const text = hexEdit[e.id];
                if (text === undefined || text === hex) return;
                const parsed = hexFieldState(text, e.status === 'F0');
                if (!parsed.bytes) return reportError(parsed.error);
                try {
                  store.run(setSysExPayload(store.project, e.id, parsed.bytes));
                  setHexEdit({ ...hexEdit, [e.id]: undefined as unknown as string });
                } catch (err) {
                  reportError((err as Error).message);
                }
              }}
            >
              <HexBytesField value={hexEdit[e.id] ?? hex} onChange={(text) => setHexEdit({ ...hexEdit, [e.id]: text })} sysex={e.status === 'F0'} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
