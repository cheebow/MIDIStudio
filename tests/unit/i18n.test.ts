// ADR-061: every literal t('…') call in src has an English entry, and the placeholders match.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasEnglish, locale, setLocale, t, tEn } from '../../src/i18n';

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !p.includes('/i18n/en/')) out.push(p);
  }
  return out;
}

/** t('…') / t("…") / t(`…`) calls; the key may contain escaped quotes */
const CALL = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;

describe('i18n (ADR-061)', () => {
  const keys = new Map<string, string>();
  for (const f of files('src')) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(CALL)) {
      const raw = m[1] ?? m[2] ?? m[3];
      const key = raw.replace(/\\(['"`\\])/g, '$1');
      if (!keys.has(key)) keys.set(key, f);
    }
  }

  it('finds the t() calls', () => {
    expect(keys.size).toBeGreaterThan(0);
  });

  it('every key has an English text', () => {
    const missing = [...keys].filter(([k]) => !hasEnglish(k)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });

  it('English texts keep the placeholders of their key and differ from it when it is Japanese', () => {
    const bad: string[] = [];
    for (const [k] of keys) {
      const en = tEn(k);
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      if (ph(k).join() !== ph(en).join()) bad.push(`placeholders: ${k} → ${en}`);
      if (/[぀-ヿ一-鿿]/.test(en)) bad.push(`still Japanese: ${k} → ${en}`);
    }
    expect(bad).toEqual([]);
  });

  it('t() fills placeholders and falls back to the key', () => {
    expect(locale()).toBe('ja');
    expect(t('{n} 個', { n: 3 })).toBe('3 個');
    setLocale('en');
    expect(t('存在しないキー')).toBe('存在しないキー');
    setLocale('ja');
  });
});
