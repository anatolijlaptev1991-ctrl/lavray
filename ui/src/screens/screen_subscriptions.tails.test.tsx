// SPDX-License-Identifier: GPL-3.0-only

// screen_subscriptions.tails.test.tsx — «Обновить все» (UpdateAllSubscriptions) и
// «Откатить» (RollbackSubscription) на экране «Подписки» (хвосты B, 7.1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { setLanguage } from '../lib/i18n';
import { Failure, click, mount, stubCore, unmountAll } from '../test-utils/coreStub';
import type { CoreStub, Json } from '../test-utils/coreStub';
import { StreamReply } from '../test-utils/streamStub';
import { tallyPhase } from './subscriptions/updateAllTally';
import { SubscriptionProgress_Phase } from '../gen/lavray_pb';
import { SubscriptionsScreen } from './screen_subscriptions';

beforeEach(() => {
  setLanguage('en');
  window.localStorage.clear();
});

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
});

const SUBS: Json = {
  groups: [{ id: '7', name: 'Prov', kind: 'GROUP_KIND_SUBSCRIPTION', subscriptionUrl: 'https://prov.example/sub' }],
};
const frame = (phase: string, groupId = '7'): Json => ({ groupId, phase });

function core(extra: Record<string, Json | Failure | StreamReply>): CoreStub {
  return stubCore({
    'SubscriptionService/ListSubscriptions': SUBS,
    'ProfileService/ListProfiles': { total: '3' },
    ...extra,
  });
}

const byText = (c: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(c.querySelectorAll<HTMLElement>('button')).find((b) => (b.textContent ?? '').trim() === text);
const okText = (c: HTMLElement): string => c.querySelector('.toast-ok')?.textContent ?? '';

describe('Обновить все', () => {
  it('один вызов UpdateAllSubscriptions; итог — сколько обновлено, пропущено и упало', async () => {
    const stub = core({
      'SubscriptionService/UpdateAllSubscriptions': new StreamReply([
        frame('PHASE_STARTED'),
        frame('PHASE_DONE', '7'),
        frame('PHASE_DONE', '8'),
        frame('PHASE_SKIPPED', '9'),
        frame('PHASE_FAILED', '10'),
      ]),
    });
    const view = await mount(createElement(SubscriptionsScreen));
    await click(byText(view.container, 'Update all'));

    expect(stub.bodies('SubscriptionService/UpdateAllSubscriptions')).toHaveLength(1);
    expect(okText(view.container)).toBe('Subscriptions: updated 2, skipped 1, failed 1');
  });

  it('подписки, ждущие подтверждения удаления, не обновляются молча и названы в итоге (S)', async () => {
    core({
      'SubscriptionService/UpdateAllSubscriptions': new StreamReply([frame('PHASE_CONFIRM_REQUIRED'), frame('PHASE_DONE', '8')]),
    });
    const view = await mount(createElement(SubscriptionsScreen));
    await click(byText(view.container, 'Update all'));
    expect(okText(view.container)).toContain('waiting for confirmation to remove servers: 1');
  });

  it('нет подписок — кнопка недоступна (E)', async () => {
    stubCore({ 'SubscriptionService/ListSubscriptions': { groups: [] } });
    const view = await mount(createElement(SubscriptionsScreen));
    expect(byText(view.container, 'Update all')?.hasAttribute('disabled')).toBe(true);
  });

  it('ошибка ядра показана баннером, кнопка снова доступна (R)', async () => {
    core({ 'SubscriptionService/UpdateAllSubscriptions': new StreamReply([], { error: { code: 'unavailable', message: 'down' } }) });
    const view = await mount(createElement(SubscriptionsScreen));
    await click(byText(view.container, 'Update all'));
    expect(view.container.querySelector('.banner-err')).not.toBeNull();
    expect(byText(view.container, 'Update all')?.hasAttribute('disabled')).toBe(false);
  });
});

describe('tallyPhase', () => {
  it('считает только итоговые кадры подписки, промежуточные не трогают счёт', () => {
    let tally = { ok: 0, skip: 0, fail: 0, confirm: 0 };
    for (const phase of [
      SubscriptionProgress_Phase.STARTED,
      SubscriptionProgress_Phase.REQUESTING,
      SubscriptionProgress_Phase.PARSING,
      SubscriptionProgress_Phase.DONE,
      SubscriptionProgress_Phase.SKIPPED,
      SubscriptionProgress_Phase.FAILED,
      SubscriptionProgress_Phase.CONFIRM_REQUIRED,
    ]) {
      tally = tallyPhase(tally, phase);
    }
    expect(tally).toEqual({ ok: 1, skip: 1, fail: 1, confirm: 1 });
  });
});

describe('Откатить', () => {
  const open = async (view: Awaited<ReturnType<typeof mount>>): Promise<HTMLElement> => {
    await click(byText(view.container, 'Roll back'));
    return document.querySelector<HTMLElement>('[role="dialog"]')!;
  };

  it('сначала подтверждение; «Отмена» ничего не вызывает (S)', async () => {
    const stub = core({});
    const view = await mount(createElement(SubscriptionsScreen));
    const dlg = await open(view);
    expect(dlg.textContent).toContain('last successful update');
    await click(byText(dlg, 'Cancel'));
    expect(stub.bodies('SubscriptionService/RollbackSubscription')).toHaveLength(0);
  });

  it('подтверждение: RollbackSubscription по id группы, итог с числом серверов, список перечитан', async () => {
    const stub = core({ 'SubscriptionService/RollbackSubscription': { success: true, restoredCount: 5 } });
    const view = await mount(createElement(SubscriptionsScreen));
    const before = stub.bodies('SubscriptionService/ListSubscriptions').length;
    const dlg = await open(view);
    await click(byText(dlg, 'Roll back'));

    expect(stub.bodies('SubscriptionService/RollbackSubscription')).toEqual([{ groupId: '7' }]);
    expect(okText(view.container)).toBe('“Prov” rolled back: 5 servers');
    expect(stub.bodies('SubscriptionService/ListSubscriptions').length).toBeGreaterThan(before);
  });

  it('снимка нет (success=false) — «Rollback failed», данные не тронуты (R)', async () => {
    core({ 'SubscriptionService/RollbackSubscription': { success: false, error: 'no snapshot' } });
    const view = await mount(createElement(SubscriptionsScreen));
    const dlg = await open(view);
    await click(byText(dlg, 'Roll back'));
    expect(view.container.querySelector('.sub-foot [role="alert"]')?.textContent).toBe('Rollback failed');
    expect(okText(view.container)).toBe('');
  });

  it('ошибка ядра показана рядом с кнопкой (R)', async () => {
    core({ 'SubscriptionService/RollbackSubscription': new Failure('unavailable', 'down') });
    const view = await mount(createElement(SubscriptionsScreen));
    const dlg = await open(view);
    await click(byText(dlg, 'Roll back'));
    expect(view.container.querySelector('.sub-foot [role="alert"]')).not.toBeNull();
  });
});
