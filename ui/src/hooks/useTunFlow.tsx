// SPDX-License-Identifier: GPL-3.0-only

// useTunFlow.tsx — поток «режиму TUN нужны права» на экране «Подключение».
// Windows (`tunAccess: 'admin'`): диалог «Перезапустить от администратора»,
// поведение прежнее. Linux (`'grant'`): состояние даёт `tun_access_state`;
// `ready` — подключаем (если ядру нужен перезапуск — сначала `restart_core` и
// ожидание его адреса), `grantable`/`manual`/`unavailable` — диалог выдачи
// разрешения, после которого отложенное действие (подключение или включение
// TUN) продолжается само.
//
// Отмена: закрытие диалога (кнопка, Esc) меняет «эпоху» — любое действие,
// начатое раньше, перед продолжением сверяется с ней и тихо прекращается: VPN не
// должен подключиться после отказа. Перезапуск ядра идёт одним промисом: второй
// вызов ждёт его, а не считает перезапуск сделанным.
import { useCallback, useRef, useState } from 'react';
import type { JSX, MutableRefObject } from 'react';
import { TunDialog } from '../components/TunDialog';
import { TunGrantDialog, type GrantDialogGate } from '../components/TunGrantDialog';
import { restartCoreAndWait } from '../lib/coreRestart';
import { tunGate, type RelaunchOutcome } from '../lib/elevation';
import { gateFromAccess, grantTunAccess, readTunAccess, type GrantOutcome, type TunGate } from '../lib/tunAccess';
import { useShellCaps } from './useShellCaps';

/** Что продолжить после выдачи прав. */
export type TunThen = 'connect' | 'enable' | 'none';

export interface TunActions {
  readonly connect: () => void;
  /** Включить TUN; `reconnect` — потом заново подключиться (ядро перезапускали, соединение пропало). */
  readonly enable: (reconnect?: boolean) => void;
  /** Ядро сейчас подключено: после перезапуска соединение надо восстановить. */
  readonly connected: boolean;
}

export interface TunFlow {
  /** `true` — права есть, можно продолжать; `false` — показан диалог либо идёт перезапуск ядра (действие продолжится само). */
  readonly guard: (then: TunThen) => Promise<boolean>;
  /** Диалог по уже известному решению (просьба из трея, кнопка баннера). */
  readonly open: (gate: TunGate, then: TunThen) => void;
  readonly element: JSX.Element | null;
}

interface Args {
  readonly relaunch: () => Promise<RelaunchOutcome>;
  /** Свежие обработчики экрана: после перезапуска ядра клиенты другие. */
  readonly actions: MutableRefObject<TunActions>;
  /** Состояние доступа изменилось (права выданы) — обновить баннер. */
  readonly onAccessChanged: () => void;
}

interface GrantState {
  readonly gate: GrantDialogGate;
  readonly then: TunThen;
}

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

export function useTunFlow({ relaunch, actions, onAccessChanged }: Args): TunFlow {
  const admin = useShellCaps().tunAccess === 'admin';
  const [adminOpen, setAdminOpen] = useState(false);
  const [grant, setGrant] = useState<GrantState | null>(null);
  const epoch = useRef(0);
  // Идущий перезапуск ядра и признак «только что перезапускали» (защита от цикла).
  const restarting = useRef<Promise<void> | null>(null);
  const justRestarted = useRef(false);

  const restart = useCallback((): Promise<void> => {
    restarting.current ??= restartCoreAndWait().finally(() => {
      restarting.current = null;
    });
    return restarting.current;
  }, []);

  /** Отменить всё начатое и сбросить признаки (закрытие диалога, новое решение). */
  const cancel = useCallback((): void => {
    epoch.current += 1;
    justRestarted.current = false;
  }, []);

  const resume = useCallback(
    (then: TunThen, reconnect = false): void => {
      const mine = epoch.current;
      void tick().then(() => {
        if (mine !== epoch.current) return;
        if (then === 'enable') actions.current.enable(reconnect);
        else if (then === 'connect' || reconnect) actions.current.connect();
      });
    },
    [actions],
  );

  const open = useCallback(
    (gate: TunGate, then: TunThen): void => {
      if (gate.kind === 'ready') return;
      if (admin) setAdminOpen(true);
      else setGrant({ gate: gate.kind === 'elevate' ? { kind: 'unavailable', reason: '' } : gate, then });
    },
    [admin],
  );

  const guard = useCallback(
    async (then: TunThen): Promise<boolean> => {
      const mine = epoch.current;
      const gate = await tunGate();
      if (mine !== epoch.current) return false;
      if (gate.kind !== 'ready') {
        justRestarted.current = false;
        open(gate, then);
        return false;
      }
      if (!gate.restartCore || justRestarted.current) {
        justRestarted.current = false;
        return true;
      }
      const running = restarting.current !== null;
      // Перезапуск рвёт соединение: если оно было, его надо восстановить, что бы ни было намерением.
      const wasOn = actions.current.connected;
      try {
        await restart();
      } catch {
        if (mine === epoch.current && !running) setGrant({ gate: { kind: 'unavailable', reason: 'restart' }, then });
        return false;
      }
      // Второй вызов во время перезапуска только ждал его: продолжит первый.
      if (mine !== epoch.current || running) return false;
      justRestarted.current = then !== 'none' || wasOn;
      resume(then, wasOn);
      return false;
    },
    [open, resume, restart, actions],
  );

  const doGrant = useCallback(
    async (then: TunThen): Promise<GrantOutcome> => {
      const mine = epoch.current;
      const outcome = await grantTunAccess();
      if (outcome === 'cancelled') return outcome;
      const gate = gateFromAccess(await readTunAccess());
      if (gate.kind !== 'ready') throw new Error('not_grantable');
      const wasOn = actions.current.connected;
      if (gate.restartCore) await restart();
      // Диалог закрыли, пока шла выдача или перезапуск: намерение отменено.
      if (mine !== epoch.current) return outcome;
      const reconnect = gate.restartCore && wasOn;
      justRestarted.current = gate.restartCore && (then !== 'none' || reconnect);
      onAccessChanged();
      setGrant(null);
      resume(then, reconnect);
      return outcome;
    },
    [onAccessChanged, resume, restart, actions],
  );

  const close = useCallback((): void => {
    cancel();
    setGrant(null);
  }, [cancel]);

  const element = (
    <>
      {adminOpen && (
        <TunDialog
          onClose={() => {
            cancel();
            setAdminOpen(false);
          }}
          onRelaunch={relaunch}
        />
      )}
      {grant !== null && (
        <TunGrantDialog
          gate={grant.gate}
          onClose={close}
          onGrant={() => doGrant(grant.then)}
          onRecheck={() => {
            close();
            resume(grant.then);
          }}
        />
      )}
    </>
  );
  return { guard, open, element: adminOpen || grant !== null ? element : null };
}
