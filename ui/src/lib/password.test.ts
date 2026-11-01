// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from 'vitest';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_CHARS, normalizePassword, passwordIssue, passwordsMatch } from './password';

describe('пароль резервной копии', () => {
  it('password_nfc_normalized', () => {
    const composed = 'café-пароль'; // é одним символом
    const decomposed = 'café-пароль'; // e + комбинируемый акут
    expect(composed).not.toBe(decomposed);
    expect(normalizePassword(decomposed)).toBe(composed);
    expect(normalizePassword(composed)).toBe(composed);
    expect(passwordsMatch(composed, decomposed)).toBe(true);
    expect(passwordsMatch('abcdefgh', 'abcdefgH')).toBe(false);
  });

  it('min_length_enforced: граница в 8 символов, не байт', () => {
    expect(passwordIssue('')).toBe('short');
    expect(passwordIssue('1234567')).toBe('short');
    expect(passwordIssue('12345678')).toBeNull();
    // 7 кириллических букв — 14 байт, но всё равно 7 символов
    expect(passwordIssue('пароль1')).toBe('short');
    expect(passwordIssue('пароль12')).toBeNull();
    // эмодзи — один символ (кодовая точка), а не два UTF-16
    expect(passwordIssue('😀'.repeat(MIN_PASSWORD_CHARS - 1))).toBe('short');
    expect(passwordIssue('😀'.repeat(MIN_PASSWORD_CHARS))).toBeNull();
  });

  it('длина считается после нормализации', () => {
    // 7 символов + одна буква e с отдельным акутом: после NFC — 8 символов
    expect(passwordIssue('abcdefé')).toBe('short'); // a b c d e f é = 7
    expect(passwordIssue('abcdefgé')).toBeNull(); // 8
  });

  it('верхняя граница — 1024 байта UTF-8', () => {
    expect(passwordIssue('a'.repeat(MAX_PASSWORD_BYTES))).toBeNull();
    expect(passwordIssue('a'.repeat(MAX_PASSWORD_BYTES + 1))).toBe('long');
    expect(passwordIssue('я'.repeat(MAX_PASSWORD_BYTES / 2))).toBeNull();
    expect(passwordIssue('я'.repeat(MAX_PASSWORD_BYTES / 2 + 1))).toBe('long');
  });
});
