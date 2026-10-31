// SPDX-License-Identifier: GPL-3.0-only

// raster.ts — матрица QR-кода в пиксели RGBA: чёрные модули на белом, вокруг
// «тихая зона» (по стандарту 4 модуля). Цвета не зависят от темы интерфейса:
// инвертированный код читается не всеми сканерами. Пиксели рисует QrCanvas;
// тесты прогоняют их через декодер.
import type { QrMatrix } from './encode';
import type { Pixels } from './pixels';

/** Тихая зона по стандарту ISO/IEC 18004, модулей с каждой стороны. */
export const QUIET_ZONE = 4;

/** Матрица → RGBA; сторона модуля — scale пикселей. */
export function matrixToPixels(m: QrMatrix, scale: number, quiet = QUIET_ZONE): Pixels {
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError('scale должен быть целым числом от 1');
  if (!Number.isInteger(quiet) || quiet < 0) throw new RangeError('quiet должен быть целым числом от 0');
  const side = (m.length + 2 * quiet) * scale;
  const px = new Uint8ClampedArray(side * side * 4).fill(255); // белый, непрозрачный
  m.forEach((cells, row) => {
    cells.forEach((dark, col) => {
      if (dark) paintModule(px, side, (quiet + col) * scale, (quiet + row) * scale, scale);
    });
  });
  return { px, w: side, h: side };
}

/** Закрашивает квадрат scale×scale чёрным (альфа остаётся 255). */
function paintModule(px: Uint8ClampedArray, side: number, x0: number, y0: number, scale: number): void {
  for (let y = y0; y < y0 + scale; y++) {
    for (let x = x0; x < x0 + scale; x++) {
      const at = (y * side + x) * 4;
      px[at] = 0;
      px[at + 1] = 0;
      px[at + 2] = 0;
    }
  }
}
