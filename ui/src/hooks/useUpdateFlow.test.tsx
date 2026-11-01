// SPDX-License-Identifier: GPL-3.0-only

// useUpdateFlow.test.tsx — поток «проверить → скачать → установить» поверх
// настоящих клиентов ядра (подменён только fetch) и подставной оболочки (T-75).
// Классы случаев: H основной путь, E пусто, I отказы, C двойной клик, X отмена и
// зависание, R частичный сбой и повтор, D повторы.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { JSX } from 'react';
import { setLanguage } from '../lib/i18n';
import { Down, Failure, flush, mount, stubCore, unmountAll, type Json } from '../test-utils/coreStub';
import { StreamReply } from '../test-utils/streamStub';
import type { UpdateFlowApi } from './useUpdateFlow';
import { useUpdateFlow } from './useUpdateFlow';

vi.mock('@tauri-apps/api/core', async () => (await import('../test-utils/tauriStub')).tauriCoreModule);
const { tauri, enableTauri, disableTauri } = await import('../test-utils/tauriStub');

const SHA = 'd'.repeat(64);
const APP = 'UPDATE_COMPONENT_APP';
const CHECK = 'UpdateService/CheckUpdates';
const DOWNLOAD = 'UpdateService/DownloadUpdates';
const APPLY = 'UpdateService/ApplyUpdates';

const found: Json = {
  available: [{ component: APP, currentVersion: '1.1.0', availableVersion: '1.2.0', notes: { ru: 'x' } }],
  currentAppVersion: '1.1.0',
  coreVersion: '0.5.0',
  lastCheckedAtMs: '1700000000000',
};
const verified: Json = { verified: { component: APP, version: '1.2.0', stagedPath: 'C:\\s\\a.exe', sha256: SHA } };
/** Ошибка server-stream RPC приходит в кадре end-stream (так отвечает connect-go), а не HTTP-статусом. */
const streamError = (code: string, message: string): StreamReply => new StreamReply([], { error: { code, message } });
const progress = (done: string): Json => ({ progress: { component: APP, downloadedBytes: done, totalBytes: '100', bps: 5 } });
const ready: Json = { readyForRestart: 'restart' };

interface Probe {
  api: UpdateFlowApi;
}
const probe: Probe = { api: undefined as unknown as UpdateFlowApi };

function Harness(props: { readonly channel: 'stable' | 'beta'; readonly idleMs: number }): JSX.Element {
  probe.api = useUpdateFlow(props.channel, { downloadIdleMs: props.idleMs, applyIdleMs: props.idleMs });
  return createElement('output', null, probe.api.state.kind);
}

async function start(channel: 'stable' | 'beta' = 'stable', idleMs = 5000): Promise<void> {
  await mount(createElement(Harness, { channel, idleMs }));
}

/** Вызов действия внутри act + пауза на асинхронный ответ. */
async function act2(fn: () => void, ms = 40): Promise<void> {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
  await flush(ms);
}

const kind = (): string => probe.api.state.kind;
const state = (): Record<string, unknown> => probe.api.state;

beforeEach(() => {
  setLanguage('en');
  tauri.reset();
  enableTauri();
});
afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  disableTauri();
});

describe('проверка', () => {
  it('H: найдено обновление → available, время проверки запомнено, канал уходит в запросе', async () => {
    const stub = stubCore({ [CHECK]: found });
    await start('beta');
    await act2(() => {
      probe.api.check();
    });
    expect(kind()).toBe('available');
    expect(probe.api.lastCheckedAtMs).toBe(1700000000000);
    expect(stub.bodies(CHECK)).toEqual([{ channel: 'UPDATE_CHANNEL_BETA' }]);
  });

  it('E: пустой ответ → upToDate с версиями', async () => {
    stubCore({ [CHECK]: { currentAppVersion: '1.1.0', coreVersion: '0.5.0', lastCheckedAtMs: '5' } });
    await start();
    await act2(() => {
      probe.api.check();
    });
    expect(state()).toMatchObject({ kind: 'upToDate', versions: { app: '1.1.0', core: '0.5.0' } });
  });

  it('check_failed_is_not_no_updates: UNAVAILABLE → checkFailed, время проверки не меняется', async () => {
    stubCore({ [CHECK]: new Failure('unavailable', 'all sources unreachable') });
    await start();
    await act2(() => {
      probe.api.check();
    });
    expect(kind()).toBe('checkFailed');
    expect(probe.api.lastCheckedAtMs).toBe(0);
  });

  it('ядро недоступно (обрыв сети) — тоже checkFailed', async () => {
    stubCore({ [CHECK]: new Down() });
    await start();
    await act2(() => {
      probe.api.check();
    });
    expect(kind()).toBe('checkFailed');
  });

  it('not_configured → честное состояние, повторная проверка не шлёт запросов (без цикла)', async () => {
    const stub = stubCore({ [CHECK]: new Failure('failed_precondition', 'not_configured: no trust root') });
    await start();
    await act2(() => {
      probe.api.check();
    });
    expect(kind()).toBe('notConfigured');
    await act2(() => {
      probe.api.check();
    });
    expect(stub.bodies(CHECK)).toHaveLength(1);
  });

  it('I: отказ по причине → error с ключом причины и retry=check', async () => {
    stubCore({ [CHECK]: new Failure('failed_precondition', 'serial_rollback: serial 3 < 5') });
    await start();
    await act2(() => {
      probe.api.check();
    });
    expect(state()).toMatchObject({
      kind: 'error',
      retry: 'check',
      error: { key: 'upd.reason.serial_rollback', detail: 'serial 3 < 5' },
    });
  });

  it('C: двойной клик «Проверить» — один запрос', async () => {
    const stub = stubCore({ [CHECK]: found });
    await start();
    await act2(() => {
      probe.api.check();
      probe.api.check();
    });
    expect(stub.bodies(CHECK)).toHaveLength(1);
  });
});

describe('загрузка', () => {
  async function toAvailable(routes: Record<string, unknown>): Promise<ReturnType<typeof stubCore>> {
    const stub = stubCore({ [CHECK]: found, ...(routes as Record<string, Json>) });
    await start();
    await act2(() => {
      probe.api.check();
    });
    return stub;
  }

  it('H: progress → verified → ready с путём и суммой из события', async () => {
    const stub = await toAvailable({ [DOWNLOAD]: new StreamReply([progress('40'), progress('100'), verified]) });
    await act2(() => {
      probe.api.download();
    });
    expect(state()).toMatchObject({
      kind: 'ready',
      staged: { stagedPath: 'C:\\s\\a.exe', sha256: SHA, version: '1.2.0' },
      notice: null,
    });
    expect(stub.bodies(DOWNLOAD)).toEqual([{ components: [APP] }]);
  });

  it('C: двойной клик «Скачать» запускает одну загрузку', async () => {
    const stub = await toAvailable({ [DOWNLOAD]: new StreamReply([verified]) });
    await act2(() => {
      probe.api.download();
      probe.api.download();
    });
    expect(stub.bodies(DOWNLOAD)).toHaveLength(1);
  });

  it('C: ABORTED от ядра (загрузка уже идёт) — ошибка «уже выполняется», вторая не стартует', async () => {
    const stub = await toAvailable({ [DOWNLOAD]: streamError('aborted', 'download already running') });
    await act2(() => {
      probe.api.download();
    });
    expect(state()).toMatchObject({ kind: 'error', retry: 'download', error: { key: 'upd.dlRunning' } });
    expect(stub.bodies(DOWNLOAD)).toHaveLength(1);
  });

  it('R: verify_failed → error с причиной и повтором; повтор скачивает заново и доходит до ready', async () => {
    const replies = [
      new StreamReply([progress('50'), { verifyFailed: { component: APP, reason: 'sha256_mismatch' } }]),
      new StreamReply([verified]),
    ];
    const stub = await toAvailable({ [DOWNLOAD]: (n: number) => replies[n] });
    await act2(() => {
      probe.api.download();
    });
    expect(state()).toMatchObject({ kind: 'error', retry: 'download', error: { key: 'upd.reason.sha256_mismatch' } });
    await act2(() => {
      probe.api.download();
    });
    expect(kind()).toBe('ready');
    expect(stub.bodies(DOWNLOAD)).toHaveLength(2);
  });

  it('I: поток закрылся без итога — сбой загрузки, а не «готово»', async () => {
    await toAvailable({ [DOWNLOAD]: new StreamReply([progress('10')]) });
    await act2(() => {
      probe.api.download();
    });
    expect(state()).toMatchObject({ kind: 'error', error: { key: 'upd.dlFailed' } });
  });

  it('I: verified без staged_path — не «готово»', async () => {
    await toAvailable({ [DOWNLOAD]: new StreamReply([{ verified: { component: APP, version: '1.2.0' } }]) });
    await act2(() => {
      probe.api.download();
    });
    expect(kind()).toBe('error');
  });

  it('X: «Отменить» обрывает поток и возвращает к доступному обновлению', async () => {
    await toAvailable({ [DOWNLOAD]: new StreamReply([progress('10')], { hold: true }) });
    await act2(() => {
      probe.api.download();
    });
    expect(kind()).toBe('downloading');
    await act2(() => {
      probe.api.cancelDownload();
    });
    expect(kind()).toBe('available');
  });

  it('X: источник замолчал — поток оборван, ошибка «остановлено» с повтором', async () => {
    stubCore({ [CHECK]: found, [DOWNLOAD]: new StreamReply([progress('10')], { hold: true }) });
    await start('stable', 60);
    await act2(() => {
      probe.api.check();
    });
    await act2(() => {
      probe.api.download();
    }, 200);
    expect(state()).toMatchObject({ kind: 'error', retry: 'download', error: { key: 'upd.stalled' } });
  });

  it('X: уход с экрана обрывает загрузку (нет вечного «downloading» в фоне)', async () => {
    const stub = await toAvailable({ [DOWNLOAD]: new StreamReply([progress('10')], { hold: true }) });
    await act2(() => {
      probe.api.download();
    });
    unmountAll();
    await flush(30);
    expect(stub.bodies(DOWNLOAD)).toHaveLength(1);
  });
});

describe('установка', () => {
  async function toReady(routes: Record<string, unknown> = {}): Promise<ReturnType<typeof stubCore>> {
    const stub = stubCore({
      [CHECK]: found,
      [DOWNLOAD]: new StreamReply([verified]),
      [APPLY]: new StreamReply([ready]),
      ...(routes as Record<string, Json>),
    });
    await start();
    await act2(() => {
      probe.api.check();
    });
    await act2(() => {
      probe.api.download();
    });
    return stub;
  }

  it('H: ApplyUpdates → update_apply с данными из verified → installing', async () => {
    tauri.onValue('update_apply', { status: 'installing' });
    const stub = await toReady();
    await act2(() => {
      probe.api.install();
    });
    expect(kind()).toBe('installing');
    expect(tauri.argsOf('update_apply')).toEqual([{ stagedPath: 'C:\\s\\a.exe', sha256: SHA, version: '1.2.0' }]);
    expect(stub.bodies(APPLY)).toEqual([{ components: [APP] }]);
  });

  it('C: двойной клик «Установить» — один ApplyUpdates и один update_apply', async () => {
    tauri.onValue('update_apply', { status: 'installing' });
    const stub = await toReady();
    await act2(() => {
      probe.api.install();
      probe.api.install();
    });
    expect(stub.bodies(APPLY)).toHaveLength(1);
    expect(tauri.argsOf('update_apply')).toHaveLength(1);
  });

  it('uac_cancel_message: отказ в UAC → ready с пометкой, можно повторить', async () => {
    tauri.onValue('update_apply', { status: 'uac_cancelled' });
    await toReady();
    await act2(() => {
      probe.api.install();
    });
    expect(state()).toMatchObject({ kind: 'ready', notice: 'uacCancelled' });
    tauri.onValue('update_apply', { status: 'installing' });
    await act2(() => {
      probe.api.install();
    });
    expect(kind()).toBe('installing');
    expect(tauri.argsOf('update_apply')).toHaveLength(2);
  });

  it('активная сессия: вопрос → подтверждение → повтор с activeSessionConfirmed', async () => {
    tauri.onValue('update_apply', { status: 'installing' });
    const stub = await toReady({
      [APPLY]: (n: number) =>
        n === 0 ? streamError('failed_precondition', 'active_session: VPN is connected') : new StreamReply([ready]),
    });
    await act2(() => {
      probe.api.install();
    });
    expect(state()).toMatchObject({ kind: 'ready', askSession: true });
    expect(tauri.argsOf('update_apply')).toHaveLength(0);
    await act2(() => {
      probe.api.confirmSession();
    });
    expect(kind()).toBe('installing');
    expect(stub.bodies(APPLY)).toEqual([{ components: [APP] }, { components: [APP], activeSessionConfirmed: true }]);
  });

  it('активная сессия: отказ от разрыва оставляет «готово» без установки', async () => {
    await toReady({ [APPLY]: streamError('failed_precondition', 'active_session: VPN is connected') });
    await act2(() => {
      probe.api.install();
    });
    await act2(() => {
      probe.api.declineSession();
    });
    expect(state()).toMatchObject({ kind: 'ready', askSession: false });
    expect(tauri.argsOf('update_apply')).toHaveLength(0);
  });

  it('S: повторная проверка ядром провалена → установщик не запускается, повтор через загрузку', async () => {
    await toReady({
      [APPLY]: new StreamReply([{ verifyFailed: { component: APP, reason: 'sha256_mismatch' } }]),
    });
    await act2(() => {
      probe.api.install();
    });
    expect(state()).toMatchObject({ kind: 'error', retry: 'download', error: { key: 'upd.reason.sha256_mismatch' } });
    expect(tauri.argsOf('update_apply')).toHaveLength(0);
  });

  it('I: стрим установки закрылся без readyForRestart — установщик не запускается', async () => {
    await toReady({ [APPLY]: new StreamReply([]) });
    await act2(() => {
      probe.api.install();
    });
    expect(kind()).toBe('error');
    expect(tauri.argsOf('update_apply')).toHaveLength(0);
  });

  it('R: код ошибки оболочки → локализуемый ключ, повтор установки доступен', async () => {
    tauri.onError('update_apply', 'locked');
    await toReady();
    await act2(() => {
      probe.api.install();
    });
    expect(state()).toMatchObject({ kind: 'error', retry: 'install', error: { key: 'upd.err.locked' } });
  });

  it('R: sha256_mismatch оболочки → нужна новая загрузка', async () => {
    tauri.onError('update_apply', 'sha256_mismatch');
    await toReady();
    await act2(() => {
      probe.api.install();
    });
    expect(state()).toMatchObject({ kind: 'error', retry: 'download', error: { key: 'upd.err.sha256_mismatch' } });
  });

  it('R: неизвестный код оболочки → общее сообщение', async () => {
    tauri.onError('update_apply', 'worker_failed');
    await toReady();
    await act2(() => {
      probe.api.install();
    });
    expect(state()).toMatchObject({ kind: 'error', error: { key: 'upd.err.generic' } });
  });

  it('install до загрузки (состояние не ready) ничего не делает', async () => {
    const stub = stubCore({ [CHECK]: found });
    await start();
    await act2(() => {
      probe.api.install();
    });
    expect(kind()).toBe('idle');
    expect(stub.bodies(APPLY)).toEqual([]);
  });
});

describe('прочее', () => {
  it('смена канала сбрасывает устаревший результат проверки', async () => {
    stubCore({ [CHECK]: found });
    await start();
    await act2(() => {
      probe.api.check();
    });
    expect(kind()).toBe('available');
    await act2(() => {
      probe.api.channelChanged();
    });
    expect(kind()).toBe('idle');
  });

  it('GetUpdateState сообщил not_configured → markNotConfigured переводит из idle', async () => {
    stubCore({});
    await start();
    await act2(() => {
      probe.api.markNotConfigured();
    });
    expect(kind()).toBe('notConfigured');
  });
});
