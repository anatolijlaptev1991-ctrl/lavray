// SPDX-License-Identifier: GPL-3.0-only

// decode.ts — распознавание QR-кода в пикселях RGBA (jsQR). Без DOM: работает
// и в окне, и в тестах. Инвертированный код (светлый на тёмном) тоже находится.
import jsQR from 'jsqr';

/**
 * Текст первого найденного QR-кода или null, если кода нет (или размеры не
 * сходятся с длиной буфера: jsQR на таком буфере читает за границей).
 */
export function decodeQrFromPixels(px: Uint8ClampedArray, w: number, h: number): string | null {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null;
  if (px.length < w * h * 4) return null;
  const found = jsQR(px, w, h, { inversionAttempts: 'attemptBoth' });
  return found === null || found.data === '' ? null : found.data;
}
