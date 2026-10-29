/**
 * Клавиатура вкладок по WAI-ARIA (T-38). Повторяет `initTabs` прототипа
 * (design/prototype.html:4521-4530): ←/→ — предыдущая/следующая вкладка по
 * кругу, Home/End — первая/последняя; выбор вкладки переносит на неё фокус.
 */
import type { KeyboardEvent } from 'react';

/**
 * Индекс вкладки, на которую надо перейти после нажатия `key`, или null, если
 * клавиша не относится к вкладкам (или текущая вкладка неизвестна).
 */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (index < 0 || count <= 0) return null;
  let target: number;
  switch (key) {
    case 'ArrowRight':
      target = index + 1;
      break;
    case 'ArrowLeft':
      target = index - 1;
      break;
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = count - 1;
      break;
    default:
      return null;
  }
  return (target + count) % count;
}

/**
 * `onKeyDown` для контейнера `role="tablist"`: находит вкладки (`role="tab"`),
 * вызывает `select(индекс)` и переносит фокус на выбранную вкладку.
 */
export function onTablistKeyDown(
  e: KeyboardEvent<HTMLElement>,
  select: (index: number) => void,
): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const origin = e.target instanceof Node ? e.target : null;
  const current = tabs.findIndex((tab) => origin !== null && tab.contains(origin));
  const target = nextTabIndex(e.key, current, tabs.length);
  if (target === null) return;
  e.preventDefault();
  select(target);
  tabs[target]?.focus();
}
