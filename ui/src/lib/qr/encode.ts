// SPDX-License-Identifier: GPL-3.0-only

// encode.ts — текст в матрицу QR-кода (qrcode-generator): уровень коррекции M,
// версия подбирается по длине. Не влезло в версию 40 — QrTooLongError.
import qrcode from 'qrcode-generator';

/** Матрица модулей: строки сверху вниз, true — тёмный модуль. */
export type QrMatrix = readonly (readonly boolean[])[];

/** Вместимость версии 40 на уровне M в байтовом режиме. */
export const QR_MAX_BYTES = 2331;

/** Текст не помещается в QR-код (ссылки на цепочки и сложные профили бывают длиннее). */
export class QrTooLongError extends Error {
  constructor() {
    super('текст не помещается в QR-код');
    this.name = 'QrTooLongError';
  }
}

/**
 * Библиотека пишет байтами младший байт каждого символа (c & 0xff), и кириллица
 * в имени профиля портится. Отдаём ей UTF-8 побайтно, по символу на байт: так
 * кодируют и телефоны, и jsQR читает это обратно как UTF-8.
 */
function utf8AsBinary(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join('');
}

/** Матрица QR-кода для текста. @throws QrTooLongError если текст не помещается. */
export function qrMatrix(text: string): QrMatrix {
  const binary = utf8AsBinary(text);
  if (binary.length > QR_MAX_BYTES) throw new QrTooLongError();
  const qr = qrcode(0, 'M');
  try {
    qr.addData(binary, 'Byte');
    qr.make();
  } catch (e) {
    // Библиотека бросает строку «code length overflow», а не Error.
    if (String(e).includes('overflow')) throw new QrTooLongError();
    throw e;
  }
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_r, row) =>
    Array.from({ length: size }, (_c, col) => qr.isDark(row, col)),
  );
}
