// SPDX-License-Identifier: GPL-3.0-only

// captureScreen.ts — снимок экрана для поиска QR-кода. Снимает оболочка Tauri:
// в браузере и веб-панели такой возможности нет, там работают файл и вставка.

import { getShellCaps } from '../shellCaps';
import { parseCapturePayload } from './capturePayload';
import type { Pixels } from './pixels';

/** Команда оболочки (shell/): без аргументов, ответ — ArrayBuffer формата capturePayload. */
export const CAPTURE_COMMAND = 'qr_capture_screen';

/**
 * Есть ли оболочка, которая умеет снимать экран (кнопка «Снять экран» только там).
 * На Linux снимок недоступен (`screenCapture: false`): остаются файл и вставка.
 */
export function canCaptureScreen(): boolean {
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined && getShellCaps().screenCapture;
}

/**
 * Снимок экрана целиком в пикселях RGBA. Вне оболочки — null. Отказ оболочки
 * (строка из Err(String)) и неверный ответ (CapturePayloadError) пробрасываются.
 */
export async function captureScreen(): Promise<Pixels | null> {
  if (!canCaptureScreen()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return parseCapturePayload(await invoke<unknown>(CAPTURE_COMMAND));
}
