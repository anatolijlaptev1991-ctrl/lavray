// SPDX-License-Identifier: GPL-3.0-only

// image.ts — картинка (файл, буфер обмена) в пиксели RGBA через
// createImageBitmap и canvas. Большие снимки уменьшаются так, чтобы длинная
// сторона не превышала maxSide: jsQR на 12-мегапиксельном фото медленный, а
// после усреднения шумный код нередко читается лучше.
import type { Pixels } from './pixels';

/** Длинная сторона по умолчанию: хватает и для скриншота, и для фото с телефона. */
export const DEFAULT_MAX_SIDE = 2000;

/** Размер, вписанный в maxSide с сохранением пропорций; меньшую картинку не растягивает. */
export function fitSize(w: number, h: number, maxSide: number): { readonly w: number; readonly h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { w, h };
  const k = maxSide / longest;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Рисует источник в новый canvas размера w×h на белом фоне и читает пиксели. */
function drawToPixels(src: CanvasImageSource, w: number, h: number): Pixels {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('canvas 2d недоступен');
  // Прозрачные пиксели читаются как чёрные (RGB=0): без белой подложки QR на
  // прозрачном PNG превращается в сплошной чёрный квадрат.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return { px: ctx.getImageData(0, 0, w, h).data, w, h };
}

/** Файл или вставленная картинка → пиксели не крупнее maxSide по длинной стороне. */
export async function blobToPixels(blob: Blob, maxSide = DEFAULT_MAX_SIDE): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) throw new Error('пустая картинка');
    const { w, h } = fitSize(bitmap.width, bitmap.height, maxSide);
    return drawToPixels(bitmap, w, h);
  } finally {
    bitmap.close();
  }
}

/** Готовые пиксели (снимок экрана) → не крупнее maxSide; меньший кадр возвращается как есть. */
export function shrinkPixels(frame: Pixels, maxSide = DEFAULT_MAX_SIDE): Pixels {
  const { w, h } = fitSize(frame.w, frame.h, maxSide);
  if (w === frame.w && h === frame.h) return frame;
  const source = document.createElement('canvas');
  source.width = frame.w;
  source.height = frame.h;
  const ctx = source.getContext('2d');
  if (ctx === null) throw new Error('canvas 2d недоступен');
  const image = ctx.createImageData(frame.w, frame.h);
  image.data.set(frame.px);
  ctx.putImageData(image, 0, 0);
  return drawToPixels(source, w, h);
}
