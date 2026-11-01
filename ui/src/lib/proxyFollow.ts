// SPDX-License-Identifier: GPL-3.0-only

// proxyFollow.ts — окно следует за состоянием ядра (MCP). Системный прокси ставит
// окно командой оболочки после СВОЕГО подключения; когда подключение сделал
// другой клиент (MCP-агент), окно по смене состояния ядра ставит и снимает
// прокси так же, как делает кнопка: подключилось извне в режиме системного
// прокси — применить, отключилось — снять. Собственные подключения окна сюда не
// вмешиваются (isOwnChangeBusy), поэтому set_system_proxy не вызывается дважды.
import { ConnectMode, CoreState } from '../gen/lavray_pb';

/** Что сделать с системным прокси. */
export type FollowAction = 'apply' | 'release' | null;

export interface FollowInput {
  /** Прежнее состояние ядра; null — это первый кадр, сравнивать не с чем. */
  readonly prev: CoreState | null;
  readonly next: CoreState;
  readonly mode: ConnectMode;
  /** Пользователь включил «Системный прокси» (как для кнопки подключения). */
  readonly sysProxyWanted: boolean;
  /** Окно уже применило прокси. */
  readonly applied: boolean;
  /** Идёт собственное изменение соединения окна. */
  readonly busy: boolean;
  /** Ядро упало, kill switch оставил прокси: снимает его только пользователь (по умолчанию нет). */
  readonly kept?: boolean;
}

/**
 * Решение по смене состояния ядра. Действует только на смену состояния, а не на
 * само состояние: неудавшееся применение прокси не повторяется каждую секунду, а
 * первый кадр после запуска окна (ядро могло быть подключено до него) ничего не
 * меняет.
 */
export function followAction(i: FollowInput): FollowAction {
  if (i.busy || i.prev === null || i.prev === i.next) return null;
  if (i.next === CoreState.CONNECTED) {
    // Режимы шлюза бывают только на роутере: там прокси ОС не ставится.
    const proxyMode = i.mode === ConnectMode.SYSTEM_PROXY || i.mode === ConnectMode.TUN;
    return proxyMode && i.sysProxyWanted && !i.applied ? 'apply' : null;
  }
  if ((i.next === CoreState.IDLE || i.next === CoreState.ERROR) && i.applied && i.kept !== true) {
    return 'release';
  }
  return null;
}
