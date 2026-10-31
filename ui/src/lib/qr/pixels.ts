// SPDX-License-Identifier: GPL-3.0-only

// pixels.ts — картинка как пиксели RGBA: общий вид для файла, буфера обмена и
// снимка экрана. Длина px — ровно w*h*4, строки идут сверху вниз без отступов.
export interface Pixels {
  readonly px: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
}
