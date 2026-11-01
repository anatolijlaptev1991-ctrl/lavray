// SPDX-License-Identifier: GPL-3.0-only

// useKillSwitch.ts — kill switch системного прокси на стороне окна (хвосты B, 7.3):
//  - зеркалит настройку ядра в ui-state.json для оболочки (lib/killSwitch.ts);
//  - при запуске спрашивает оболочку, оставлен ли прокси: после перезагрузки окна
//    событие `proxy-kept` уже прошло, а баннер должен остаться;
//  - получает от оболочки `proxy-kept` (ядро умерло, прокси оставлен): ставит флаг и
//    показывает системное уведомление (трей помечает useTrayBridge по тому же флагу);
//  - гасит флаг, когда подключение восстановлено или прокси снят.
// Тексты берёт отсюда: оболочка словарей не знает.
import { useEffect } from 'react';
import { CoreState } from '../gen/lavray_pb';
import { isSystemProxyApplied, markSystemProxy, onSystemProxyChange } from '../lib/connection';
import {
  clearProxyKept,
  killSwitchOn,
  listenProxyKept,
  markProxyKept,
  mirrorKillSwitch,
  queryProxyKept,
} from '../lib/killSwitch';
import { showNotification } from '../lib/notify';
import { readShellPrefs } from '../lib/shellPrefs';
import type { SettingsMap } from './useSettingsSync';
import { useI18n } from './useI18n';

export function useKillSwitch(values: SettingsMap, state: CoreState): void {
  const { t } = useI18n();

  // Карта пуста, пока настройки не прочитаны: зеркало не трогаем, иначе при
  // недоступном ядре оно сбросилось бы в «выключено».
  const loaded = Object.keys(values).length > 0;
  const on = killSwitchOn(values);
  useEffect(() => {
    if (loaded) mirrorKillSwitch(on);
  }, [loaded, on]);

  // Перезагрузка окна: прокси мог быть оставлен до неё. Окно «забыло», что применило
  // прокси, поэтому и это восстанавливаем — иначе баннер скрыт как «прокси не применён».
  useEffect(() => {
    const guard = { live: true };
    void queryProxyKept().then((kept) => {
      if (!guard.live || !kept) return;
      markSystemProxy(true);
      markProxyKept();
    });
    return (): void => {
      guard.live = false;
    };
  }, []);

  // Уведомление при падении ядра с оставленным прокси: независимо от того, на виду ли
  // окно (пользователь должен узнать, почему пропал интернет), но с учётом общей
  // настройки уведомлений.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    listenProxyKept(() => {
      markProxyKept();
      if (readShellPrefs().notify) void showNotification('error', 'LAVRay', t('kill.notify'));
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
  }, [t]);

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
