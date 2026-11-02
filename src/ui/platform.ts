/** macOS / iOS: ⌘ is the shortcut modifier and Ctrl+click opens context menus. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Prefix for shortcut labels in menus and help. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
/** Option / Alt prefix for shortcut labels. */
export const ALT_LABEL = IS_MAC ? '⌥' : 'Alt+';
