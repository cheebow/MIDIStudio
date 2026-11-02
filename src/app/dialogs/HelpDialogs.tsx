// Static help content: shortcuts, GM / GS compatibility, about / licences.
import { GS_PARAMS } from '../../core/gs/gsSysex';
import { Dialog } from '../../ui/Dialog';
import { ALT_LABEL as ALT, IS_MAC, MOD_LABEL as MOD } from '../../ui/platform';

const SHORTCUTS: [string, string][] = [
  ['Space / Shift+Space', '再生 / 一時停止（文字入力中は無効）/ 選択したノートの先頭から再生'],
  ['Enter / Home', '先頭へ戻る'],
  [', / .', '1 小節戻る / 進む（小節の頭へ）'],
  ['L / Shift+L', 'ループの ON / OFF / 選択範囲（小節単位）をループにする'],
  ['I / O', 'ループの始点 / 終点を、再生位置のある小節にする'],
  ['M / S', '選択トラックのミュート / ソロ'],
  ['K / J / F', 'メトロノーム / スナップ / 再生に追従の切り替え'],
  ['1 〜 5', 'ピアノロール / ドラム / リスト / ミキサー / コンダクターのタブ'],
  [`${MOD}Z / ${IS_MAC ? '⇧⌘Z' : 'Ctrl+Y'}`, '元に戻す / やり直し'],
  [`${MOD}C / X / V / D`, 'コピー / 切り取り / 貼り付け（再生位置）/ 複製'],
  [`${MOD}A`, '選択トラックのノートをすべて選択'],
  ['Delete / Backspace', '選択を削除'],
  ['V / P', '選択ツール / 描画ツール'],
  ['Q / Shift+Q', 'クオンタイズ（編集グリッド）/ クオンタイズのダイアログ（音符・強さ・シャッフル・長さ）'],
  ['T', 'ビジュアルモードの表示 / 非表示（Esc で閉じる）'],
  ['R', 'リアルタイム録音の開始 / 停止（録音待機のトラックへ）'],
  [`${ALT}K / ${ALT}P`, 'PC 鍵盤 / ドラムパッドの入力モードに切り替え（もう一度で編集へ。どのモードでも使える）'],
  ['鍵盤モード: ↑ ↓ / Tab', 'オクターブを上げる / 下げる（ステップ入力でも）/ 押している間サステイン（CC64）'],
  ['Esc', '編集モードに戻る（演奏・ステップ入力をやめる）、選択の解除'],
  ['ステップ入力: → / ← / - / Backspace', '休符（次へ）/ 戻る / タイ / 直前を取消（テンキーの + / − でも可）'],
  ['リスト: ↑↓ ←→ Tab', '行・列の移動（Shift+↑↓ で複数選択）'],
  ['リスト: Enter / 数字キー', 'セルの編集を開始、Enter で確定、Esc で取消'],
  ['↑ ↓（ピアノロール）', '半音移動（Shift で 1 オクターブ）'],
  ['← →（ピアノロール）', 'グリッド 1 つ分移動'],
  ['Alt / Option + ドラッグ', '複製'],
  ['Alt / Option + ↑ ↓', '選択トラックを上 / 下へ移動（トラックヘッダーのドラッグでも並べ替え）'],
  ['トラックビュー: クリップの端をドラッグ', 'クリップの長さを変更（ノートは動かさず、範囲から出たノートはクリップから外れる）'],
  ['CC / Pitch Bend レーン', 'クリックで追加、ポイントをクリック / 空白をドラッグで選択、選択をドラッグで値を変更、Delete / Alt+クリックで削除'],
  [`${MOD}+ドラッグ（ピアノロール）`, 'スナップを一時的に無効'],
  [`${MOD}+ホイール（ピアノロール）`, '横方向の拡大・縮小'],
  [`${MOD}S / ${MOD}O`, 'ブラウザに保存 / プロジェクトを開く'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="キーボードショートカット" onClose={onClose}>
      <table className="summary">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">ツールバーの「編集 / 鍵盤 / パッド / ステップ」が入力モードです。「鍵盤」「パッド」にすると、割り当てたキーは演奏に使われ、1 文字のショートカット（V / P / Q / L / M / S など）は無効になります。修飾キーつきのショートカットと Esc はどのモードでも使えます。下段 Z〜M が C4〜B4、上段 Q〜I が C5〜C6（JIS / US 共通の物理位置）。</p>
    </Dialog>
  );
}

export function CompatDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="GM / GS 互換性について" onClose={onClose}>
      <ul>
        <li>MIDI ファイル（SMF Format 0/1）を読み込み、Format 1 で書き出します。SysEx・未知のメタイベント・対にならないノートも保持して書き出します（バイト列の完全一致ではなく、意味が同じになることを確認しています）。</li>
        <li>
          音は SoundFont（標準は GeneralUser GS）と SpessaSynth で鳴らします。<strong>Roland SC-55 / SC-88Pro 実機の音色・エフェクトを再現するものではありません。</strong>
        </li>
        <li>GS の SysEx は Roland の DT1 メッセージでチェックサムが正しく、下の表のアドレスのものだけを意味付きで表示・編集します。それ以外は 16 進のまま保持します。</li>
        <li>複数ポート（FF 21）は保存・書き出しに対応。再生では SpessaSynth がポートごとに 16 チャンネルを追加します（診断画面で音源のチャンネル数を確認できます）。途中でのポート変更は再生に反映しません。</li>
      </ul>
      <table className="summary">
        <thead>
          <tr>
            <th>GS パラメーター</th>
            <th>表示・編集</th>
            <th>内蔵音源</th>
          </tr>
        </thead>
        <tbody>
          {GS_PARAMS.map((p) => (
            <tr key={p.name}>
              <td>
                {p.name} <span className="note">{p.address.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ').replace(/^40 10/, '40 1x')}</span>
              </td>
              <td>対応</td>
              <td>{p.engine ? '処理する' : '処理しない'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">アドレスは公開されている GS / SC-55 系の資料と、内蔵の spessasynth_core 4.4.3 の GS 処理の実装で確認したものです。Roland 実機での検証はしていません。</p>
    </Dialog>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const base = import.meta.env.BASE_URL;
  return (
    <Dialog title="MIDI Studio について" onClose={onClose}>
      <p>ブラウザ内で完結する MIDI シーケンサー（開発中）。曲データや音源を外部に送信しません。</p>
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
    </Dialog>
  );
}
