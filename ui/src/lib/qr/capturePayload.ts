// SPDX-License-Identifier: GPL-3.0-only

// capturePayload.ts — разбор сырого ответа команды оболочки qr_capture_screen:
//   [u32 ширина LE][u32 высота LE][RGBA, ширина*высота*4 байт]
// Ответ приходит из invoke как ArrayBuffer (tauri::ipc::Response), без JSON и
// base64. Заголовку не верим: размеры и длина тела проверяются до того, как
// по ним создаётся массив пикселей.
import type { Pixels } from './pixels';

/** Байт в заголовке: две ширины u32. */
export const CAPTURE_HEADER_BYTES = 8;
/** Предельная сторона кадра; шире экрана с запасом (8K на несколько мониторов). */
export const CAPTURE_MAX_SIDE = 16384;

export type CapturePayloadProblem = 'type' | 'short' | 'size' | 'length';

/** Ответ оболочки не соответствует формату; reason — что именно не так. */
export class CapturePayloadError extends Error {
  constructor(readonly reason: CapturePayloadProblem) {
    super(`снимок экрана: неверный ответ оболочки (${reason})`);
    this.name = 'CapturePayloadError';
  }
}

/** Байты ответа: ArrayBuffer или его представление. Проверка по тегу, а не instanceof: буферы бывают из другого realm. */
function bytesOf(raw: unknown): Uint8Array {
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (Object.prototype.toString.call(raw) === '[object ArrayBuffer]') return new Uint8Array(raw as ArrayBuffer);
  throw new CapturePayloadError('type');
}

/** Разбирает ответ оболочки в кадр. @throws CapturePayloadError */
export function parseCapturePayload(raw: unknown): Pixels {
  const bytes = bytesOf(raw);
  if (bytes.byteLength < CAPTURE_HEADER_BYTES) throw new CapturePayloadError('short');
  const head = new DataView(bytes.buffer, bytes.byteOffset, CAPTURE_HEADER_BYTES);
  const w = head.getUint32(0, true);
  const h = head.getUint32(4, true);
  if (w === 0 || h === 0 || w > CAPTURE_MAX_SIDE || h > CAPTURE_MAX_SIDE) throw new CapturePayloadError('size');
  const body = bytes.byteLength - CAPTURE_HEADER_BYTES;
  if (body !== w * h * 4) throw new CapturePayloadError('length');
  // Представление поверх тех же байт: копировать десятки мегабайт ни к чему.
  const px = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + CAPTURE_HEADER_BYTES, body);
  return { px, w, h };
}
