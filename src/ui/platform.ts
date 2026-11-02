/** macOS / iOS: ⌘ is the shortcut modifier and Ctrl+click opens context menus. */
// (Node also has a `navigator`: the static help page is rendered with Windows labels on purpose, see renderHelp.tsx)
export const IS_MAC = typeof document !== 'undefined' && typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Prefix for shortcut labels in menus and help. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
/** Option / Alt prefix for shortcut labels. */
export const ALT_LABEL = IS_MAC ? '⌥' : 'Alt+';
