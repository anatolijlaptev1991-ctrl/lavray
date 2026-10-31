// SPDX-License-Identifier: GPL-3.0-only

// captureScreen.test.ts — снимок экрана: вне Tauri null, в Tauri — команда
// qr_capture_screen без аргументов и разбор сырого ответа.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePayloadOf, qrPixels } from '../../test-utils/qrKit';
import { enableTauri, tauri } from '../../test-utils/tauriStub';
import { CapturePayloadError } from './capturePayload';
import { CAPTURE_COMMAND, canCaptureScreen, captureScreen } from './captureScreen';

vi.mock('@tauri-apps/api/core', async () => (await import('../../test-utils/tauriStub')).tauriCoreModule);

beforeEach(() => {
  tauri.reset();
});
afterEach(() => {
  tauri.reset();
});

describe('captureScreen', () => {
  it('вне Tauri — null, оболочку не трогаем', async () => {
    expect(canCaptureScreen()).toBe(false);
    await expect(captureScreen()).resolves.toBeNull();
    expect(tauri.calls).toEqual([]);
  });

  it('в Tauri вызывает qr_capture_screen без аргументов и разбирает ArrayBuffer', async () => {
    const frame = qrPixels('vless://x@example.org:443#cap');
    tauri.onRaw(CAPTURE_COMMAND, capturePayloadOf(frame));
    enableTauri();
    expect(canCaptureScreen()).toBe(true);
    const got = await captureScreen();
    expect(CAPTURE_COMMAND).toBe('qr_capture_screen');
    expect(tauri.calls).toEqual([{ cmd: 'qr_capture_screen', args: undefined }]);
    expect([got?.w, got?.h]).toEqual([frame.w, frame.h]);
    expect(Array.from(got?.px ?? [])).toEqual(Array.from(frame.px));
  });

  it('неверный ответ оболочки — CapturePayloadError', async () => {
    tauri.onRaw(CAPTURE_COMMAND, new Uint8Array([1, 2, 3]));
    enableTauri();
    await expect(captureScreen()).rejects.toBeInstanceOf(CapturePayloadError);
  });

  it('отказ оболочки (Err(String)) пробрасывается как есть', async () => {
    tauri.onError(CAPTURE_COMMAND, 'нет доступа к экрану');
    enableTauri();
    await expect(captureScreen()).rejects.toBe('нет доступа к экрану');
  });
});
