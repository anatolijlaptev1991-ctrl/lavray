// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { MessageKey } from './i18n';
import { TEST_NA_PREFIX, formatFullReport, isTestDown, isTestNotApplicable, resultLabel } from './testResult';

// T-23: «тест не применим» (n/a) отличается от «сервер недоступен».
describe('testResult', () => {
  it('распознаёт код n/a от ядра', () => {
    const na = { lastError: `${TEST_NA_PREFIX}Hysteria2 работает по UDP/QUIC` };
    expect(isTestNotApplicable(na)).toBe(true);
    expect(isTestDown(na)).toBe(false);
  });

  it('обычная ошибка — недоступен', () => {
    const down = { lastError: 'dial tcp 203.0.113.1:443: i/o timeout' };
    expect(isTestNotApplicable(down)).toBe(false);
    expect(isTestDown(down)).toBe(true);
  });

  it('нет результата или ошибки — ни то ни другое', () => {
    for (const r of [undefined, {}, { lastError: '' }]) {
      expect(isTestNotApplicable(r)).toBe(false);
      expect(isTestDown(r)).toBe(false);
    }
  });
});

// T-84: подписи колонки результата и строка отчёта полного теста.
describe('formatFullReport / resultLabel', () => {
  const names: Record<string, string> = {
    'test.latency': 'Latency',
    'test.rep.udp': 'UDP',
    'test.rep.speed': 'Speed',
    'test.rep.in': 'In',
    'test.rep.out': 'Out',
    'test.na': 'n/a',
  };
  const tr = (key: MessageKey): string => names[key] ?? key;
  const plain = (s: string): string => s.replace(/\s/g, ' ');

  it('собирает все поля в порядке «задержка; UDP; скорость; вход; выход»', () => {
    const line = formatFullReport(
      { latencyMs: 120, udpLatencyMs: 45, downloadBps: 25_600_000, ingressIp: '203.0.113.5', egressIp: '198.51.100.7' },
      tr,
      'en',
    );
    expect(plain(line)).toBe('Latency: 120 ms; UDP: 45 ms; Speed: 3.2 MB/s; In: 203.0.113.5; Out: 198.51.100.7');
  });

  it('пропускает то, чего не мерили; нет отчёта — пустая строка', () => {
    expect(formatFullReport(undefined, tr, 'en')).toBe('');
    expect(formatFullReport({}, tr, 'en')).toBe('');
    expect(formatFullReport({ egressIp: '198.51.100.7' }, tr, 'en')).toBe('Out: 198.51.100.7');
    expect(formatFullReport({ latencyMs: 0, downloadBps: 0 }, tr, 'en')).toBe('');
  });

  it('ошибка частичного отказа добавляется в конец', () => {
    expect(plain(formatFullReport({ latencyMs: 50, error: 'udp: timeout' }, tr, 'en'))).toBe(
      'Latency: 50 ms; udp: timeout',
    );
  });

  it('подпись колонки: н/д, ✕, задержка либо «—»', () => {
    expect(resultLabel({ lastError: `${TEST_NA_PREFIX}x` }, tr, 'en')).toBe('n/a');
    expect(resultLabel({ lastError: 'boom' }, tr, 'en')).toBe('✕');
    expect(plain(resultLabel({ latencyMs: 40 }, tr, 'en'))).toBe('40 ms');
    expect(resultLabel({}, tr, 'en')).toBe('—');
    expect(resultLabel(undefined, tr, 'en')).toBe('—');
  });
});
