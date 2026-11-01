// SPDX-License-Identifier: GPL-3.0-only

// WebSessionContext.ts — что WebGate отдаёт вложенному приложению: имя
// пользователя и выход. Вне WebGate (оболочка, dev) контекста нет — панель
// сессий не показывается.
import { createContext } from 'react';

export interface WebSessionControls {
  readonly username: string;
  readonly logout: () => Promise<void>;
}

export const WebSessionContext = createContext<WebSessionControls | null>(null);
