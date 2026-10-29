// SPDX-License-Identifier: GPL-3.0-only

// delete-confirm.test.tsx — T-12 (F-004, B1-19, C1-05): удаление группы и
// подписки спрашивает подтверждение с числом серверов; RPC не вызывается до
// «Удалить»; кнопка подписки называется «Удалить подписку»; ошибка ядра
// (активный профиль в группе) видна пользователю.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { Group_Kind, GroupSchema } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { setLanguage, t, tf } from '../lib/i18n';
import { SubscriptionsScreen } from '../screens/screen_subscriptions';
import { DialogShell, GroupsDialog } from './dialogs';

function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

function click(el: Element | null | undefined): void {
  if (!(el instanceof HTMLElement)) throw new Error('элемент для клика не найден');
  act(() => {
    el.click();
  });
}

function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
}

/** Кнопка внутри самого верхнего (последнего) диалога по тексту. */
function dialogButton(text: string): HTMLButtonElement | undefined {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  const top = dialogs[dialogs.length - 1];
  return Array.from(top?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
    (b) => (b.textContent ?? '').trim() === text,
  );
}

describe('T-12: подтверждение удаления группы и подписки', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setActEnvironment(true);
    setLanguage('en');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    setActEnvironment(false);
  });

  function render(el: ReactElement): void {
    act(() => {
      root.render(el);
    });
  }

  describe('диалог «Группы»', () => {
    const work = create(GroupSchema, { id: 7n, name: 'Work', kind: Group_Kind.BASIC, profileOrder: [1n, 2n, 3n] });
    const home = create(GroupSchema, { id: 8n, name: 'Home', kind: Group_Kind.BASIC, profileOrder: [] });

    function mount(deleteGroup: ReturnType<typeof vi.fn>, onClose = vi.fn()): void {
      const clients = {
        profiles: {
          listGroups: vi.fn().mockResolvedValue({ groups: [work, home] }),
          deleteGroup,
        },
      } as unknown as CoreClients;
      render(
        <CoreContext.Provider value={clients}>
          <GroupsDialog onClose={onClose} onChanged={() => undefined} />
        </CoreContext.Provider>,
      );
    }

    it('корзина открывает подтверждение с названием и числом серверов; deleteGroup ещё не вызван', async () => {
      const deleteGroup = vi.fn().mockResolvedValue({});
      mount(deleteGroup);
      await flush();

      click(document.querySelector('button[aria-label="Delete Work"]'));
      expect(deleteGroup).not.toHaveBeenCalled();
      const dialogs = document.querySelectorAll('[role="dialog"]');
      expect(dialogs, 'поверх «Групп» открыто подтверждение').toHaveLength(2);
      expect(dialogs[1]?.textContent).toContain(tf('grp.delConfirm', { name: 'Work', n: 3 }, 'en'));
      expect(dialogs[1]?.textContent).toContain('3');
    });

    it('«Отмена» закрывает подтверждение и RPC не вызывает', async () => {
      const deleteGroup = vi.fn().mockResolvedValue({});
      mount(deleteGroup);
      await flush();
      click(document.querySelector('button[aria-label="Delete Work"]'));
      click(dialogButton(t('common.cancel', 'en')));
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(deleteGroup).not.toHaveBeenCalled();
    });

    it('«Удалить» в подтверждении вызывает deleteGroup ровно один раз с id группы', async () => {
      const deleteGroup = vi.fn().mockResolvedValue({});
      mount(deleteGroup);
      await flush();
      click(document.querySelector('button[aria-label="Delete Work"]'));
      click(dialogButton(t('grp.delete', 'en')));
      await flush();
      expect(deleteGroup).toHaveBeenCalledTimes(1);
      expect(deleteGroup).toHaveBeenCalledWith({ id: 7n });
      expect(document.querySelectorAll('[role="dialog"]'), 'подтверждение закрыто').toHaveLength(1);
    });

    it('Esc в подтверждении закрывает только подтверждение, «Группы» остаются', async () => {
      const deleteGroup = vi.fn().mockResolvedValue({});
      const onClose = vi.fn();
      mount(deleteGroup, onClose);
      await flush();
      click(document.querySelector('button[aria-label="Delete Work"]'));
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);

      pressEscape();
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(onClose, 'нижний диалог не закрыт').not.toHaveBeenCalled();
      expect(deleteGroup).not.toHaveBeenCalled();

      pressEscape();
      expect(onClose, 'второй Esc закрывает «Группы»').toHaveBeenCalledTimes(1);
    });

    it('отказ ядра (активный профиль) показывается в диалоге «Группы»', async () => {
      const refusal = new ConnectError(
        'группа содержит активный профиль «Tokyo» — сначала отключитесь',
        Code.FailedPrecondition,
      );
      const deleteGroup = vi.fn().mockRejectedValue(refusal);
      mount(deleteGroup);
      await flush();
      click(document.querySelector('button[aria-label="Delete Work"]'));
      click(dialogButton(t('grp.delete', 'en')));
      await flush();
      const banner = document.querySelector('[role="alert"]');
      expect(banner?.textContent).toContain('сначала отключитесь');
    });
  });

  describe('вложенные диалоги', () => {
    it('Esc обрабатывает только верхний (открытый позже) диалог', () => {
      const lower = vi.fn();
      const upper = vi.fn();
      const tree = (withUpper: boolean): ReactElement => (
        <DialogShell titleId="lowT" title="lower" onClose={lower}>
          <p>нижний</p>
          {withUpper && (
            <DialogShell titleId="upT" title="upper" onClose={upper}>
              <p>верхний</p>
            </DialogShell>
          )}
        </DialogShell>
      );
      render(tree(false));
      render(tree(true)); // верхний открывается позже нижнего, как подтверждение поверх «Групп»
      pressEscape();
      expect(upper).toHaveBeenCalledTimes(1);
      expect(lower).not.toHaveBeenCalled();
      render(tree(false)); // верхний закрыт — Esc снова достаётся нижнему
      pressEscape();
      expect(lower).toHaveBeenCalledTimes(1);
    });
  });

  describe('экран «Подписки»', () => {
    const sub = create(GroupSchema, {
      id: 5n,
      name: 'prov.example',
      kind: Group_Kind.SUBSCRIPTION,
      subscriptionUrl: 'https://prov.example/sub',
      profileOrder: [1n, 2n, 3n, 4n],
    });

    function mount(deleteSubscription: ReturnType<typeof vi.fn>): void {
      const clients = {
        subscriptions: {
          listSubscriptions: vi.fn().mockResolvedValue({ groups: [sub] }),
          deleteSubscription,
        },
        profiles: { listProfiles: vi.fn().mockResolvedValue({ profiles: [], total: 4n }) },
      } as unknown as CoreClients;
      render(
        <CoreContext.Provider value={clients}>
          <SubscriptionsScreen />
        </CoreContext.Provider>,
      );
    }

    it('кнопка называется «Delete subscription», а не «Delete selected»', async () => {
      mount(vi.fn());
      await flush();
      const labels = Array.from(document.querySelectorAll('.sub-foot button')).map((b) => b.getAttribute('aria-label'));
      expect(labels).toContain(t('subs.delete', 'en'));
      expect(labels).not.toContain(t('srv.delSel', 'en'));
    });

    it('корзина открывает подтверждение с числом серверов; deleteSubscription ещё не вызван', async () => {
      const deleteSubscription = vi.fn().mockResolvedValue({});
      mount(deleteSubscription);
      await flush();
      click(document.querySelector(`.sub-foot button[aria-label="${t('subs.delete', 'en')}"]`));
      expect(deleteSubscription).not.toHaveBeenCalled();
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.textContent).toContain(tf('subs.delConfirm', { name: 'prov.example', n: 4 }, 'en'));
    });

    it('«Отмена» — RPC не вызван; «Удалить подписку» — вызван один раз с groupId', async () => {
      const deleteSubscription = vi.fn().mockResolvedValue({});
      mount(deleteSubscription);
      await flush();
      const open = (): void => {
        click(document.querySelector(`.sub-foot button[aria-label="${t('subs.delete', 'en')}"]`));
      };
      open();
      click(dialogButton(t('common.cancel', 'en')));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(deleteSubscription).not.toHaveBeenCalled();

      open();
      click(dialogButton(t('subs.delete', 'en')));
      await flush();
      expect(deleteSubscription).toHaveBeenCalledTimes(1);
      expect(deleteSubscription).toHaveBeenCalledWith({ groupId: 5n });
    });

    it('отказ ядра (активный профиль) показывается баннером', async () => {
      const deleteSubscription = vi
        .fn()
        .mockRejectedValue(new ConnectError('группа содержит активный профиль «Tokyo»', Code.FailedPrecondition));
      mount(deleteSubscription);
      await flush();
      click(document.querySelector(`.sub-foot button[aria-label="${t('subs.delete', 'en')}"]`));
      click(dialogButton(t('subs.delete', 'en')));
      await flush();
      expect(document.querySelector('.banner-err')?.textContent).toContain('активный профиль');
    });
  });
});
