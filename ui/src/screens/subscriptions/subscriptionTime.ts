// SPDX-License-Identifier: GPL-3.0-only

// subscriptionTime.ts — сроки подписки для карточки: когда обновится в следующий раз
// и относительная дата («через 2 дня»). Вынесено из screen_subscriptions.tsx.
import type { Group } from '../../gen/lavray_pb';

/**
 * Когда подписка обновится в следующий раз: последнее обновление + интервал
 * (свой, иначе рекомендованный провайдером). null — автообновления нет.
 */
export function nextUpdateMs(g: Group): number | null {
  if (g.skipAutoUpdate || g.lastUpdateMs === undefined) return null;
  const own = g.updateIntervalMin ?? 0;
  const minutes = own > 0 ? own : (g.subscriptionInfo?.updateIntervalHours ?? 0) * 60;
  return minutes > 0 ? Number(g.lastUpdateMs) + minutes * 60e3 : null;
}

export function relDate(ms: number, lang: string): string {
  const diff = ms - Date.now();
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
  if (abs < 864e5) return rtf.format(Math.round(diff / 3600e3), 'hour');
  return rtf.format(Math.round(diff / 864e5), 'day');
}
