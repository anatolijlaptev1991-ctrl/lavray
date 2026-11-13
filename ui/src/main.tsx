// SPDX-License-Identifier: GPL-3.0-only

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './prototype.css';
import './base.css';
import App from './App';
import { showBootError } from './app/bootError';
import { initialRoute } from './app/initialRoute';
import { preloadRoute } from './app/lazyViews';
import { WebGate } from './screens/web/WebGate';
import { detectOS, osAttribute } from './platform/adapter';
import { FIRST_ENDPOINT_WAIT_MS, followShellEndpoint } from './lib/coreEndpoint';
import { installDropGuard } from './lib/external';
import { startupLanguage } from './lib/i18n';
import { loadLanguage } from './lib/i18nLoad';
import { loadLaunchInfo } from './lib/launch';
import { loadShellCaps } from './lib/shellCaps';
import { hydrateUiState, installUiStateSync } from './lib/uiState';

// Нативный режим (Tauri): оболочка сообщает адрес и токен ядра командой
// core_endpoint (она дожидается готовности ядра) и событием core-endpoint при
// каждом перезапуске ядра — UI следует за ними без перезагрузки (T-03).
// Первый рендер ждёт адрес не дольше FIRST_ENDPOINT_WAIT_MS, чтобы окно не
// оставалось пустым, если ядро не стартует.
// Веб-режим: адрес из location.origin (панель и API за одним origin, cookie).
async function bootstrap(): Promise<void> {
  // D-3: экран стартового раздела грузится параллельно с ожиданием оболочки и словаря.
  const route = initialRoute(window.location.hash);
  preloadRoute(route.section, route.tab);
  const tauri = (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (tauri !== undefined) {
    // T-81: у повышенного экземпляра свой профиль WebView, а язык, тема, режимы,
    // выбор сервера и признак онбординга общие: источник истины — файл оболочки,
    // localStorage — кэш. Значения применяются до первого рендера, а каждое
    // изменение отслеживаемых ключей дальше уходит в файл.
    await hydrateUiState(window.localStorage);
    installUiStateSync(window.localStorage);
    await loadLaunchInfo();
    // Что умеет эта ОС (самообновление, снимок экрана, трей, права для TUN): один раз до рендера.
    await loadShellCaps();
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
  // D-3: в главном чанке только en; словарь выбранного языка должен быть
  // зарегистрирован до первого рендера, иначе t() вернёт ключи.
  const lang = startupLanguage(window);
  try {
    await loadLanguage(lang);
  } catch {
    showBootError(container, lang);
    return;
  }
  createRoot(container).render(
    <StrictMode>
      <WebGate>
        <App />
      </WebGate>
    </StrictMode>,
  );
}

void bootstrap();
