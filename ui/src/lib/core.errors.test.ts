// SPDX-License-Identifier: GPL-3.0-only

// core.errors.test.ts — T-59: friendlyCoreError отдаёт готовую фразу на языке
// интерфейса и никогда не отдаёт ключ словаря; Unimplemented и
// FailedPrecondition не маскируются под «Ядро недоступно».
import { afterEach, describe, expect, it } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { LANGUAGES, setLanguage, t } from './i18n';
import { friendlyCoreError, showCoreError } from './core';

afterEach(() => {
  setLanguage('en');
});

/** Ошибка так, как её отдаёт connect-web при недоступной сети. */
const networkDown = (): ConnectError => ConnectError.from(new TypeError('Failed to fetch'));
/** Ответ чужого сервера вместо ядра (asset-сервер оболочки: HTML и 404). */
const wrongServer = (): ConnectError => new ConnectError('HTTP 404', Code.Unimplemented);

describe('friendlyCoreError', () => {
  it('сеть недоступна -> «Ядро недоступно», а не ключ core.unavailable', () => {
    setLanguage('ru');
    const text = friendlyCoreError(networkDown());
    expect(text).toBe(t('core.unavailable', 'ru'));
    expect(text).not.toBe('core.unavailable');
    expect(text).toContain('Ядро недоступно');
  });

  it('вместо ядра ответил чужой сервер (HTTP 404/405/5xx) -> «Ядро недоступно»', () => {
    setLanguage('ru');
    expect(friendlyCoreError(wrongServer())).toContain('Ядро недоступно');
    expect(friendlyCoreError(new ConnectError('HTTP 502', Code.Unknown))).toContain('Ядро недоступно');
    expect(friendlyCoreError(new Error('NetworkError when attempting to fetch resource'))).toContain(
      'Ядро недоступно',
    );
  });

  it('Unimplemented от живого ядра -> «Функция пока не реализована»', () => {
    setLanguage('ru');
    const text = friendlyCoreError(new ConnectError('RPC запланирован (W6)', Code.Unimplemented));
    expect(text).toBe('Функция пока не реализована');
    expect(text).not.toContain('Ядро недоступно');
  });

  it('FailedPrecondition -> отдельный текст и причина от ядра, не «Ядро недоступно»', () => {
    setLanguage('ru');
    const text = friendlyCoreError(
      new ConnectError('источник статистики не сконфигурирован', Code.FailedPrecondition),
    );
    expect(text).toBe('Сейчас это действие недоступно: источник статистики не сконфигурирован');
    expect(text).not.toContain('Ядро недоступно');
    // Без причины — только заголовок.
    expect(friendlyCoreError(new ConnectError('', Code.FailedPrecondition))).toBe(
      t('err.precondition'),
    );
  });

  it('прочие ошибки остаются как есть', () => {
    const e = new ConnectError('port must be 1..65535', Code.InvalidArgument);
    expect(friendlyCoreError(e)).toBe(e.message);
    expect(friendlyCoreError(new Error('mode.sys.nativeOnly'))).toBe('mode.sys.nativeOnly');
    expect(friendlyCoreError('строка')).toBe('строка');
  });

  it('переводчик по умолчанию следует текущему языку интерфейса', () => {
    for (const lang of LANGUAGES) {
      setLanguage(lang);
      expect(friendlyCoreError(networkDown())).toBe(t('core.unavailable', lang));
      expect(friendlyCoreError(new ConnectError('x', Code.Unimplemented))).toBe(t('err.unimplemented', lang));
    }
    setLanguage('de');
    expect(friendlyCoreError(new ConnectError('x', Code.Unimplemented))).toBe(
      'Diese Funktion ist noch nicht verfügbar',
    );
  });

  it('ни на одном языке результат не равен ключу словаря', () => {
    const errors = [
      networkDown(),
      wrongServer(),
      new ConnectError('x', Code.Unimplemented),
      new ConnectError('x', Code.FailedPrecondition),
    ];
    for (const lang of LANGUAGES) {
      setLanguage(lang);
      for (const e of errors) {
        const text = friendlyCoreError(e);
        expect(text, `${lang}: ${e.message}`).not.toMatch(/^(core|err)\.[a-z]+$/);
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  it('showCoreError(e, t) — то же самое с переводчиком экрана', () => {
    const seen: string[] = [];
    const out = showCoreError(networkDown(), (key) => {
      seen.push(key);
      return `<${key}>`;
    });
    expect(seen).toEqual(['core.unavailable']);
    expect(out).toBe('<core.unavailable>');
  });
});

describe('отказ в правах при запуске TUN (T-81)', () => {
  /** Так sing-box сообщает про адаптер TUN без администратора (Windows). */
  const denied = (): ConnectError =>
    new ConnectError(
      'inst: старт инстанса: start inbound/tun[tun-in]: configure tun interface: Access is denied.',
      Code.Unknown,
    );

  it('access_denied_error_is_localized: на каждом языке — готовая фраза, не сырой текст ОС', () => {
    for (const lang of LANGUAGES) {
      setLanguage(lang);
      const text = friendlyCoreError(denied());
      expect(text, lang).toBe(t('err.tunAccess', lang));
      expect(text, lang).not.toContain('Access is denied');
      expect(text, lang).not.toBe('err.tunAccess');
    }
    setLanguage('ru');
    expect(friendlyCoreError(denied())).toBe(
      'Для запуска TUN не хватает прав. Перезапустите LAVRay от имени администратора.',
    );
  });

  it('узнаёт отказ ОС и по другим формулировкам (Linux, русская Windows)', () => {
    setLanguage('en');
    for (const raw of [
      'start inbound/tun[tun-in]: configure tun interface: operation not permitted',
      'tun: open /dev/net/tun: permission denied',
      'tun: A required privilege is not held by the client.',
      'tun: Отказано в доступе.',
    ]) {
      expect(friendlyCoreError(new ConnectError(raw, Code.Unknown)), raw).toBe(t('err.tunAccess', 'en'));
    }
  });

  it('без контекста TUN «Access is denied» без слова tun не трогаем; с контекстом — объясняем', () => {
    setLanguage('en');
    const plain = new ConnectError('open C:/data/cache.db: Access is denied.', Code.Unknown);
    expect(friendlyCoreError(plain)).toBe(plain.message);
    expect(friendlyCoreError(plain, undefined, { tun: true })).toBe(t('err.tunAccess', 'en'));
  });

  it('FailedPrecondition от ядра сохраняет причину, даже если в ней есть «access is denied»', () => {
    setLanguage('en');
    const text = friendlyCoreError(
      new ConnectError('tun requires administrator rights, access is denied', Code.FailedPrecondition),
      undefined,
      { tun: true },
    );
    expect(text).toContain('tun requires administrator rights');
  });

  it('переводчик экрана получает ключ err.tunAccess', () => {
    const seen: string[] = [];
    const out = showCoreError(
      denied(),
      (key) => {
        seen.push(key);
        return `<${key}>`;
      },
      { tun: true },
    );
    expect(seen).toEqual(['err.tunAccess']);
    expect(out).toBe('<err.tunAccess>');
  });
});
