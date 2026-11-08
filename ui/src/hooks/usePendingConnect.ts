// SPDX-License-Identifier: GPL-3.0-only

// usePendingConnect.ts — довести подключение до конца после перезапуска от
// администратора (lib/pendingConnect.ts). Срабатывает один раз за запуск окна:
// когда ядро впервые ответило и ничего не подключено, а экземпляр запущен с
// `--elevated-relaunch` и намерение свежее. Подключает именно `connectWith`
// (а не переключатель: он при активном соединении отключил бы его). Ошибка —
// обычное уведомление; повторов и нового запроса UAC нет.
import { useEffect, useRef } from 'react';
import { CoreState } from '../gen/lavray_pb';
import { connectWith, loadModes } from '../lib/connection';
import { tunNeedsElevation } from '../lib/elevation';
import { wasRelaunchedAtStart } from '../lib/launch';
import { showNotification } from '../lib/notify';
import { takePendingConnect, type PendingConnect } from '../lib/pendingConnect';
import { readShellPrefs } from '../lib/shellPrefs';
import type { CoreClients } from '../lib/core';
import type { CoreStatus } from './useCore';
import { useCore } from './useCore';
import { useI18n } from './useI18n';

/** Порт входа, пока ядро его не сообщило. */
const DEFAULT_PORT = 2080;

async function resume(core: CoreClients, intent: PendingConnect, port: number): Promise<void> {
  const base = loadModes(window.localStorage);
  const modes = { sysProxy: base.sysProxy, tunMode: intent.mode === 'tun' };
  // Права так и не появились — не просим их второй раз и не подключаемся вслепую.
  if (modes.tunMode && (await tunNeedsElevation())) throw new Error('tun: no administrator rights');
  await connectWith({ core, profileId: intent.profileId, modes, port });
}

export function usePendingConnect(status: CoreStatus): void {
  const core = useCore();
  const { t } = useI18n();
  const handled = useRef(false);
  const ready = status.coreVersion !== '';
  const idle = status.state === CoreState.IDLE;
  const port = status.inbound?.port ?? DEFAULT_PORT;
  useEffect(() => {
    // Первый настоящий ответ ядра: до него состояние — заглушка «idle».
    if (!ready || handled.current) return;
    handled.current = true;
    // Берётся (и удаляется) всегда: намерение не должно пережить этот запуск.
    const intent = takePendingConnect(window.localStorage, Date.now());
    if (intent === null || !wasRelaunchedAtStart() || !idle) return;
    resume(core, intent, port).catch(() => {
      if (readShellPrefs().notify) void showNotification('error', 'LAVRay', t('notify.error'));
    });
  }, [ready, idle, core, port, t]);
}
