// SPDX-License-Identifier: GPL-3.0-only

// decode.test.ts — кодирование → растр → распознавание: ссылки возвращаются
// байт в байт, в том числе с кириллицей и в негативе; без кода — null.
import { describe, expect, it } from 'vitest';
import { blankPixels, invertPixels, qrPixels, seededLinks } from '../../test-utils/qrKit';
import { decodeQrFromPixels } from './decode';

describe('decodeQrFromPixels', () => {
  it('decodes_generated_qr: 50 ссылок с фиксированным зерном возвращаются без потерь', () => {
    const links = seededLinks(50, 20261031);
    expect(new Set(links).size).toBe(50);
    expect(
      links.some((l) => Array.from(l).some((ch) => (ch.codePointAt(0) ?? 0) > 127)),
      'часть ссылок не-ASCII',
    ).toBe(true);
    for (const link of links) {
      const { px, w, h } = qrPixels(link);
      expect(decodeQrFromPixels(px, w, h)).toBe(link);
    }
  });

  it('returns_null_without_qr: пустой лист и шум дают null', () => {
    const blank = blankPixels(200, 200);
    expect(decodeQrFromPixels(blank.px, blank.w, blank.h)).toBeNull();
    const noise = blankPixels(120, 120);
    for (let i = 0; i < noise.px.length; i += 4) {
      const v = (i * 7919) % 256;
      noise.px.set([v, v, v], i);
    }
    expect(decodeQrFromPixels(noise.px, noise.w, noise.h)).toBeNull();
  });

  it('inverted_qr_decoded: светлый код на тёмном фоне тоже читается', () => {
    const link = 'vless://b831381d-6324-4d53-ad4f-8cda48b30811@example.org:443?security=reality#inv';
    const { px, w, h } = invertPixels(qrPixels(link));
    expect(decodeQrFromPixels(px, w, h)).toBe(link);
  });

  it('размеры не сходятся с длиной буфера — null, а не чтение за границей', () => {
    const { px } = qrPixels('vless://x@example.org:443');
    expect(decodeQrFromPixels(px, 5000, 5000)).toBeNull();
    expect(decodeQrFromPixels(px, 0, 10)).toBeNull();
    expect(decodeQrFromPixels(px, 10.5, 10)).toBeNull();
  });
});
