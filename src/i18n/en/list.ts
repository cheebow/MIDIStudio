// English texts for the list editor extension (ADR-066): core (src/core/list, src/input/listKeys)
// and UI (src/ui/list-editor). Key = the Japanese source string, value = the English text.
export const EN_LIST: Record<string, string> = {
  // --- undo labels (src/core/list)
  '種類を変更': 'Change event type',
  'コントローラー番号を変更': 'Change controller number',
  'チャンネルを変更': 'Change channel',
  'CC を挿入': 'Insert CC',
  'プログラムチェンジを挿入': 'Insert Program Change',
  'ピッチベンドを挿入': 'Insert Pitch Bend',
  'チャンネルプレッシャーを挿入': 'Insert Channel Pressure',
  'ポリプレッシャーを挿入': 'Insert Poly Pressure',
  'SysEx を挿入': 'Insert SysEx',
  'Meta を挿入': 'Insert Meta',
  'バンクと音色を挿入': 'Insert Bank and Program',
  'RPN ピッチベンドレンジを挿入': 'Insert RPN Pitch Bend Range',
  'RPN ファインチューンを挿入': 'Insert RPN Fine Tuning',
  'RPN コースチューンを挿入': 'Insert RPN Coarse Tuning',
  'NRPN を挿入': 'Insert NRPN',
  'Meta を編集': 'Edit Meta',
  // --- errors (src/core/list)
  'NOTE 列には音名（C4、F#3）か CC7 / PC5 / PB / CP / PP C4 を入力してください。': 'Type a note name (C4, F#3) or CC7 / PC5 / PB / CP / PP C4 in the NOTE column.',
  'コントローラー番号は 0〜127 です。': 'The controller number must be between 0 and 127.',
  '音色番号は 1〜128 です。': 'The program number must be between 1 and 128.',
  'ノート番号は 0〜127 です。': 'The note number must be between 0 and 127.',
  'CC のあとにコントローラー番号を入力してください（例: CC7）。': 'Type the controller number after CC (e.g. CC7).',
  'PC のあとに音色番号を入力してください（例: PC5）。': 'Type the program number after PC (e.g. PC5).',
  'raw イベントは種類を変更できません（内容をそのまま保持します）。': 'Raw events cannot change type (their bytes are kept as they are).',
  'チャンネルは 1〜16 です。': 'The channel must be between 1 and 16.',
  'チャンネルを持たない行です。': 'This row has no channel.',
  'メタイベントの種類は 0〜127 です。': 'The meta event type must be between 0 and 127.',
  'テンポ・拍子・調号・マーカーはコンダクタートラックで編集します（リストには置けません）。': 'Tempo, time signature, key signature and markers are edited in the conductor track (they cannot be placed in the list).',
};
