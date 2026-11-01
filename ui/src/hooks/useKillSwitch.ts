// SPDX-License-Identifier: GPL-3.0-only

// useKillSwitch.ts — kill switch системного прокси на стороне окна (хвосты B, 7.3):
//  - зеркалит настройку ядра в ui-state.json для оболочки (lib/killSwitch.ts);
//  - получает от оболочки `proxy-kept` (ядро умерло, прокси оставлен): ставит флаг,
//    помечает трей ошибкой и показывает системное уведомление;
//  - гасит флаг, когда подключение восстановлено или прокси снят.
// Тексты берёт отсюда: оболочка словарей не знает.
import { useEffect } from 'react';
import { CoreState } from '../gen/lavray_pb';
import { isSystemProxyApplied, onSystemProxyChange } from '../lib/connection';
import {
  clearProxyKept,
  killSwitchOn,
  listenProxyKept,
  markProxyKept,
  mirrorKillSwitch,
} from '../lib/killSwitch';
import { showNotification, windowIsAway } from '../lib/notify';
import { readShellPrefs } from '../lib/shellPrefs';
import { buildTrayUpdate, pushTrayUpdate } from '../lib/tray';
import type { SettingsMap } from './useSettingsSync';
import { useI18n } from './useI18n';

export function useKillSwitch(values: SettingsMap, state: CoreState): void {
  const { t, tf } = useI18n();

  // Карта пуста, пока настройки не прочитаны: зеркало не трогаем, иначе при
  // недоступном ядре оно сбросилось бы в «выключено».
  const loaded = Object.keys(values).length > 0;
  const on = killSwitchOn(values);
  useEffect(() => {
    if (loaded) mirrorKillSwitch(on);
  }, [loaded, on]);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    listenProxyKept(() => {
      markProxyKept();
      const tray = buildTrayUpdate({ state: CoreState.ERROR }, { t, tf });
      void pushTrayUpdate({ ...tray, labels: { ...tray.labels, status: `LAVRay — ${t('kill.tray')}` } }).catch(
        () => undefined,
      );
      if (windowIsAway() && readShellPrefs().notify) {
        void showNotification('error', 'LAVRay', t('kill.notify'));
      }
    })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
      stop?.();
    };
  }, [t, tf]);

  // Подключились снова — прокси уже работает; снят вручную — оставленного больше нет.
  useEffect(() => {
    if (state === CoreState.CONNECTED) clearProxyKept();
  }, [state]);
  useEffect(
    () =>
      onSystemProxyChange(() => {
        if (!isSystemProxyApplied()) clearProxyKept();
      }),
    [],
  );
}
