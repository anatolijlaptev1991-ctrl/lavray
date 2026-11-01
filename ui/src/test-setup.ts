// SPDX-License-Identifier: GPL-3.0-only

// test-setup.ts — заглушки браузерных API, которых нет в jsdom.
// Нужны, чтобы монтирование экранов не сыпало «Not implemented» в лог:
// график трафика и подсветка TOC деградируют безопасно.
import { vi } from 'vitest';
import { deDict } from './lib/dictionaries/de';
import { esDict } from './lib/dictionaries/es';
import { ruDict } from './lib/dictionaries/ru';
import { zhDict } from './lib/dictionaries/zh';
import { registerDictionary } from './lib/i18n';

// D-3: в приложении словари ru/zh/es/de подгружаются лениво (i18nLoad.ts); в тестах
// все пять зарегистрированы заранее, поэтому t() и setLanguage() остаются синхронными.
registerDictionary('ru', ruDict);
registerDictionary('zh', zhDict);
registerDictionary('es', esDict);
registerDictionary('de', deDict);

// canvas: jsdom без пакета `canvas` не реализует getContext. Возвращаем
// минимальный 2D-контекст-пустышку — график просто ничего не рисует.
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  setLineDash: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// IntersectionObserver: подсветка оглавления настроек.
/* Заглушки-наблюдатели: методов достаточно объявить, тело пустое по смыслу. */
class IO {
  observe(): void {
    /* no-op: jsdom-заглушка */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
  takeRecords(): [] {
    return [];
  }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IO;

// ResizeObserver: адаптивные брейкпоинты.
class RO {
  observe(): void {
    /* no-op: jsdom-заглушка */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;

// matchMedia: jsdom реализует его сам (matches=false по умолчанию), поэтому
// отдельная заглушка не нужна — тема «как в системе» резолвится в light.
