// SPDX-License-Identifier: GPL-3.0-only

// unifiedDiff.test.ts — разбор unified diff ядра: заголовки, ханки, номера строк.
import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './unifiedDiff';

const SAMPLE = [
  '--- before',
  '+++ after',
  '@@ -3,4 +3,5 @@',
  ' keep a',
  '-old b',
  '+new b',
  '+new c',
  ' keep d',
  ' keep e',
].join('\n');

const NO_NEWLINE = '\\ No newline at end of file';

describe('parseUnifiedDiff', () => {
  it('заголовок файла, ханк, add/del/ctx и номера строк из заголовка ханка', () => {
    expect(parseUnifiedDiff(SAMPLE)).toEqual([
      { kind: 'file', text: '--- before' },
      { kind: 'file', text: '+++ after' },
      { kind: 'hunk', text: '@@ -3,4 +3,5 @@' },
      { kind: 'ctx', text: 'keep a', oldNo: 3, newNo: 3 },
      { kind: 'del', text: 'old b', oldNo: 4 },
      { kind: 'add', text: 'new b', newNo: 4 },
      { kind: 'add', text: 'new c', newNo: 5 },
      { kind: 'ctx', text: 'keep d', oldNo: 5, newNo: 6 },
      { kind: 'ctx', text: 'keep e', oldNo: 6, newNo: 7 },
    ]);
  });

  it('-a +b без счётчиков: каждый ханк — одна строка', () => {
    const lines = parseUnifiedDiff(['--- before', '+++ after', '@@ -7 +9 @@', '-x', '+y'].join('\n'));
    expect(lines.slice(3)).toEqual([
      { kind: 'del', text: 'x', oldNo: 7 },
      { kind: 'add', text: 'y', newNo: 9 },
    ]);
  });

  it('CRLF: перевод строки не попадает в текст, результат тот же, что у LF', () => {
    expect(parseUnifiedDiff(SAMPLE.replaceAll('\n', '\r\n') + '\r\n')).toEqual(parseUnifiedDiff(SAMPLE));
  });

  it('«\\ No newline at end of file» — meta без номера и без сдвига счётчиков', () => {
    const lines = parseUnifiedDiff(
      ['--- before', '+++ after', '@@ -1,2 +1,2 @@', ' a', '-b', NO_NEWLINE, '+c', NO_NEWLINE].join('\n'),
    );
    expect(lines.slice(3)).toEqual([
      { kind: 'ctx', text: 'a', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'b', oldNo: 2 },
      { kind: 'meta', text: NO_NEWLINE },
      { kind: 'add', text: 'c', newNo: 2 },
      { kind: 'meta', text: NO_NEWLINE },
    ]);
  });

  it('удалённая строка «-- x» внутри ханка не принимается за заголовок файла', () => {
    const lines = parseUnifiedDiff(['--- before', '+++ after', '@@ -1 +1 @@', '--- x', '+++ y'].join('\n'));
    expect(lines.slice(3)).toEqual([
      { kind: 'del', text: '-- x', oldNo: 1 },
      { kind: 'add', text: '++ y', newNo: 1 },
    ]);
  });

  it('несколько ханков: счётчики берутся заново из каждого заголовка', () => {
    const lines = parseUnifiedDiff(
      ['--- before', '+++ after', '@@ -1 +1 @@', '-a', '+b', '@@ -20,2 +20,2 @@', ' c', '-d', '+e'].join('\n'),
    );
    expect(lines.filter((l) => l.kind === 'hunk')).toHaveLength(2);
    expect(lines.at(-1)).toEqual({ kind: 'add', text: 'e', newNo: 21 });
    expect(lines.at(-2)).toEqual({ kind: 'del', text: 'd', oldNo: 21 });
  });

  it('пустой ввод — пустой список; пустая строка внутри ханка — контекст', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('\n')).toEqual([]);
    const lines = parseUnifiedDiff(['--- before', '+++ after', '@@ -1,2 +1,2 @@', '', '-a', '+b'].join('\n'));
    expect(lines[3]).toEqual({ kind: 'ctx', text: '', oldNo: 1, newNo: 1 });
  });

  it('непонятные строки до ханка и испорченный заголовок ханка — meta', () => {
    const lines = parseUnifiedDiff(['diff --git a b', '@@ garbage @@', '+x'].join('\n'));
    expect(lines.map((l) => l.kind)).toEqual(['meta', 'meta', 'meta']);
  });
});
