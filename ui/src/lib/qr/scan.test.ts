// SPDX-License-Identifier: GPL-3.0-only

// scan.test.ts — findQr: сначала 2000 px, при неудаче повтор в 1000 px.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ImageModule from './image';
import { blankPixels, qrPixels } from '../../test-utils/qrKit';
import type { Pixels } from './pixels';
import { SCAN_SIDES, findQr } from './scan';

// vi.mock поднимается выше импортов; ссылка на blobToPixels берётся лениво, при вызове.
const blobToPixels = vi.fn<(blob: Blob, side: number) => Promise<Pixels>>();
vi.mock('./image', async (original) => ({
  ...(await original<typeof ImageModule>()),
  blobToPixels: (blob: Blob, side: number): Promise<Pixels> => blobToPixels(blob, side),
}));

const LINK = 'trojan://pass@example.org:443#scan';
const file = new Blob(['img'], { type: 'image/png' });

afterEach(() => {
  blobToPixels.mockReset();
});

describe('findQr', () => {
  it('порядок попыток — 2000, затем 1000', () => {
    expect(SCAN_SIDES).toEqual([2000, 1000]);
  });

  it('код найден сразу: второй проход не нужен', async () => {
    blobToPixels.mockResolvedValue(qrPixels(LINK));
    await expect(findQr(file)).resolves.toBe(LINK);
    expect(blobToPixels.mock.calls.map((c) => c[1])).toEqual([2000]);
  });

  it('не нашли в 2000 — повтор в 1000 находит код', async () => {
    blobToPixels.mockImplementation((_b, side) =>
      Promise.resolve(side === 2000 ? blankPixels(400, 400) : qrPixels(LINK)),
    );
    await expect(findQr(file)).resolves.toBe(LINK);
    expect(blobToPixels.mock.calls.map((c) => c[1])).toEqual([2000, 1000]);
  });

  it('нигде нет кода — null после обеих попыток', async () => {
    blobToPixels.mockResolvedValue(blankPixels(300, 300));
    await expect(findQr(file)).resolves.toBeNull();
    // картинка 300×300 одинакова в обеих попытках: второй раз её не читаем,
    // но источник опрошен дважды (размер может отличаться)
    expect(blobToPixels.mock.calls.map((c) => c[1])).toEqual([2000, 1000]);
  });

  it('ошибка чтения картинки пробрасывается, а не превращается в «кода нет»', async () => {
    blobToPixels.mockRejectedValue(new Error('битая картинка'));
    await expect(findQr(file)).rejects.toThrow('битая картинка');
  });

  it('готовый кадр (снимок экрана) читается без createImageBitmap', async () => {
    await expect(findQr(qrPixels(LINK))).resolves.toBe(LINK);
    expect(blobToPixels).not.toHaveBeenCalled();
  });

  it('свои стороны попыток', async () => {
    blobToPixels.mockResolvedValue(blankPixels(50, 50));
    await findQr(file, [4096, 2000, 1000]);
    expect(blobToPixels.mock.calls.map((c) => c[1])).toEqual([4096, 2000, 1000]);
  });
});
