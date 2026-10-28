// screen_subscriptions.confirm.test.tsx — регрессия T-18: деструктивное
// обновление подписки (кадр CONFIRM_REQUIRED) подтверждается диалогом, а
// «Обновить» шлёт UpdateSubscription с confirmDestructive=true. Раньше UI звал
// window.confirm («Ошибка: 3 / 3») — в окне Tauri он не работает, а поток после
// кадра закрывался ошибкой, и ветка была недостижима.
import { describe, expect, it } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { SubscriptionProgress_Phase as Phase } from '../gen/lavray_pb';
import { fakeCore, frame, PROV, subscriptionsHarness } from './subscriptions.testkit';

describe('экран «Подписки»: подтверждение деструктивного обновления (T-18)', () => {
  const h = subscriptionsHarness();
  const refresh = (): Element | null => document.querySelector('button[aria-label="Обновить"]');
  const dialog = (): Element | null => document.querySelector('[role="dialog"]');

  it('показывает диалог с числами и повторяет вызов с confirmDestructive=true', async () => {
    const { core, update } = fakeCore(
      [PROV],
      [
        { frames: [frame(Phase.CONFIRM_REQUIRED, { wouldRemoveCount: 3 })] },
        { frames: [frame(Phase.CONFIRM_REQUIRED, { wouldRemoveCount: 3 }), frame(Phase.DONE)] },
      ],
    );
    await h.mount(core);
    await h.click(refresh());
    expect(dialog()?.textContent).toContain('Обновить подписку «Prov»?');
    expect(dialog()?.textContent).toContain('Обновление удалит 3 из 3 серверов. Продолжить?');
    expect(update.mock.calls[0]?.[0]).toMatchObject({ groupId: 7n, confirmDestructive: false });
    expect(document.querySelector('[role="alert"]')).toBeNull();

    await h.click(dialog()?.querySelector('.btn-danger-solid') ?? null);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]?.[0]).toMatchObject({ groupId: 7n, confirmDestructive: true });
    expect(dialog()).toBeNull();
    expect(document.querySelector('.toast-ok')?.textContent).toBe('Подписка «Prov» обновлена');
  });

  it('«Отмена» закрывает диалог без повтора; старое ядро (ошибка после кадра) даёт тот же диалог', async () => {
    const { core, update } = fakeCore(
      [PROV],
      [
        {
          frames: [frame(Phase.CONFIRM_REQUIRED, { wouldRemoveCount: 2 })],
          endWith: new ConnectError('обновление требует подтверждения', Code.FailedPrecondition),
        },
      ],
    );
    await h.mount(core);
    await h.click(refresh());
    expect(dialog()?.textContent).toContain('Обновление удалит 2 из 3 серверов. Продолжить?');
    expect(document.querySelector('[role="alert"]')).toBeNull();

    const cancel = Array.from(dialog()?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Отмена');
    await h.click(cancel ?? null);
    expect(dialog()).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
