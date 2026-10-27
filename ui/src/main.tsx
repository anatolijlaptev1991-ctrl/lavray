import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './base.css';
import './app.css';
import App from './App';

// Нативный режим (Tauri): оболочка сообщает адрес и токен ядра через
// команду core_endpoint ДО первого рендера — UI сразу говорит с ядром.
// Веб-режим: адрес из location.origin (панель и API за одним origin, cookie).
async function bootstrap(): Promise<void> {
  const tauri = (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (tauri !== undefined) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const [url, token] = await invoke<[string, string]>('core_endpoint');
      if (url !== '') {
        window.__LAVRAY_CORE_URL = 'http://' + url.replace(/^tcp:\/\//, '');
        window.__LAVRAY_CORE_TOKEN = token;
      }
    } catch {
      /* ядро не поднялось — UI покажет «Отключено» */
    }
  }

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
