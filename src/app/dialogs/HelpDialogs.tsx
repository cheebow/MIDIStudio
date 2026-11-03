// About: what the app is, version, where it lives, licences (ADR-054).
import { Dialog } from '../../ui/Dialog';
import { Logo } from '../../ui/Logo';
import { SAMPLE_CREDIT, SAMPLE_SONGS } from '../samples';
import { t } from '../../i18n';

export const REPOSITORY_URL = 'https://github.com/cheebow/MIDIStudio';

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const base = import.meta.env.BASE_URL;
  return (
    <Dialog title={t('MIDI Studio について')} onClose={onClose}>
      <div className="about" data-testid="about-dialog">
        <header className="about-head">
          <Logo size={56} />
          <div>
            <h3>MIDI Studio</h3>
            <p className="note">
              {t('バージョン {version} ・ MIT ライセンス © 2026 cheebow ・', { version: __APP_VERSION__ })}{' '}
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>{' '}
              ・{' '}
              <a href={`${REPOSITORY_URL}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer">
                {t('変更履歴')}
              </a>
            </p>
          </div>
        </header>
        <p>{t('Web ブラウザで動く MIDI シーケンサー。DAW のような編集とレコンポーザのような数値入力を 1 つに。曲データも音源もブラウザの中だけで扱い、外部に送信しません。')}</p>
        <h4>{t('音源とライブラリ')}</h4>
        <ul>
          <li>
            {t('標準音源: GeneralUser GS v2.0.3 © S. Christian Collins —')}{' '}
            <a href={`${base}licenses/GeneralUser-GS-LICENSE.txt`} target="_blank" rel="noreferrer">
              {t('ライセンス')}
            </a>
          </li>
          <li>
            {t('音声合成: spessasynth_lib / spessasynth_core —')}{' '}
            <a href={`${base}licenses/spessasynth_lib-LICENSE.txt`} target="_blank" rel="noreferrer">
              Apache-2.0
            </a>
          </li>
          <li>
            {t('その他のライブラリ（React ほか）:')}{' '}
            <a href={`${base}licenses/THIRD_PARTY.md`} target="_blank" rel="noreferrer">
              {t('一覧とライセンス')}
            </a>
          </li>
        </ul>
        <h4>{t('サンプル曲')}</h4>
        <p>
          {SAMPLE_SONGS.map((s) => s.title).join(' / ')} — {t(SAMPLE_CREDIT)}{' '}
          <a href={`${base}samples/LICENSE.txt`} target="_blank" rel="noreferrer">
            {t('詳細')}
          </a>
        </p>
        <p className="note">{t('GS の SysEx は保持・編集できますが、Roland SC-55 / SC-88Pro 実機の音色やエフェクトを再現するものではありません。「レコンポーザ」は株式会社カモンミュージックの製品名で、本アプリは同社とは無関係です。')}</p>
      </div>
    </Dialog>
  );
}
