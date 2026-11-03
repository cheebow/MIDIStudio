// UI language (ADR-061): Japanese is the source language and the key. `t(ja)` returns the English
// text from the dictionaries in ./en when the locale is 'en', otherwise the Japanese text itself.
// Placeholders are written `{name}` in both languages and filled from `vars`. The choice is kept in
// localStorage (not in the project); the first run follows navigator.language (en* → en, else ja).
// No React / DOM dependency so core code and the static-page renderer can use it too.
import { EN_APP } from './en/app';
import { EN_CORE } from './en/core';
import { EN_HELP } from './en/help';
import { EN_UI } from './en/ui';
import { EN_UI2 } from './en/ui2';

export type Locale = 'ja' | 'en';
export const LOCALES: readonly Locale[] = ['ja', 'en'];
export const LOCALE_NAMES: Record<Locale, string> = { ja: '日本語', en: 'English' };

const KEY = 'midi-studio.locale';
const EN: Record<string, string> = { ...EN_CORE, ...EN_UI, ...EN_UI2, ...EN_APP, ...EN_HELP };
const listeners = new Set<() => void>();
let current: Locale = readPref() ?? detect();

function readPref(): Locale | null {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return v === 'ja' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

function detect(): Locale {
  // only in a browser: Node (unit tests, the static-page build) has a navigator too but stays Japanese
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return 'ja';
  return (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'ja';
}

export function locale(): Locale {
  return current;
}

export function setLocale(l: Locale): void {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* private mode: not kept */
  }
  apply();
}

function apply(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  for (const fn of listeners) fn();
}

/** Call once at startup: puts the language on <html lang>. */
export function initLocale(): void {
  apply();
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Dictionary lookup for the current locale; `ja` must be a literal so the check test can find it. */
export function t(ja: string, vars?: Record<string, string | number>): string {
  const s = current === 'en' ? (EN[ja] ?? ja) : ja;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** English text for a key regardless of the current locale (static pages). */
export function tEn(ja: string): string {
  return EN[ja] ?? ja;
}

/** Keys that have an English entry (for the completeness test). */
export function hasEnglish(ja: string): boolean {
  return ja in EN;
}
