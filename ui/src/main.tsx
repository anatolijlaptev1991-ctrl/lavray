// SPDX-License-Identifier: GPL-3.0-only

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './prototype.css';
import './base.css';
import App from './App';
import { detectOS, osAttribute } from './platform/adapter';
import { FIRST_ENDPOINT_WAIT_MS, followShellEndpoint } from './lib/coreEndpoint';
import { installDropGuard } from './lib/external';
import { applyLaunchInfo } from './lib/launch';

// Нативный режим (Tauri): оболочка сообщает адрес и токен ядра командой
// core_endpoint (она дожидается готовности ядра) и событием core-endpoint при
// каждом перезапуске ядра — UI следует за ними без перезагрузки (T-03).
// Первый рендер ждёт адрес не дольше FIRST_ENDPOINT_WAIT_MS, чтобы окно не
// оставалось пустым, если ядро не стартует.
// Веб-режим: адрес из location.origin (панель и API за одним origin, cookie).
async function bootstrap(): Promise<void> {
  const tauri = (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (tauri !== undefined) {
    // T-81: перезапуск от администратора открывает новый профиль WebView —
    // язык, тема и режимы приходят от оболочки до первого рендера.
    await applyLaunchInfo(window.localStorage);
    await Promise.race([
      followShellEndpoint(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, FIRST_ENDPOINT_WAIT_MS);
      }),
    ]);
  }

  // data-shell на <html> (прототип): native в окне Tauri, browser в вебе.
  document.documentElement.dataset.shell = tauri !== undefined ? 'native' : 'browser';
  // data-os — словарь прототипа (win/mac/linux): от него зависят шрифты
  // ОС, «светофор» macOS и кнопки управления окном (CSS §titlebar).
  document.documentElement.dataset.os = osAttribute(detectOS(window));

  // Файл, брошенный мимо зоны импорта, не должен открыться вместо интерфейса.
  installDropGuard();

  const container = document.getElementById('root');
  if (container === null) {
    throw new Error('LAVRay: #root container not found');
  }
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
