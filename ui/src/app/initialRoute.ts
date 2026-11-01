// SPDX-License-Identifier: GPL-3.0-only

// initialRoute.ts — стартовый раздел и вкладка из хеша адреса (как в прототипе):
// `#screen=servers&tab=subscriptions` — для скриншотов и проверок. Неизвестный
// раздел игнорируется, вкладка берётся как есть (её сверяет App).
import { SECTIONS } from './sections';

export function initialRoute(hash: string): { section: string; tab: string } {
  const params = new URLSearchParams(hash.slice(1));
  const sec = params.get('screen') ?? '';
  const known = SECTIONS.find((x) => x.id === sec);
  return { section: known ? sec : 'connection', tab: params.get('tab') ?? '' };
}
