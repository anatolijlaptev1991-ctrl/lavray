// SPDX-License-Identifier: GPL-3.0-only

// dead-code.test.ts — T-62: в UI нет неподключённых модулей, стилей и диалогов.
// Раньше Header/Sidebar/ScreenStub/Toast, tokens.css/app.css, LogExportDialog и
// PresetSaveDialog лежали в дереве, но нигде не использовались: правка такого
// файла ничего не меняла, а проверки на нём создавали ложное чувство покрытия.
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./gen/**', '!./lib/dictionaries/**'],
  { query: '?raw', import: 'default', eager: true },
);
const styles = Object.keys(import.meta.glob('./**/*.css', { query: '?raw', import: 'default', eager: true }));

/** Точки входа и служебные файлы: их никто не импортирует по определению.
 *  Тестовые помощники (введены T-04/T-07/T-11/T-18) импортируют только тесты. */
const ENTRY = new Set([
  './main.tsx',
  './test-setup.ts',
  './test-harness.ts',
  './test-utils/coreStub.ts',
  './test-utils/coreError.ts',
  './test-utils/connsKit.ts',
  './test-utils/presetKit.ts',
  './test-utils/settingsKit.tsx',
  './test-utils/tauriStub.ts',
  './test-utils/qrKit.ts',
  './screens/subscriptions.testkit.tsx',
  './rpc-unused.allow.ts', // список RPC без вызова: его читают rpc-usage.test.ts и scripts/rpc_usage.py
]);

function baseName(file: string): string {
  return file.replace(/^.*\//, '').replace(/\.(d\.)?(ts|tsx|css)$/, '');
}

function isImported(file: string, importers: Record<string, string>): boolean {
  const base = baseName(file);
  const re = new RegExp(String.raw`(?:from|import)\s*\(?\s*'[^']*/${base}(?:\.css)?'`);
  return Object.entries(importers).some(([other, text]) => other !== file && re.test(text));
}

describe('мёртвый код', () => {
  it('каждый модуль .ts/.tsx импортируется хотя бы одним другим исходником', () => {
    const orphans = Object.keys(sources)
      .filter((f) => !ENTRY.has(f) && !f.endsWith('.d.ts'))
      .filter((f) => !isImported(f, sources));
    expect(orphans).toEqual([]);
  });

  it('каждый .css подключён через import (иначе правки в нём ничего не меняют)', () => {
    expect(styles.length).toBeGreaterThan(0);
    const orphans = styles.filter((f) => !isImported(f, sources));
    expect(orphans).toEqual([]);
  });

  it('все экспортируемые диалоги dialogs.tsx где-то используются', () => {
    const file = './components/dialogs.tsx';
    const text = sources[file] ?? '';
    const names = Array.from(text.matchAll(/^export function ([A-Za-z0-9_]+)/gm), (m) => m[1] ?? '');
    expect(names.length).toBeGreaterThan(3);
    const unused = names.filter((name) => {
      const re = new RegExp(String.raw`\b${name}\b`);
      return !Object.entries(sources).some(([other, src]) => other !== file && re.test(src));
    });
    expect(unused).toEqual([]);
  });
});
