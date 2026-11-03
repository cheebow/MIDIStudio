// Web MIDI input setup (INPUT_RECORDING 4). Works without Web MIDI: shows the fallback.
import type { MidiInputAdapter } from '../../input/MidiInputAdapter';
import type { InputController } from '../../input/InputController';
import { t } from '../../i18n';

export function MidiInputSettings({ midi, input, onChange }: { midi: MidiInputAdapter; input: InputController; onChange: () => void }) {
  if (midi.state === 'unsupported') {
    return <p data-testid="midi-unsupported">{t('このブラウザは Web MIDI に対応していないため、外部 MIDI キーボードは使えません — PC キーボードとマウスでの演奏・入力・録音は使えます。')}</p>;
  }
  return (
    <div className="form-grid">
      <p className="note">{t('MIDI キーボードの入力だけを使います（SysEx の許可は求めません）。曲データや演奏を外部へ送信しません。')}</p>
      {midi.state !== 'granted' && (
        <button className="primary" onClick={() => void midi.enable().then(onChange)} disabled={midi.state === 'requesting'}>
          {t('MIDI 機器の使用を許可する')}
        </button>
      )}
      {midi.error && <p className="warn-text">{midi.error}</p>}
      {midi.state === 'granted' && (
        <>
          {midi.deviceList.length === 0 && <p className="note">{t('接続されている MIDI 入力機器がありません。接続すると自動で表示されます。')}</p>}
          <ul className="saved-list">
            {midi.deviceList.map((d) => (
              <li key={d.id}>
                <label>
                  <input type="checkbox" checked={d.enabled} disabled={d.state !== 'connected'} onChange={(e) => (midi.setDeviceEnabled(d.id, e.target.checked), onChange())} /> {d.name}{' '}
                  <span className="note">
                    {d.manufacturer} — {d.state === 'connected' ? t('接続中') : t('切断')}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <label>
            {t('受信チャンネル')}{' '}
            <select value={midi.channelFilter ?? ''} onChange={(e) => midi.setChannelFilter(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">{t('すべて')}</option>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={input.keepMidiChannel} onChange={(e) => (input.setKeepMidiChannel(e.target.checked), onChange())} /> {t('受信チャンネルをそのまま記録（オフ: 録音先トラックのチャンネル）')}
          </label>
        </>
      )}
    </div>
  );
}
