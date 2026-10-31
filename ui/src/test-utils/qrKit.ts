// SPDX-License-Identifier: GPL-3.0-only

// qrKit.ts — общие подставки тестов QR: ссылки с фиксированным зерном, код как
// пиксели (в том числе инвертированный), подмена createImageBitmap и canvas
// (в jsdom их нет) и снимок оболочки в формате qr_capture_screen. Тестов в
// файле нет.
import { vi } from 'vitest';
import { qrMatrix } from '../lib/qr/encode';
import type { Pixels } from '../lib/qr/pixels';
import { matrixToPixels } from '../lib/qr/raster';

/** Генератор mulberry32: одно зерно — одна и та же последовательность. */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~%=&+';
const SCHEMES = ['vless', 'vmess', 'trojan', 'ss', 'hysteria2', 'tuic', 'https'];
const NAMES = ['Frankfurt', 'Москва-1', '東京', 'NL | fast', 'Wien ♥'];

/** n ссылок разной длины (20…400 символов), часть — с не-ASCII именем: так их видит пользователь. */
export function seededLinks(n: number, seed: number): string[] {
  const rnd = seededRandom(seed);
  const pick = (from: string, len: number): string =>
    Array.from({ length: len }, () => from[Math.floor(rnd() * from.length)] ?? 'a').join('');
  return Array.from({ length: n }, () => {
    const scheme = SCHEMES[Math.floor(rnd() * SCHEMES.length)] ?? 'vless';
    const body = pick(ALPHABET, 10 + Math.floor(rnd() * 380));
    const name = NAMES[Math.floor(rnd() * NAMES.length)] ?? '';
    return `${scheme}://${body}@example.org:443#${rnd() < 0.5 ? name : ''}`;
  });
}

/** Ссылка → картинка QR-кода: чёрное на белом, модуль — scale пикселей. */
export function qrPixels(text: string, scale = 4): Pixels {
  return matrixToPixels(qrMatrix(text), scale);
}

/** Негатив: светлый код на тёмном фоне (альфа остаётся 255). */
export function invertPixels(src: Pixels): Pixels {
  const px = new Uint8ClampedArray(src.px);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 255 - (px[i] ?? 0);
    px[i + 1] = 255 - (px[i + 1] ?? 0);
    px[i + 2] = 255 - (px[i + 2] ?? 0);
  }
  return { px, w: src.w, h: src.h };
}

/** Однотонная картинка без кода. */
export function blankPixels(w: number, h: number, value = 255): Pixels {
  return { px: new Uint8ClampedArray(w * h * 4).fill(value), w, h };
}

/** Что видели подмены: размеры, в которые рисовали, и кадры, положенные в canvas. */
export interface FakeImages {
  readonly bitmaps: { w: number; h: number; closed: boolean }[];
  readonly drawn: { w: number; h: number }[];
  readonly puts: Pixels[];
  readonly restore: () => void;
}

/**
 * Подмена createImageBitmap и canvas 2D. Битмап имеет размер bitmapSize
 * (по умолчанию как frame); чтение пикселей отдаёт frame, если размер canvas
 * совпал с кадром, иначе белый лист нужного размера.
 */
export function installFakeImages(frame: Pixels, bitmapSize?: { w: number; h: number }): FakeImages {
  const size = bitmapSize ?? { w: frame.w, h: frame.h };
  const seen: FakeImages = { bitmaps: [], drawn: [], puts: [], restore: (): void => undefined };
  const original = globalThis.createImageBitmap as typeof createImageBitmap | undefined;
  globalThis.createImageBitmap = vi.fn((): Promise<ImageBitmap> => {
    const entry = { ...size, closed: false };
    seen.bitmaps.push(entry);
    return Promise.resolve({
      width: size.w,
      height: size.h,
      close: (): void => {
        entry.closed = true;
      },
    } as ImageBitmap);
  });
  const ctx = {
    fillStyle: '',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    fillRect: vi.fn(),
    drawImage: vi.fn((_src: unknown, _x: number, _y: number, w: number, h: number): void => {
      seen.drawn.push({ w, h });
    }),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      data: w === frame.w && h === frame.h ? frame.px : blankPixels(w, h).px,
      width: w,
      height: h,
    })),
    createImageData: vi.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
    putImageData: vi.fn((img: { data: Uint8ClampedArray; width: number; height: number }): void => {
      seen.puts.push({ px: img.data, w: img.width, h: img.height });
    }),
  };
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation((() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  return {
    ...seen,
    restore: (): void => {
      spy.mockRestore();
      if (original === undefined) delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
      else globalThis.createImageBitmap = original;
    },
  };
}

/** Снимок в формате ответа qr_capture_screen: [u32 w LE][u32 h LE][RGBA]. */
export function capturePayloadOf(frame: Pixels): Uint8Array {
  const out = new Uint8Array(8 + frame.px.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, frame.w, true);
  view.setUint32(4, frame.h, true);
  out.set(frame.px, 8);
  return out;
}

/** Событие вставки с содержимым буфера обмена (jsdom не умеет ClipboardEvent). */
export function pasteEvent(files: readonly File[], text = ''): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  const items = [
    ...files.map((f) => ({ kind: 'file', type: f.type, getAsFile: (): File => f })),
    ...(text === '' ? [] : [{ kind: 'string', type: 'text/plain', getAsFile: (): null => null }]),
  ];
  Object.defineProperty(event, 'clipboardData', { value: { files, items, getData: (): string => text } });
  return event;
}
