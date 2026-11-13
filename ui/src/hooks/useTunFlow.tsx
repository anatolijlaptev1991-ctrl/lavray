// SPDX-License-Identifier: GPL-3.0-only

// useTunFlow.tsx — поток «режиму TUN нужны права» на экране «Подключение».
// Windows (`tunAccess: 'admin'`): диалог «Перезапустить от администратора»,
// поведение прежнее. Linux (`'grant'`): состояние даёт `tun_access_state`;
// `ready` — подключаем (если ядру нужен перезапуск — сначала `restart_core` и
// ожидание его адреса), `grantable`/`manual`/`unavailable` — диалог выдачи
// разрешения, после которого отложенное действие (подключение или включение
// TUN) продолжается само.
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
  readonly enable: () => void;
}

export interface TunFlow {
  /** `true` — права есть, можно продолжать; `false` — показан диалог либо идёт перезапуск ядра (действие продолжится само). */
  readonly guard: (then: TunThen) => Promise<boolean>;
  /** Диалог по уже известному решению (просьба из трея, кнопка баннера). */
  readonly open: (gate: TunGate, then: TunThen) => void;
  readonly element: JSX.Element | null;
}

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

interface Args {
  readonly relaunch: () => Promise<RelaunchOutcome>;
  /** Свежие обработчики экрана: после перезапуска ядра клиенты другие. */
  readonly actions: MutableRefObject<TunActions>;
  /** Состояние доступа изменилось (права выданы) — обновить баннер. */
  readonly onAccessChanged: () => void;
}

/** Выдать разрешение и, если ядру нужен перезапуск, перезапустить его. `restarted` — перезапуск был. */
async function grantAndRestart(): Promise<{ outcome: GrantOutcome; restarted: boolean }> {
  const outcome = await grantTunAccess();
  if (outcome === 'cancelled') return { outcome, restarted: false };
  const gate = gateFromAccess(await readTunAccess());
  if (gate.kind !== 'ready') throw new Error('not_grantable');
  if (gate.restartCore) await restartCoreAndWait();
  return { outcome, restarted: gate.restartCore };
}

export function useTunFlow({ relaunch, actions, onAccessChanged }: Args): TunFlow {
  const admin = useShellCaps().tunAccess === 'admin';
  const [adminOpen, setAdminOpen] = useState(false);
  const [grant, setGrant] = useState<{ gate: GrantDialogGate; then: TunThen } | null>(null);
  // Ядро уже перезапускали ради этого действия: второй раз не просим (защита от цикла).
  const restarted = useRef(false);

  const resume = useCallback(
    (then: TunThen): void => {
      void tick().then(() => {
        if (then === 'connect') actions.current.connect();
        else if (then === 'enable') actions.current.enable();
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
      const gate = await tunGate();
      if (gate.kind !== 'ready') {
        open(gate, then);
        return false;
      }
      if (!gate.restartCore || restarted.current) {
        restarted.current = false;
        return true;
      }
      restarted.current = true;
      try {
        await restartCoreAndWait();
      } catch {
        restarted.current = false;
        setGrant({ gate: { kind: 'unavailable', reason: 'restart' }, then });
        return false;
      }
      resume(then);
      return false;
    },
    [open, resume],
  );

  const doGrant = useCallback(
    async (then: TunThen): Promise<GrantOutcome> => {
      const { outcome, restarted: didRestart } = await grantAndRestart();
      if (outcome === 'cancelled') return outcome;
      restarted.current = didRestart;
      onAccessChanged();
      setGrant(null);
      resume(then);
      return outcome;
    },
    [onAccessChanged, resume],
  );

  const element = (
    <>
      {adminOpen && (
        <TunDialog
          onClose={() => {
            setAdminOpen(false);
          }}
          onRelaunch={relaunch}
        />
      )}
      {grant !== null && (
        <TunGrantDialog
          gate={grant.gate}
          onClose={() => {
            setGrant(null);
          }}
          onGrant={() => doGrant(grant.then)}
          onRecheck={() => {
            setGrant(null);
            resume(grant.then);
          }}
        />
      )}
    </>
  );
  return { guard, open, element: adminOpen || grant !== null ? element : null };
}
