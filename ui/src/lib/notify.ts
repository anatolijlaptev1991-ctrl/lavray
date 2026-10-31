// SPDX-License-Identifier: GPL-3.0-only

// notify.ts — системные уведомления о подключении (T-82). Что сообщать,
// решается по смене состояния ядра; тексты — только ключи словаря, без
// подстановок: в уведомление (и в центр уведомлений ОС) не попадают имя
// сервера и адреса. Показывает оболочка (`notify_show`), она же учитывает
// настройку и не даёт повторять одно и то же чаще раза в 2 с.
import { CoreState } from '../gen/lavray_pb';
import type { MessageKey } from './i18n';

export type NotifyKind = 'connected' | 'disconnected' | 'error';

const BODY_KEY: Readonly<Record<NotifyKind, MessageKey>> = {
  connected: 'notify.connected',
  disconnected: 'notify.disconnected',
  error: 'notify.error',
};

/** О чём сообщить при смене состояния; `null` — ни о чём (в том числе первый замер). */
export function notifyKindFor(prev: CoreState | null, next: CoreState): NotifyKind | null {
  if (prev === null || prev === next) return null;
  if (next === CoreState.ERROR) return 'error';
  if (next === CoreState.CONNECTED) return 'connected';
  if (next === CoreState.IDLE && prev !== CoreState.ERROR && prev !== CoreState.CONNECTING) {
    return 'disconnected';
  }
  return null;
}

/** Заголовок и текст уведомления на языке интерфейса. */
export function notifyText(kind: NotifyKind, t: (key: MessageKey) => string): { title: string; body: string } {
  return { title: 'LAVRay', body: t(BODY_KEY[kind]) };
}

/** Окно не на виду: уведомление нужно, иначе состояние и так видно. */
export function windowIsAway(doc: Document = document): boolean {
  return doc.hidden || !doc.hasFocus();
}

const inShell = (): boolean => (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

/** Показать уведомление; `false` — вне окна приложения, подавлено или ошибка оболочки. */
export async function showNotification(kind: NotifyKind, title: string, body: string): Promise<boolean> {
  if (!inShell()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<unknown>('notify_show', { kind, title, body })) === true;
  } catch {
    return false;
  }
}
