// screen_subscriptions.state.test.tsx — регрессия T-68: ошибка последнего
// обновления подписки переживает перезагрузку экрана, а карточка показывает
// строку «Следующее» (прототип renderSubs). Раньше ошибки жили только в
// useState: после возврата на вкладку карточка выглядела как «Серверов 0 /
// Обновлено — / Автообновление вкл.», а неизвестная ошибка не рисовалась вовсе.
import { describe, expect, it } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { SubscriptionProgress_Phase as Phase } from '../gen/lavray_pb';
import { fakeCore, frame, PROV, subscriptionsHarness } from './subscriptions.testkit';

describe('экран «Подписки»: состояние ошибки и «Следующее» (T-68)', () => {
  const h = subscriptionsHarness();
  const refresh = (): Element | null => document.querySelector('button[aria-label="Обновить"]');
  const errLine = (): string | undefined => document.querySelector('.sub-errline')?.textContent ?? undefined;
  const failing = (text: string, code: Code): { frames: ReturnType<typeof frame>[]; endWith: Error } => ({
    frames: [frame(Phase.FAILED, { detail: text })],
    endWith: new ConnectError(text, code),
  });

  it('ошибка обновления остаётся после перезагрузки экрана и снимается успешным обновлением', async () => {
    await h.mount(fakeCore([PROV], [failing('подписка: HTTP 404 Not Found', Code.Internal)]).core);
    await h.click(refresh());
    expect(errLine()).toContain('Подписка не найдена по этой ссылке');
    expect(errLine()).toContain('(404)');

    // «Перезагрузка»: экран монтируется заново, состояние React потеряно.
    await h.mount(fakeCore([PROV], [{ frames: [frame(Phase.DONE)] }]).core);
    expect(errLine()).toContain('Подписка не найдена по этой ссылке');
    expect(document.querySelector('.badge-err')).not.toBeNull();
    expect(document.querySelector('.sub-meta')?.textContent).not.toContain('Следующее'); // как в прототипе

    await h.click(refresh());
    expect(errLine()).toBeUndefined();
    expect(JSON.parse(window.localStorage.getItem('lavray.subErrors') ?? '{}')).toEqual({});
  });

  it('неизвестная ошибка тоже видна на карточке и не раскрывает текст ответа', async () => {
    const text = 'Get "https://prov.example/sub/SECRET": dial tcp 127.0.0.1:1: refused';
    await h.mount(fakeCore([PROV], [failing(text, Code.Unknown)]).core);
    await h.click(refresh());
    expect(errLine()).toContain('Не удалось обновить подписку');
    expect(errLine()).not.toContain('SECRET');
    expect(window.localStorage.getItem('lavray.subErrors') ?? '').not.toContain('SECRET');
  });

  it('«Следующее» = последнее обновление + интервал подписки; без автообновления — прочерк', async () => {
    const hourAgo = BigInt(Date.now() - 3600e3);
    await h.mount(
      fakeCore([
        { ...PROV, lastUpdateMs: hourAgo, updateIntervalMin: 360 },
        { ...PROV, id: 8n, name: 'Off', lastUpdateMs: hourAgo, updateIntervalMin: 360, skipAutoUpdate: true },
      ]).core,
    );
    const next = (card: Element | undefined): string | undefined =>
      Array.from(card?.querySelectorAll('.sub-meta .row') ?? []).find(
        (r) => r.querySelector('.k')?.textContent === 'Следующее',
      )?.lastElementChild?.textContent ?? undefined;
    const cards = Array.from(document.querySelectorAll('.sub-card'));
    expect(next(cards[0])).toMatch(/5/); // через 5 ч.
    expect(next(cards[1])).toBe('—');
  });
});
