// SPDX-License-Identifier: GPL-3.0-only

// screen_connection.traffic.test.tsx — 0.2.1: «Подключено» не значит «трафик
// идёт». Ядро после подключения проверяет связь через сервер и кладёт причину
// в CoreStatus.health_error; экран показывает предупреждение, пока причина есть,
// и убирает его, когда она пропала. Ядро — мок fetch.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { setLanguage, t } from '../lib/i18n';
import { ConnectionScreen } from './screen_connection';

type Status = Record<string, unknown>;

/** Состояние ядра, которое сейчас отдаёт мок; тест меняет его между опросами. */
let status: Status = {};

function installCore(): void {
  globalThis.fetch = (input: RequestInfo | URL): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(href).pathname;
    const body = path.endsWith('.CoreService/GetStatus')
      ? status
      : path.endsWith('.ProfileService/ListProfiles')
        ? { profiles: [{ id: '1', name: 'Frankfurt 01', address: 'example.org', port: 443 }] }
        : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
}

const connected = (extra: Status = {}): Status => ({
  state: 'CORE_STATE_CONNECTED',
  activeProfileId: '1',
  coreVersion: '1.14.1-lav.1',
  inbound: { port: 2080 },
  ...extra,
});

const warning = (): Element | null => document.querySelector('#connNoTraffic');
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const pause = (ms = 20): Promise<void> =>
  act(async () => {
    await sleep(ms);
  });

describe('Предупреждение «Подключено, но трафик не идёт» (0.2.1)', () => {
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    setLanguage('en');
    installCore();
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = '';
  });

  async function open(initial: Status): Promise<void> {
    status = initial;
    const clients = createCoreClients('http://127.0.0.1:1');
    act(() => {
      root.render(
        <CoreContext.Provider value={clients}>
          <ConnectionScreen />
        </CoreContext.Provider>,
      );
    });
    for (let i = 0; i < 40 && document.querySelector('#stateCard') === null; i += 1) await pause();
    await pause(30);
  }

  it('при сбое проверки показывает причину на языке интерфейса', async () => {
    await open(connected({ healthError: 'timeout' }));
    const box = warning();
    expect(box).not.toBeNull();
    expect(box?.classList.contains('banner-warn')).toBe(true);
    expect(box?.textContent).toBe(
      'Connected, but nothing gets through the server: the server did not respond in time. Choose another server or check your subscription.',
    );
  });

  it('код причины переводится на каждый язык, незнакомый текст — как есть', async () => {
    await open(connected({ healthError: 'refused' }));
    expect(warning()?.textContent).toContain('the server refused the connection');
    act(() => {
      setLanguage('ru');
    });
    await pause();
    expect(warning()?.textContent).toBe(
      'Подключено, но через сервер ничего не проходит: сервер отклонил соединение. Выберите другой сервер или проверьте подписку.',
    );
    status = connected({ healthError: 'remote error: tls: bad certificate' });
    await pause(1100);
    expect(warning()?.textContent).toContain(': remote error: tls: bad certificate.');
  });

  it('без причины предупреждения нет', async () => {
    await open(connected());
    expect(warning()).toBeNull();
  });

  it('предупреждение появляется после опроса и снимается, когда причина пропала', async () => {
    await open(connected());
    expect(warning()).toBeNull();
    status = connected({ healthError: 'reset' });
    await pause(1100);
    expect(warning()).not.toBeNull();
    expect(warning()?.textContent).toContain('the server dropped the connection');
    status = connected();
    await pause(1100);
    expect(warning()).toBeNull();
  });

  it('вне состояния «Подключено» старая причина не показывается', async () => {
    await open({ state: 'CORE_STATE_IDLE', activeProfileId: '0', coreVersion: '1.14.1-lav.1', healthError: 'reset' });
    expect(warning()).toBeNull();
  });

  it('все пять словарей содержат тексты предупреждения', () => {
    const keys = [
      'conn.noTraffic',
      'conn.noTraffic.refused',
      'conn.noTraffic.reset',
      'conn.noTraffic.no_host',
      'conn.noTraffic.timeout',
      'set.healthCheck',
      'set.healthCheck.d',
    ] as const;
    for (const lang of ['ru', 'en', 'zh', 'es', 'de'] as const) {
      for (const key of keys) {
        const text = t(key, lang);
        expect(text, `${lang}:${key}`).not.toBe(key);
        expect(text.trim(), `${lang}:${key}`).not.toBe('');
      }
      expect(t('conn.noTraffic', lang), lang).toContain('{reason}');
    }
  });
});
