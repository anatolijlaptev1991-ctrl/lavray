// SPDX-License-Identifier: GPL-3.0-only

// bootError.ts — сообщение, если не загрузился словарь стартового языка (D-3):
// без словаря интерфейс отрисовать нечем, поэтому тексты здесь свои (по одному
// на каждый из пяти языков) и экран строится средствами DOM, без React и t().
// Разметка и стили те же, что у ошибки ворот веб-панели (#webLogin, .wl-card).
import type { Language } from '../lib/i18n';

interface BootText {
  readonly message: string;
  readonly retry: string;
}

const TEXT: Readonly<Record<Language, BootText>> = {
  ru: { message: 'Не удалось загрузить интерфейс. Проверьте соединение и повторите попытку.', retry: 'Повторить' },
  en: { message: 'Could not load the interface. Check your connection and try again.', retry: 'Retry' },
  zh: { message: '无法加载界面。请检查网络连接后重试。', retry: '重试' },
  es: { message: 'No se pudo cargar la interfaz. Compruebe la conexión e inténtelo de nuevo.', retry: 'Reintentar' },
  de: {
    message: 'Die Oberfläche konnte nicht geladen werden. Prüfen Sie die Verbindung und versuchen Sie es erneut.',
    retry: 'Erneut versuchen',
  },
};

/** Показать в `container` ошибку загрузки с кнопкой «Повторить» (перезагрузка окна). */
export function showBootError(container: HTMLElement, lang: Language): void {
  const text = TEXT[lang];
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = text.message;
  const retry = document.createElement('button');
  retry.className = 'btn btn-pri';
  retry.textContent = text.retry;
  retry.addEventListener('click', () => {
    window.location.reload();
  });
  const card = document.createElement('div');
  card.className = 'wl-card';
  card.append(message, retry);
  const wrap = document.createElement('div');
  wrap.id = 'webLogin';
  wrap.append(card);
  container.replaceChildren(wrap);
}
