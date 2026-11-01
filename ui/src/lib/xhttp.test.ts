// SPDX-License-Identifier: GPL-3.0-only

// xhttp.test.ts — XHTTP на стороне интерфейса (хвосты B, 7.4): понятный текст
// отказа Connect по причине transport_unsupported и предупреждение предпросмотра импорта.
import { Code } from '@connectrpc/connect';
import { beforeEach, describe, expect, it } from 'vitest';
import { coreError } from '../test-utils/coreError';
import { friendlyCoreError } from './core';
import { importLogWarnings } from './importWarnings';
import { setLanguage, t, tf } from './i18n';

beforeEach(() => {
  setLanguage('en');
});

describe('отказ Connect: transport_unsupported', () => {
  it('FAILED_PRECONDITION с этой причиной — фраза про транспорт, а не текст ядра', () => {
    const e = coreError(Code.FailedPrecondition, 'transport_unsupported');
    expect(friendlyCoreError(e, t)).toBe(t('err.transport'));
    expect(t('err.transport')).toMatch(/XHTTP/);
  });

  it('текст переводится на каждый язык, а не остаётся русским сообщением ядра (L)', () => {
    const e = coreError(Code.FailedPrecondition, 'transport_unsupported');
    const seen = new Set<string>();
    for (const lang of ['ru', 'en', 'de', 'es', 'zh'] as const) {
      setLanguage(lang);
      seen.add(friendlyCoreError(e, t));
    }
    expect(seen.size).toBe(5);
  });

  it('другая причина того же кода остаётся общим «действие недоступно» с текстом ядра', () => {
    const e = coreError(Code.FailedPrecondition, 'connection_active');
    expect(friendlyCoreError(e, t)).toContain(t('err.precondition'));
  });

  it('причина чужого домена не принимается за причину ядра (S)', () => {
    const e = coreError(Code.FailedPrecondition, 'transport_unsupported', 'other.domain');
    expect(friendlyCoreError(e, t)).not.toBe(t('err.transport'));
  });
});

describe('importLogWarnings: предупреждения предпросмотра', () => {
  const log = [
    'xhttp_unsupported: профиль «a» использует транспорт, который ядро пока не поддерживает',
    'xhttp_unsupported: профиль «b» использует транспорт, который ядро пока не поддерживает',
    'пропущено уже имеющихся серверов: 3',
  ];

  it('xhttp_unsupported: одна фраза на код с числом профилей, обычный журнал не показывается', () => {
    expect(importLogWarnings(log, tf)).toEqual([tf('imp.warn.xhttp', { n: 2 })]);
    expect(tf('imp.warn.xhttp', { n: 2 })).toContain('2');
  });

  it('пустой журнал и неизвестные коды — ничего (E)', () => {
    expect(importLogWarnings([], tf)).toEqual([]);
    expect(importLogWarnings(['something_else: x'], tf)).toEqual([]);
  });
});
