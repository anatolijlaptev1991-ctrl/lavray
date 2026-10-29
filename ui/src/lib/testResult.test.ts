// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from 'vitest';
import { TEST_NA_PREFIX, isTestDown, isTestNotApplicable } from './testResult';

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
