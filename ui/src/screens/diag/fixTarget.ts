// SPDX-License-Identifier: GPL-3.0-only

// fixTarget.ts — куда ведёт кнопка исправления у проверки диагностики: хеш экрана
// по коду исправления (fix_code из RunSelfCheck). Вынесено из screen_diag.tsx.

/** Хеш-адрес экрана для кода исправления; неизвестный код — «Подключение». */
export function fixTarget(fixCode: string): string {
  switch (fixCode) {
    case 'open_dns':
      return 'screen=rules&tab=dns';
    case 'open_subscriptions':
    case 'open_subscription':
      return 'screen=servers&tab=subscriptions';
    case 'change_port':
    case 'restart_profile':
      return 'screen=settings';
    default:
      return 'screen=connection';
  }
}
