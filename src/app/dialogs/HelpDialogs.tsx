// About: what the app is, version, where it lives, licences (ADR-054).
import { Dialog } from '../../ui/Dialog';
import { Logo } from '../../ui/Logo';
import { SAMPLE_CREDIT, SAMPLE_SONGS } from '../samples';

export const REPOSITORY_URL = 'https://github.com/cheebow/MIDIStudio';

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const base = import.meta.env.BASE_URL;
  return (
    <Dialog title="MIDI Studio について" onClose={onClose}>
      <div className="about" data-testid="about-dialog">
        <header className="about-head">
          <Logo size={56} />
          <div>
            <h3>MIDI Studio</h3>
            <p className="note">
              バージョン {__APP_VERSION__} ・ MIT ライセンス © 2026 cheebow ・{' '}
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>{' '}
              ・{' '}
              <a href={`${REPOSITORY_URL}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer">
                変更履歴
              </a>
            </p>
          </div>
        </header>
        <p>Web ブラウザで動く MIDI シーケンサー。DAW のような編集とレコンポーザのような数値入力を 1 つに。曲データも音源もブラウザの中だけで扱い、外部に送信しません。</p>
        <h4>音源とライブラリ</h4>
        <ul>
          <li>
            標準音源: GeneralUser GS v2.0.3 © S. Christian Collins —{' '}
            <a href={`${base}licenses/GeneralUser-GS-LICENSE.txt`} target="_blank" rel="noreferrer">
              ライセンス
            </a>
          </li>
          <li>
            音声合成: spessasynth_lib / spessasynth_core —{' '}
            <a href={`${base}licenses/spessasynth_lib-LICENSE.txt`} target="_blank" rel="noreferrer">
              Apache-2.0
            </a>
          </li>
          <li>
            その他のライブラリ（React ほか）:{' '}
            <a href={`${base}licenses/THIRD_PARTY.md`} target="_blank" rel="noreferrer">
              一覧とライセンス
            </a>
          </li>
        </ul>
        <h4>サンプル曲</h4>
        <p>
          {SAMPLE_SONGS.map((s) => s.title).join(' / ')} — {SAMPLE_CREDIT}{' '}
          <a href={`${base}samples/LICENSE.txt`} target="_blank" rel="noreferrer">
            詳細
          </a>
        </p>
        <p className="note">GS の SysEx は保持・編集できますが、Roland SC-55 / SC-88Pro 実機の音色やエフェクトを再現するものではありません。「レコンポーザ」は株式会社カモンミュージックの製品名で、本アプリは同社とは無関係です。</p>
      </div>
    </Dialog>
  );
}
