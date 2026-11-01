// SPDX-License-Identifier: GPL-3.0-only

// messageText.ts — текст WebMessage на языке интерфейса.
import type { MessageKey } from '../../lib/i18n';
import type { WebMessage } from '../../lib/webSession';

type Tr = (key: MessageKey) => string;
type Tf = (key: MessageKey, params: Readonly<Record<string, string | number>>) => string;

/** Ключ словаря с параметрами → готовая фраза; готовый текст ядра — как есть. */
export function messageText(message: WebMessage, t: Tr, tf: Tf): string {
  if ('text' in message) return message.text;
  return message.params === undefined ? t(message.key) : tf(message.key, message.params);
}
