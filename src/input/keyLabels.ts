// Physical key (`KeyboardEvent.code`) -> label for JIS / US layouts (INPUT_RECORDING 2, UI_DESIGN 9).
// Codes are the identity of a key; labels are display only.
export type KeyboardLayout = 'jis' | 'us';

const COMMON: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'BS',
  Numpad0: 'Num 0', Numpad1: 'Num 1', Numpad2: 'Num 2', Numpad3: 'Num 3', Numpad4: 'Num 4', Numpad5: 'Num 5', Numpad6: 'Num 6', Numpad7: 'Num 7', Numpad8: 'Num 8', Numpad9: 'Num 9',
  NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter', NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
};
const US: Record<string, string> = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/' };
const JIS: Record<string, string> = { Minus: '-', Equal: '^', BracketLeft: '@', BracketRight: '[', Backslash: ']', Semicolon: ';', Quote: ':', Backquote: '半角/全角', Comma: ',', Period: '.', Slash: '/', IntlRo: '\\ (ろ)', IntlYen: '¥' };

export function keyLabel(code: string, layout: KeyboardLayout): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return (layout === 'jis' ? JIS : US)[code] ?? COMMON[code] ?? code;
}
