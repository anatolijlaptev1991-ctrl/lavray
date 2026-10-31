// SPDX-License-Identifier: GPL-3.0-only

// capturePayload.test.ts — разбор ответа qr_capture_screen: [u32 w LE][u32 h LE][RGBA].
import { describe, expect, it } from 'vitest';
import { CAPTURE_MAX_SIDE, CapturePayloadError, parseCapturePayload } from './capturePayload';

/** Ответ оболочки: заголовок (w, h) и body байт тела. */
function payload(w: number, h: number, body: number): ArrayBuffer {
  const buf = new ArrayBuffer(8 + body);
  const view = new DataView(buf);
  view.setUint32(0, w, true);
  view.setUint32(4, h, true);
  return buf;
}

const reasonOf = (fn: () => unknown): string | null => {
  try {
    fn();
  } catch (e) {
    return e instanceof CapturePayloadError ? e.reason : `другая ошибка: ${String(e)}`;
  }
  return null;
};

describe('parseCapturePayload', () => {
  it('capture_payload_valid: заголовок little-endian, пиксели — тело после 8 байт', () => {
    const buf = payload(3, 2, 3 * 2 * 4);
    new Uint8Array(buf).set([9, 8, 7, 6], 8); // первый пиксель
    const { px, w, h } = parseCapturePayload(buf);
    expect([w, h]).toEqual([3, 2]);
    expect(px.length).toBe(24);
    expect(Array.from(px.slice(0, 4))).toEqual([9, 8, 7, 6]);
  });

  it('little-endian: 0x0102 = 258, а не 513', () => {
    const buf = new ArrayBuffer(8 + 258 * 1 * 4);
    const view = new DataView(buf);
    view.setUint8(0, 0x02);
    view.setUint8(1, 0x01);
    view.setUint8(4, 0x01);
    expect(parseCapturePayload(buf)).toMatchObject({ w: 258, h: 1 });
  });
});

describe('parseCapturePayload: отказы', () => {
  it('capture_payload_short_buffer_rejected: короче 8 байт', () => {
    expect(reasonOf(() => parseCapturePayload(new ArrayBuffer(0)))).toBe('short');
    expect(reasonOf(() => parseCapturePayload(new ArrayBuffer(7)))).toBe('short');
  });

  it('длина тела не равна w*h*4 — отказ (меньше и больше)', () => {
    expect(reasonOf(() => parseCapturePayload(payload(2, 2, 15)))).toBe('length');
    expect(reasonOf(() => parseCapturePayload(payload(2, 2, 17)))).toBe('length');
    expect(reasonOf(() => parseCapturePayload(payload(2, 2, 0)))).toBe('length');
  });

  it('нулевая ширина или высота — отказ', () => {
    expect(reasonOf(() => parseCapturePayload(payload(0, 2, 0)))).toBe('size');
    expect(reasonOf(() => parseCapturePayload(payload(2, 0, 0)))).toBe('size');
  });

  it('больше 16384 по любой стороне — отказ до выделения памяти', () => {
    expect(CAPTURE_MAX_SIDE).toBe(16384);
    expect(reasonOf(() => parseCapturePayload(payload(16385, 1, 16385 * 4)))).toBe('size');
    expect(reasonOf(() => parseCapturePayload(payload(1, 16385, 16385 * 4)))).toBe('size');
    expect(reasonOf(() => parseCapturePayload(payload(0xffffffff, 0xffffffff, 0)))).toBe('size');
    expect(parseCapturePayload(payload(16384, 1, 16384 * 4)).w).toBe(16384); // граница допустима
  });

  it('принимает представление (Uint8Array со смещением) и отвергает не буфер', () => {
    const inner = new Uint8Array(payload(1, 1, 4));
    const host = new Uint8Array(3 + inner.length);
    host.set(inner, 3);
    expect(parseCapturePayload(host.subarray(3))).toMatchObject({ w: 1, h: 1 });
    expect(reasonOf(() => parseCapturePayload('строка'))).toBe('type');
    expect(reasonOf(() => parseCapturePayload(null))).toBe('type');
    expect(reasonOf(() => parseCapturePayload([1, 2, 3]))).toBe('type');
  });
});
