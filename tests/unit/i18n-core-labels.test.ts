// ADR-061: undo labels stay Japanese in the history (the UI shows t(label)), so every label literal in
// src/core must have an English entry, and every EditError message must be wrapped in t() with one.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasEnglish } from '../../src/i18n';

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const JP = /[぀-ヿ一-鿿]/;
/** label literals: default params `label = '…'`, `cmd('…'`, object `label: '…'`, and a Japanese literal as the last argument `, '…')` */
const LABEL = /(?:\blabel = |\bcmd\(|\blabel: |, )'((?:[^'\\]|\\.)*)'(?=[,)\s])/g;
/** EditError / Error messages, wrapped in t() or not */
const ERROR = /\b(?:EditError|Error)\((?:t\()?'((?:[^'\\]|\\.)*)'/g;

describe('i18n: core labels and messages (ADR-061)', () => {
  const labels = new Map<string, string>();
  const errors = new Map<string, string>();
  for (const f of files('src/core')) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(LABEL)) if (JP.test(m[1])) labels.set(m[1], f);
    for (const m of src.matchAll(ERROR)) if (JP.test(m[1])) errors.set(m[1], f);
  }
  // labels composed at runtime (conductorOps: `${KIND_LABEL[kind]}を${変更|追加}`)
  for (const kind of ['テンポ', '拍子', '調号', 'マーカー']) for (const verb of ['を変更', 'を追加']) labels.set(kind + verb, 'src/core/editing/conductorOps.ts');

  it('finds labels and messages', () => {
    expect(labels.size).toBeGreaterThan(30);
    expect(errors.size).toBeGreaterThan(10);
  });

  it('every undo label has an English text', () => {
    expect([...labels].filter(([k]) => !hasEnglish(k)).map(([k, f]) => `${f}: ${k}`)).toEqual([]);
  });

  it('every EditError / Error message has an English text', () => {
    expect([...errors].filter(([k]) => !hasEnglish(k)).map(([k, f]) => `${f}: ${k}`)).toEqual([]);
  });
});

// ADR-087: labels passed to the store from the editors (store.run(op(..., 'ドラムノートを入力'))) are
// shown with t() in the status bar and the undo menu as well.
describe('i18n: undo labels written in the UI (ADR-087)', () => {
  const labels = new Map<string, string>();
  for (const f of [...files('src/ui'), ...files('src/app')]) {
    if (f.includes('/help/')) continue;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(LABEL)) if (JP.test(m[1])) labels.set(m[1], f);
    for (const m of src.matchAll(/\beditMap\('((?:[^'\\]|\\.)*)'/g)) labels.set(m[1], f); // drum map edits
  }
  it('every label has an English text', () => {
    expect(labels.size).toBeGreaterThan(5);
    expect([...labels].filter(([k]) => !hasEnglish(k)).map(([k, f]) => `${f}: ${k}`)).toEqual([]);
  });
});
