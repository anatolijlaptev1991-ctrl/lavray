// SPDX-License-Identifier: GPL-3.0-only

// modesState.test.ts — опрос режимов не создаёт новый объект без изменений.
import { describe, expect, it } from 'vitest';
import { keepModes } from './modesState';

describe('keepModes', () => {
  it('те же значения — тот же объект (React не рендерит)', () => {
    const prev = { sysProxy: true, tunMode: false };
    expect(keepModes(prev, { sysProxy: true, tunMode: false })).toBe(prev);
  });
  it('изменилось любое поле — новый объект', () => {
    const prev = { sysProxy: true, tunMode: false };
    const next = { sysProxy: true, tunMode: true };
    expect(keepModes(prev, next)).toBe(next);
    expect(keepModes(prev, { sysProxy: false, tunMode: false }).sysProxy).toBe(false);
  });
});
