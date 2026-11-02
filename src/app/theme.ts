// Colour theme (ADR-051): auto (follow the OS), light or dark. The choice is kept in localStorage,
// not in the project. The resolved theme is `data-theme` on <html>; CSS variables follow it and the
// canvases read them through readTheme(), so they are told to redraw through a version counter.
import { useSyncExternalStore } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';
const KEY = 'midi-studio.theme';
const listeners = new Set<() => void>();
let version = 0;
let pref: ThemePref = readPref();
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function themePref(): ThemePref {
  return pref;
}

export function resolvedTheme(): 'light' | 'dark' {
  return pref === 'auto' ? (media?.matches ? 'dark' : 'light') : pref;
}

function apply(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolvedTheme());
  version++;
  for (const l of listeners) l();
}

export function setThemePref(p: ThemePref): void {
  pref = p;
  try {
    if (p === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* private mode: not kept */
  }
  apply();
}

/** Call once at startup: applies the stored choice and follows the OS while on 'auto'. */
export function initTheme(): void {
  apply();
  media?.addEventListener('change', () => pref === 'auto' && apply());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
/** Changes whenever the theme is applied: put it in the deps of canvas drawing effects. */
export function useThemeVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, () => pref);
}
