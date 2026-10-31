// SPDX-License-Identifier: GPL-3.0-only

// image.test.ts — файл → пиксели: уменьшение до maxSide. В jsdom нет
// createImageBitmap и настоящего canvas, поэтому подменены оба (qrKit).
import { afterEach, describe, expect, it } from 'vitest';
import { blankPixels, installFakeImages, qrPixels } from '../../test-utils/qrKit';
import type { FakeImages } from '../../test-utils/qrKit';
import { blobToPixels, fitSize, shrinkPixels } from './image';

let fake: FakeImages | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

describe('fitSize', () => {
  it('меньшая или равная maxSide картинка не меняется (не растягивается)', () => {
    expect(fitSize(800, 600, 2000)).toEqual({ w: 800, h: 600 });
    expect(fitSize(2000, 1000, 2000)).toEqual({ w: 2000, h: 1000 });
  });

  it('длинная сторона становится maxSide, пропорции сохраняются', () => {
    expect(fitSize(4000, 3000, 2000)).toEqual({ w: 2000, h: 1500 });
    expect(fitSize(3000, 6000, 2000)).toEqual({ w: 1000, h: 2000 });
    expect(fitSize(12000, 1, 2000)).toEqual({ w: 2000, h: 1 }); // сторона не падает до 0
  });
});

describe('blobToPixels', () => {
  const blob = new Blob(['x'], { type: 'image/png' });

  it('downscales_large_image: 4000×3000 при maxSide=2000 рисуется как 2000×1500', async () => {
    fake = installFakeImages(blankPixels(2000, 1500), { w: 4000, h: 3000 });
    const out = await blobToPixels(blob, 2000);
    expect([out.w, out.h]).toEqual([2000, 1500]);
    expect(out.px.length).toBe(2000 * 1500 * 4);
    expect(fake.drawn).toEqual([{ w: 2000, h: 1500 }]);
  });

  it('второй проход: maxSide=1000 даёт 1000×750 из того же битмапа 4000×3000', async () => {
    fake = installFakeImages(blankPixels(1000, 750), { w: 4000, h: 3000 });
    const out = await blobToPixels(blob, 1000);
    expect([out.w, out.h]).toEqual([1000, 750]);
  });

  it('maxSide по умолчанию — 2000; маленькая картинка рисуется как есть', async () => {
    const frame = qrPixels('vless://x@example.org:443');
    fake = installFakeImages(frame);
    const out = await blobToPixels(blob);
    expect([out.w, out.h]).toEqual([frame.w, frame.h]);
    expect(out.px).toBe(frame.px);
  });

  it('битмап закрывается и после успеха, и после ошибки', async () => {
    fake = installFakeImages(blankPixels(10, 10));
    await blobToPixels(blob);
    expect(fake.bitmaps.map((b) => b.closed)).toEqual([true]);
    fake.restore();
    fake = installFakeImages(blankPixels(10, 10), { w: 0, h: 5 });
    await expect(blobToPixels(blob)).rejects.toThrow('пустая картинка');
    expect(fake.bitmaps.map((b) => b.closed)).toEqual([true]);
  });
});

describe('shrinkPixels', () => {
  it('кадр не крупнее maxSide возвращается как есть, без canvas', () => {
    const frame = blankPixels(300, 200);
    expect(shrinkPixels(frame, 2000)).toBe(frame);
  });

  it('крупный кадр кладётся в canvas и перерисовывается меньшим', () => {
    fake = installFakeImages(blankPixels(100, 50));
    const out = shrinkPixels(blankPixels(400, 200), 100);
    expect([out.w, out.h]).toEqual([100, 50]);
    expect(fake.puts.map((p) => [p.w, p.h])).toEqual([[400, 200]]);
    expect(fake.drawn).toEqual([{ w: 100, h: 50 }]);
  });
});
