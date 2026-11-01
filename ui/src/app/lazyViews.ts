// SPDX-License-Identifier: GPL-3.0-only

// lazyViews.ts — экраны разделов как отдельные чанки (D-3): в главный бандл
// входит только каркас приложения, экран грузится при первом открытии. Выбор
// экрана по разделу и вкладке (`screenIdOf`) общий для App и для предзагрузки
// стартового экрана в main.tsx, чтобы запрос чанка шёл параллельно со словарём.
import { SECTIONS } from './sections';
import { lazyView } from '../lib/lazyView';

export type ScreenId =
  | 'connection'
  | 'servers'
  | 'subscriptions'
  | 'rules'
  | 'dns'
  | 'checks'
  | 'conns'
  | 'log'
  | 'settings'
  | 'updates';

/** Экран раздела `sectionId` и вкладки `tabId`; неизвестный раздел — `null`. */
export function screenIdOf(sectionId: string, tabId: string | undefined): ScreenId | null {
  switch (sectionId) {
    case 'connection':
      return 'connection';
    case 'servers':
      return tabId === 'subscriptions' ? 'subscriptions' : 'servers';
    case 'rules':
      return tabId === 'dns' ? 'dns' : 'rules';
    case 'diag':
      return tabId === 'conns' || tabId === 'log' ? tabId : 'checks';
    case 'settings':
      return tabId === 'updates' ? 'updates' : 'settings';
    default:
      return null;
  }
}

const LOADERS = {
  connection: () => import('../screens/screen_connection').then((m) => m.ConnectionScreen),
  servers: () => import('../screens/screen_servers').then((m) => m.ServersScreen),
  subscriptions: () => import('../screens/screen_subscriptions').then((m) => m.SubscriptionsScreen),
  rules: () => import('../screens/rules/RulesScreen').then((m) => m.RulesScreen),
  dns: () => import('../screens/screen_dns').then((m) => m.DnsScreen),
  checks: () => import('../screens/screen_diag').then((m) => m.DiagScreen),
  conns: () => import('../screens/conns/ConnsScreen').then((m) => m.ConnsScreen),
  log: () => import('../screens/screen_log').then((m) => m.LogScreen),
  settings: () => import('../screens/screen_settings').then((m) => m.SettingsScreen),
  updates: () => import('../screens/updates/UpdatesScreen').then((m) => m.UpdatesScreen),
} as const;

export const ConnectionScreen = lazyView(LOADERS.connection);
export const ServersScreen = lazyView(LOADERS.servers);
export const SubscriptionsScreen = lazyView(LOADERS.subscriptions);
export const RulesScreen = lazyView(LOADERS.rules);
export const DnsScreen = lazyView(LOADERS.dns);
export const DiagScreen = lazyView(LOADERS.checks);
export const ConnsScreen = lazyView(LOADERS.conns);
export const LogScreen = lazyView(LOADERS.log);
export const SettingsScreen = lazyView(LOADERS.settings);
export const UpdatesScreen = lazyView(LOADERS.updates);

/**
 * Начать загрузку стартового экрана, не дожидаясь первого рендера. Ошибку
 * молча глотаем только здесь: рендер сам запросит чанк и покажет LazyBoundary.
 */
export function preloadRoute(sectionId: string, tabId: string): void {
  const tab = tabId === '' ? SECTIONS.find((s) => s.id === sectionId)?.tabs[0]?.id : tabId;
  const id = screenIdOf(sectionId, tab);
  if (id !== null) LOADERS[id]().catch(() => undefined);
}
