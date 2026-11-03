// Beginner's guide (ADR-056): for people who have never used a MIDI sequencer. One chapter per step,
// each ending with something that can be heard. Shown in the app (ヘルプ › 入門…) and as the static
// tutorial.html. Uses the same shape as the help sections so both can share the dialog and renderer.
import { Fig, type HelpSection } from './content';
import { ALT_LABEL as ALT, MOD_LABEL as MOD } from '../../ui/platform';
import type { ReactNode } from 'react';
import { locale } from '../../i18n';
import { TUTORIAL_CHAPTERS_EN } from './tutorial.en';

/** The tutorial chapters in the current UI language (ADR-061). */
export function tutorialChapters(): HelpSection[] {
  return locale() === 'en' ? TUTORIAL_CHAPTERS_EN : TUTORIAL_CHAPTERS;
}

const K = ({ children }: { children: ReactNode }) => <kbd className="help-key">{children}</kbd>;

export const TUTORIAL_CHAPTERS: HelpSection[] = [
  {
    id: 'what-is-midi',
    title: 'MIDI とは',
    body: (
      <>
        <p>MIDI は音そのものではなく、「どの音を、いつ、どのくらいの強さで、どの楽器で鳴らすか」という演奏の指示です。シーケンサーはその指示を並べて記録し、音源がそれを読んで音を出します。</p>
        <ul>
          <li>音の指示は<strong>ノート</strong>。高さ（C4 など）、位置、長さ、強さ（<strong>ベロシティ</strong>、1〜127）を持ちます。</li>
          <li>楽器は<strong>音色</strong>（Program Change）で選びます。ピアノ、ベース、ストリングス……GM 規格で 128 種類あります。</li>
          <li>トラックは楽器ごとの「段」。各トラックは<strong>チャンネル</strong>（1〜16）で音源とつながり、10 チャンネルはドラム専用です。</li>
          <li>曲の速さは<strong>テンポ</strong>（BPM）、拍のまとまりは<strong>拍子</strong>。位置は「小節 . 拍 . Tick」で表します。</li>
        </ul>
        <p>指示だけを記録するので、あとから音色やテンポを変えても演奏はそのまま残ります。ファイルも小さく（数十 KB）、.mid として他のソフトとやり取りできます。</p>
      </>
    ),
  },
  {
    id: 'screen',
    title: '画面の見かた',
    body: (
      <>
        <ul>
          <li><strong>トランスポート</strong>（上）: 再生・停止・録音、ループ、現在位置、テンポ、メトロノーム、シークバー。</li>
          <li><strong>トラックビュー</strong>（中）: 曲全体。左にトラックの一覧、右に時間が流れ、ノートの入った範囲が<strong>クリップ</strong>として見えます。</li>
          <li><strong>エディター</strong>（下）: 選んだトラックの中身。タブでピアノロール・ドラム・リスト・ミキサー・コンダクターを切り替えます。</li>
          <li><strong>インスペクター</strong>（右）: 選んだトラックの名前・色・チャンネル・音色。</li>
        </ul>
        <p>迷ったら <K>Esc</K> で編集モードに戻り、<K>{MOD}Z</K> で元に戻せます。</p>
        <Fig src="screen.ja.jpg" alt="MIDI Studio の画面全体" caption="① トランスポート ② トラックビュー ③ エディター ④ インスペクター" />
      </>
    ),
  },
  {
    id: 'first-notes',
    title: '1. 最初の音を置く',
    body: (
      <>
        <ol>
          <li>起動ダイアログで「新しい曲」を選び、「開始」。ピアノ・ベース・ギター・ドラムの 4 トラックが並びます（まず完成した曲を聴きたいときは「サンプル曲」）。</li>
          <li>トラックビューで「ピアノ」をクリックして選びます。下のエディターが「ピアノロール」になっていることを確かめます。</li>
          <li>エディターの上にある編集グリッド（最初は「1/16」）を <strong>1/4</strong> にします。クリックで置くノートの長さは、このグリッドの長さになります。</li>
          <li><K>P</K> で描画ツールにし、左の鍵盤で C4 の段の、1 小節目の先頭をクリック。4 分音符が 1 つ置かれます。</li>
          <li>同じ段で右に 3 つ、続けて置きます。1 小節が 4 分音符 4 つで埋まります（クリックしたままドラッグすると長さを伸ばせますが、ここでは伸ばしません）。</li>
          <li><K>Space</K> で再生。もう一度 <K>Space</K> で止まり、<K>Enter</K> で先頭に戻ります。</li>
        </ol>
        <p>ノートを動かすには <K>V</K> で選択ツールにして中央をドラッグ、消すには選んで <K>Delete</K>。置く場所はグリッドに吸い付きます（スナップ）。</p>
        <Fig src="startup.ja.jpg" alt="起動ダイアログ" caption="① 新しい曲 ② 開始" />
        <Fig src="first-notes.ja.jpg" alt="ピアノロールに C4 の 4 分音符を 4 つ置いたところ" caption="① 描画ツール ② C4 の段 ③ 置いたノート（4 分音符が 4 つ） ④ 編集グリッド 1/4" />
      </>
    ),
  },
  {
    id: 'rhythm',
    title: '2. リズムを足す',
    body: (
      <>
        <ol>
          <li>トラックビューで「ドラム」を選びます。エディターが「ドラム」になり、楽器名のレーンが並びます。</li>
          <li>編集グリッドを <strong>1/8</strong> にします（ハイハットを 8 分音符で置くため）。</li>
          <li>Bass Drum 1 のレーンで 1 拍目と 3 拍目をクリック、Acoustic Snare のレーンで 2 拍目と 4 拍目をクリック。</li>
          <li>Closed Hi-Hat のレーンで 8 分音符ごと（1 小節に 8 つ）にクリック。</li>
          <li><K>L</K> でループを ON にし、<K>Space</K>。1 小節目が繰り返し鳴ります。ループの範囲はトランスポートの「小節」の数値か、ルーラーの端をドラッグして変えられます。</li>
        </ol>
        <p>ドラムは音の高さが楽器の違いになります（C1 = Bass Drum、D1 = Snare……）。これが 10 チャンネルの決まりです。右のパッドをクリックすると音を確かめられます。</p>
        <Fig src="rhythm.ja.jpg" alt="ドラムエディターに 1 小節のパターンを置いたところ" caption="① Bass Drum 1 ② Acoustic Snare ③ Closed Hi-Hat ④ ループ ⑤ 編集グリッド 1/8" />
      </>
    ),
  },
  {
    id: 'bass-chords',
    title: '3. ベースとコード',
    body: (
      <>
        <ol>
          <li>「ベース」を選び、編集グリッドを <strong>1/4</strong> に戻して、ピアノロールの C2 の段に 4 分音符を 4 つ置きます（1 小節ぶん）。</li>
          <li>「ピアノ」に戻り、1 章で置いた 4 つのノートそれぞれの上に、E4 と G4 を置きます（1 拍につき C4・E4・G4 の 3 つ、合計 12 個）。C・E・G が同時に鳴ると C のコード（ドミソ）です。</li>
          <li>2 小節目を作ります。ピアノロールをクリックしてから <K>{MOD}A</K> で 1 小節目のノートをすべて選び、<K>{MOD}D</K> で複製。同じものが 2 小節目に置かれ、選ばれた状態になります。そのまま <K>↑</K> を 5 回押すと 5 半音上がり、F4・A4・C5（F のコード）になります。</li>
          <li>ベースも同じです。「ベース」を選び、ピアノロールをクリックしてから <K>{MOD}A</K> → <K>{MOD}D</K> → <K>↑</K> を 5 回で、2 小節目が F2 になります。</li>
          <li>ドラムも 2 小節にします。「ドラム」を選び、<K>{MOD}A</K> → <K>{MOD}D</K>。2 章で作った 1 小節のパターンが 2 小節目にも入ります（↑ は押しません）。</li>
          <li>トランスポートの「小節」の右側の数を 3 にします（1 〜 3 で、1・2 小節目を繰り返し）。<K>Space</K>。C → F と進むだけで曲らしくなります。</li>
        </ol>
        <p>ノートを選んで <K>{MOD}C</K> → 再生位置を動かして <K>{MOD}V</K> で貼り付け、<K>{MOD}D</K> で複製（選んだ範囲のすぐ後ろに）。<K>↑↓</K> で半音、Shift+<K>↑↓</K> でオクターブ移動します。</p>
        <Fig src="chords.ja.jpg" alt="ピアノロールの C と F のコード" caption="① 編集グリッド 1/4 ② 1 小節目は C・E・G ③ 2 小節目は F・A・C（複製して ↑ 5 回）" />
      </>
    ),
  },
  {
    id: 'sound-tempo',
    title: '4. 音色とテンポ、音量',
    body: (
      <>
        <ul>
          <li><strong>音色</strong>: トラックを選び、右のインスペクターの「音色」から選びます。ピアノを Electric Piano 1 に、ギターを String Ensemble 1 にすると雰囲気が変わります（ギターはまだノートが無いので鳴りませんが、あとで弾くときのために選んでおきます）。</li>
          <li><strong>テンポ</strong>: トランスポートの BPM をクリックして数値を入れます。120 がふつう、90 でゆったり、140 で速め。曲の途中で変えるときはコンダクターで。</li>
          <li><strong>音量と左右</strong>: 「ミキサー」タブで Volume と Pan を動かします。再生しながら動かせます。</li>
        </ul>
        <p>音色は曲の先頭に Program Change として、音量は CC として保存され、MIDI ファイルにも入ります。</p>
        <Fig src="sound-tempo.ja.jpg" alt="音色の選択と BPM、ミキサータブ" caption="① 音色 ② BPM ③ ミキサータブ" />
        <Fig src="mixer.ja.jpg" alt="ミキサー" caption="ミキサー: トラックごとの Volume・Pan・Reverb・Chorus・Expression" />
      </>
    ),
  },
  {
    id: 'play-in',
    title: '5. 弾いて入れる',
    body: (
      <>
        <p>クリックで置くほかに、キーボードを楽器にして弾けます。</p>
        <ol>
          <li><K>{ALT}K</K> で入力モードを「鍵盤」に。下段 Z〜M が C4〜B4、上段 Q〜I がその 1 オクターブ上。<K>↑↓</K> でオクターブを変えます。</li>
          <li>「ピアノ」の R（録音待機）を押し、<K>R</K> で録音開始。カウントイン 1 小節のあと、弾いた音がそのまま入ります。<K>R</K> で停止。</li>
          <li>タイミングがずれたら、ノートを選んで <K>Q</K>。編集グリッドに揃います（クオンタイズ）。</li>
          <li><K>Esc</K> で編集モードに戻ります。鍵盤モードの間は 1 文字のショートカットが音になるので注意。</li>
        </ol>
        <p>MIDI キーボードがあれば起動ダイアログで「使う」を選ぶだけで同じことができます。ドラムは <K>{ALT}R</K> の「パッド」モードで。</p>
        <Fig src="play-in.ja.jpg" alt="鍵盤モードと録音待機、録音ボタン" caption="① 鍵盤モード ② 録音待機（R） ③ 録音" />
      </>
    ),
  },
  {
    id: 'arrange',
    title: '6. 曲の形にする',
    body: (
      <>
        <ul>
          <li>2 小節できたので、これを 4 回並べて 8 小節にします。トラックビューで、クリップの無い空いているところ（たとえばドラムの下）から左上へドラッグすると、ピアノ・ベース・ドラムのクリップをまとめて選べます（ギターにはまだノートが無いので、クリップもありません）。<K>{MOD}D</K> で、そのすぐ後ろに複製されます。複製されたクリップが選ばれた状態になるので、続けて <K>{MOD}D</K> をあと 2 回押せば 8 小節です。1 つだけなら <K>{ALT}</K>+ドラッグでも複製できます。</li>
          <li>変化をつけたい場所だけノートを変えます。ベロシティを変えると強弱がつきます（ピアノロール下の Velocity レーンをドラッグ）。</li>
          <li>機械的すぎると感じたら、ノートを選んで 編集 › ノート › ヒューマナイズ…。位置と強さが少しだけ揺れます。</li>
          <li>マーカー（トラックビューのマーカー行の右クリック、またはコンダクター）で Intro / A / B と名前を付けておくと迷いません。</li>
        </ul>
        <p>ここまでで、C と F のコードが交互に 4 回、8 小節の曲になっています。</p>
        <Fig src="arrange.ja.jpg" alt="トラックビューで 3 トラックのクリップを範囲選択したところ" caption="① 空いているところからドラッグして、ピアノ・ベース・ドラムのクリップをまとめて選択（ギターは空）" />
      </>
    ),
  },
  {
    id: 'save',
    title: '7. 保存と書き出し',
    body: (
      <>
        <ul>
          <li><K>{MOD}S</K> でブラウザに保存。次に開いたとき起動ダイアログから続きを選べます。</li>
          <li>ファイルとして残すなら ファイル › .midstudio として保存…。他のソフトに渡すなら MIDI を書き出す…（.mid）。</li>
          <li>音として聴かせたいときは WAV を書き出す…。</li>
        </ul>
        <p>ブラウザの中のデータは、そのブラウザのサイトデータを消すと一緒に消えます。大事な曲はファイルにも残してください。</p>
        <Fig src="save.ja.jpg" alt="ファイルメニュー" caption="ファイルメニュー: ブラウザに保存、.midstudio として保存、MIDI / WAV の書き出し" />
      </>
    ),
  },
  {
    id: 'next',
    title: '次に',
    body: (
      <>
        <ul>
          <li>ファイル › サンプル曲 で VISION や Merry X'mas For You! を開くと、20 トラックを超える曲の作りが見えます。手元の .mid は ファイル › MIDI を読み込む… で。</li>
          <li>数値で正確に入れたいときは「リスト」タブ。レコンポーザ流の MEAS / STEP / NOTE / ST / GT / VEL で、PC キーボードだけで打ち込めます。</li>
          <li><K>T</K> のビジュアルモードで、再生しながら全トラックを眺められます。</li>
          <li>細かい操作はヘルプ（<K>F1</K>）に、GS 音源の SysEx はヘルプの「GM / GS」にまとめています。</li>
        </ul>
      </>
    ),
  },
];
