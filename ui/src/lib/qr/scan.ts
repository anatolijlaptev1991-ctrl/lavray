// SPDX-License-Identifier: GPL-3.0-only

// scan.ts — поиск QR-кода на картинке: сначала крупно (2000 px), при неудаче
// ещё раз в 1000 px. Уменьшение сглаживает шум фото, и код, не читавшийся в
// полном размере, находится во втором проходе.
import { decodeQrFromPixels } from './decode';
import { blobToPixels, shrinkPixels } from './image';
import type { Pixels } from './pixels';

/** Длинные стороны попыток по порядку. */
export const SCAN_SIDES: readonly number[] = [2000, 1000];

/**
 * Текст QR-кода на картинке или null. Источник — файл/вставка (Blob) либо
 * готовый кадр (снимок экрана). Ошибка чтения картинки пробрасывается: «не
 * картинка» и «кода нет» вызывающий различает сам.
 */
export async function findQr(input: Blob | Pixels, sides: readonly number[] = SCAN_SIDES): Promise<string | null> {
  const load = (side: number): Promise<Pixels> =>
    'px' in input ? Promise.resolve(shrinkPixels(input, side)) : blobToPixels(input, side);
  let tried = '';
  for (const side of sides) {
    const { px, w, h } = await load(side);
    // Картинка уже меньше следующей стороны: тот же размер второй раз не читаем.
    const key = `${String(w)}x${String(h)}`;
    if (key === tried) continue;
    tried = key;
    const text = decodeQrFromPixels(px, w, h);
    if (text !== null) return text;
  }
  return null;
}
