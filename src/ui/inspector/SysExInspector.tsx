// SysEx / event inspector (MIDI_GS_SPEC 5): tick, track / port, maker, length, hex, GS meaning and
// whether the built-in engine processes it. Raw hex editing for anything.
import { useState } from 'react';
import { base64ToBytes } from '../../core/model/base64';
import { decodeGs } from '../../core/gs/gsSysex';
import { parseHexPayload, setGsValue, setSysExPayload } from '../../core/gs/gsProject';
import { useSignatureMap } from '../hooks';
import { useEditorState, useServices } from '../../app/store/context';

const MAKERS: Record<number, string> = { 0x41: 'Roland', 0x43: 'Yamaha', 0x42: 'Korg', 0x7e: 'Universal Non-Real Time', 0x7f: 'Universal Real Time' };

export function SysExInspector() {
  const { store, reportError } = useServices();
  const { project, selection } = useEditorState();
  const sig = useSignatureMap(project);
  const items = project.tracks.flatMap((t) => t.events.filter((e) => e.kind === 'sysex' && selection.eventIds.has(e.id)).map((e) => ({ t, e })));
  const all = project.tracks.flatMap((t) => t.events.filter((e) => e.kind === 'sysex').map((e) => ({ t, e })));
  const list = items.length ? items : all;
  const [hexEdit, setHexEdit] = useState<Record<string, string>>({});
  if (list.length === 0) return <p className="note">この曲には SysEx がありません。MIDI → GS Reset を挿入、またはインスペクターから GS の設定を追加できます。</p>;
  return (
    <div className="sysex-inspector">
      <p className="note">{items.length ? '選択中の SysEx' : '曲内のすべての SysEx（リストやピアノロールで選択すると絞り込めます）'}</p>
      {list.map(({ t, e }) => {
        if (e.kind !== 'sysex') return null;
        const bytes = base64ToBytes(e.dataBase64) ?? new Uint8Array();
        const gs = e.status === 'F0' ? decodeGs(bytes) : null;
        const hex = Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
        return (
          <section key={e.id} className="sysex-item" data-testid="sysex-item">
            <div>
              <strong>{sig.format(e.tick)}</strong>（Tick {e.tick}）— {t.name}（Port {t.port}）— {MAKERS[bytes[0]] ?? `Maker 0x${(bytes[0] ?? 0).toString(16)}`} — {bytes.length + (e.status === 'F0' ? 1 : 0)} bytes（{e.status}）
            </div>
            <div className="hex">
              {e.status === 'F0' ? 'F0 ' : ''}
              {hex}
            </div>
            {gs && (
              <div>
                解釈: {gs.text}
                {gs.param && <span className="note">（内蔵音源 SpessaSynth: {gs.param.engine ? '処理する' : '処理しない'}）</span>}
                {gs.param && gs.param.max > gs.param.min && (
                  <label className="note">
                    {' '}
                    値{' '}
                    <input
                      type="number"
                      min={gs.param.min}
                      max={gs.param.max}
                      defaultValue={gs.data[0]}
                      onBlur={(ev) => {
                        try {
                          store.run(setGsValue(store.project, e.id, Number(ev.target.value)));
                        } catch (err) {
                          reportError((err as Error).message);
                        }
                      }}
                    />
                    （チェックサムは自動で再計算）
                  </label>
                )}
              </div>
            )}
            {!gs && <div className="note">解釈できない SysEx です。内容は変更せずに保存・書き出しします。</div>}
            <label className="note">
              16進で編集（F0 の後ろから。F7 で終わる）
              <input
                className="hex-input"
                value={hexEdit[e.id] ?? hex}
                onChange={(ev) => setHexEdit({ ...hexEdit, [e.id]: ev.target.value })}
                onBlur={() => {
                  const text = hexEdit[e.id];
                  if (text === undefined || text === hex) return;
                  const parsed = parseHexPayload(text);
                  if (!parsed) return reportError('16進数（00〜FF）をスペース区切りで入力してください。');
                  try {
                    store.run(setSysExPayload(store.project, e.id, parsed));
                    setHexEdit({ ...hexEdit, [e.id]: undefined as unknown as string });
                  } catch (err) {
                    reportError((err as Error).message);
                  }
                }}
              />
            </label>
          </section>
        );
      })}
    </div>
  );
}
