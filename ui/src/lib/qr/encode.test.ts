// SPDX-License-Identifier: GPL-3.0-only

// encode.test.ts — qrMatrix: форма матрицы, UTF-8, предел вместимости.
import { describe, expect, it } from 'vitest';
import { QR_MAX_BYTES, QrTooLongError, qrMatrix } from './encode';

describe('qrMatrix', () => {
  it('квадратная матрица булевых; версия растёт с длиной текста', () => {
    const small = qrMatrix('ss://abc');
    const big = qrMatrix(`vless://${'a'.repeat(400)}`);
    expect(small.length).toBe(21); // версия 1
    expect(small.every((row) => row.length === small.length)).toBe(true);
    expect(big.length).toBeGreaterThan(small.length);
    expect((big.length - 17) % 4).toBe(0); // 17 + 4*версия
  });

  it('encode_too_long_throws: сверх вместимости версии 40 — QrTooLongError', () => {
    expect(() => qrMatrix('x'.repeat(QR_MAX_BYTES + 1))).toThrow(QrTooLongError);
    expect(() => qrMatrix('я'.repeat(QR_MAX_BYTES))).toThrow(QrTooLongError); // 2 байта на букву
    expect(() => qrMatrix('x'.repeat(QR_MAX_BYTES))).not.toThrow();
  });

  it('граница вместимости: 2331 байт — версия 40, на байт больше — QrTooLongError', () => {
    expect(qrMatrix('x'.repeat(QR_MAX_BYTES)).length).toBe(177); // версия 40
    const error = ((): unknown => {
      try {
        qrMatrix('x'.repeat(QR_MAX_BYTES + 1));
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(QrTooLongError);
    expect((error as Error).name).toBe('QrTooLongError');
  });
});
