// SPDX-License-Identifier: GPL-3.0-only

// ScreenHost.tsx — текущий экран раздела (D-3): экраны грузятся лениво, поэтому
// живут под LazyBoundary (статус загрузки и «Повторить»). key по экрану сбрасывает
// ошибку загрузки при переходе в другой раздел.
import type { JSX } from 'react';
import {
  ConnectionScreen,
  ConnsScreen,
  DiagScreen,
  DnsScreen,
  LogScreen,
  RulesScreen,
  ServersScreen,
  SettingsScreen,
  SubscriptionsScreen,
  UpdatesScreen,
  type ScreenId,
} from '../app/lazyViews';
import { LazyBoundary } from './LazyBoundary';

interface ScreenHostProps {
  readonly screenId: ScreenId | null;
  /** Открыт ли мастер: после его закрытия экран подключения перечитывает режимы (T-73). */
  readonly onboarding: boolean;
  readonly connOn: boolean;
}

export function ScreenHost({ screenId, onboarding, connOn }: ScreenHostProps): JSX.Element {
  return (
    <LazyBoundary key={screenId ?? ''}>
      {screenId === 'connection' && <ConnectionScreen key={onboarding ? 'onboarding' : 'ready'} />}
      {screenId === 'servers' && <ServersScreen />}
      {screenId === 'subscriptions' && <SubscriptionsScreen />}
      {screenId === 'rules' && <RulesScreen />}
      {screenId === 'dns' && <DnsScreen />}
      {screenId === 'conns' && <ConnsScreen active={connOn} />}
      {screenId === 'log' && <LogScreen />}
      {screenId === 'checks' && <DiagScreen />}
      {screenId === 'settings' && <SettingsScreen />}
      {screenId === 'updates' && <UpdatesScreen />}
    </LazyBoundary>
  );
}
