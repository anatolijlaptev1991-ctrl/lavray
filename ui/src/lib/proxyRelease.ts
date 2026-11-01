// SPDX-License-Identifier: GPL-3.0-only

// proxyRelease.ts — автоматическое снятие системного прокси окном (следование за
// ядром, MCP). Kill switch: пока оболочка говорит «оставлен», окно сам прокси не
// снимает — только пользователь («Снять прокси», «Отключить») или выход.
import { applySystemProxy } from './connection';
import { isProxyKept, markProxyKept, queryProxyKept } from './killSwitch';

/**
 * Снять прокси, если он не оставлен kill switch. Событие «адреса ядра нет» может
 * прийти раньше `proxy-kept`, поэтому флаг окна не единственный источник: решает
 * ответ оболочки. Возвращает `true`, если прокси снят.
 */
export async function releaseUnlessKept(): Promise<boolean> {
  if (isProxyKept() || (await queryProxyKept())) {
    markProxyKept();
    return false;
  }
  await applySystemProxy(false, 0);
  return true;
}
