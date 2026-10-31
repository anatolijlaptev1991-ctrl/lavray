// SPDX-License-Identifier: GPL-3.0-only

// raster.test.ts — матрица → пиксели: размер, тихая зона, цвета.
import { describe, expect, it } from 'vitest';
import type { QrMatrix } from './encode';
import { QUIET_ZONE, matrixToPixels } from './raster';

const M: QrMatrix = [
  [true, false],
  [false, true],
];

const at = (px: Uint8ClampedArray, side: number, x: number, y: number): number[] =>
  Array.from(px.slice((y * side + x) * 4, (y * side + x) * 4 + 4));

describe('matrixToPixels', () => {
  it('сторона = (модули + 2*тихая зона) * масштаб, тихая зона по умолчанию 4', () => {
    const { px, w, h } = matrixToPixels(M, 3);
    expect(QUIET_ZONE).toBe(4);
    expect(w).toBe((2 + 8) * 3);
    expect(h).toBe(w);
    expect(px.length).toBe(w * h * 4);
  });

  it('тёмные модули чёрные, остальное (включая тихую зону) белое, альфа везде 255', () => {
    const { px, w } = matrixToPixels(M, 2, 1);
    // тихая зона 1 модуль = 2 px; модуль (0,0) занимает пиксели 2..3
    expect(at(px, w, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(at(px, w, 2, 2)).toEqual([0, 0, 0, 255]);
    expect(at(px, w, 3, 3)).toEqual([0, 0, 0, 255]);
    expect(at(px, w, 4, 2)).toEqual([255, 255, 255, 255]); // светлый модуль
    expect(at(px, w, 4, 4)).toEqual([0, 0, 0, 255]);
  });

  it('нецелый или нулевой масштаб отвергается', () => {
    expect(() => matrixToPixels(M, 0)).toThrow(RangeError);
    expect(() => matrixToPixels(M, 1.5)).toThrow(RangeError);
    expect(() => matrixToPixels(M, 2, -1)).toThrow(RangeError);
  });
});
