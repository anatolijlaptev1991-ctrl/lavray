// SPDX-License-Identifier: GPL-3.0-only

// DataComponents.test.tsx — наборы маршрутов и гео-данные на экране «Обновления»
// (T-75/7.5): предложения после проверки, «Обновить» = загрузка + применение,
// перезапуск профиля, отказы по целостности, откат с подтверждением, a11y.
// Ядро — настоящие клиенты поверх подменённого fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { setLanguage, t, tf } from '../../lib/i18n';
import { Failure, click, flush, mount, stubCore, unmountAll } from '../../test-utils/coreStub';
import type { CoreStub, Json, Route } from '../../test-utils/coreStub';
import { StreamReply } from '../../test-utils/streamStub';
import { UpdatesScreen } from './UpdatesScreen';

vi.mock('@tauri-apps/api/core', async () => (await import('../../test-utils/tauriStub')).tauriCoreModule);
const { tauri, enableTauri, disableTauri } = await import('../../test-utils/tauriStub');

const PRESETS = 'UPDATE_COMPONENT_PRESETS';
const GEO = 'UPDATE_COMPONENT_GEO';
const SHA = 'f'.repeat(64);
const STATE = 'UpdateService/GetUpdateState';
const CHECK = 'UpdateService/CheckUpdates';
const DOWNLOAD = 'UpdateService/DownloadUpdates';
const APPLY = 'UpdateService/ApplyUpdates';
const ROLLBACK = 'UpdateService/Rollback';

const checkWith = (...available: Json[]): Json => ({
  available,
  currentAppVersion: '1.1.0',
  coreVersion: '0.5.0',
  lastCheckedAtMs: String(Date.now()),
});
const presetsOffer: Json = { component: PRESETS, currentVersion: 'lav-ru:2', availableVersion: 'lav-ru:3' };
const geoOffer: Json = { component: GEO, currentVersion: '', availableVersion: '2026-10-20' };
const verified = (component: string): Json => ({ verified: { component, version: 'v', stagedPath: 'p', sha256: SHA } });

let stub: CoreStub;
function core(routes: Record<string, Route> = {}): void {
  stub = stubCore({
    [STATE]: {},
    'SettingsService/GetSettings': { values: {} },
    'SettingsService/SetSettings': {},
    ...routes,
  });
}

const buttons = (): HTMLButtonElement[] => Array.from(document.querySelectorAll('button'));
const btn = (label: string): HTMLButtonElement | null => buttons().find((b) => (b.textContent ?? '').trim() === label) ?? null;
const card = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="upd-data"]')!;
const row = (kind: string): HTMLElement => card().querySelector<HTMLElement>(`[data-kind="${kind}"]`)!;
const rowBtn = (kind: string, label: string): HTMLButtonElement =>
  Array.from(row(kind).querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label)!;

async function checked(): Promise<void> {
  await mount(createElement(UpdatesScreen));
  await click(btn(t('upd.checkNow')));
}

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

describe('предложения', () => {
  it('до первой проверки «Актуально» не показывается: честное «проверьте обновления»', async () => {
    core();
    await mount(createElement(UpdatesScreen));
    expect(row('presets').textContent).toContain(t('upd.comp.notChecked'));
    expect(card().textContent).not.toContain(t('upd.comp.upToDate'));
    expect(rowBtn('presets', t('upd.comp.apply'))).toBeUndefined();
  });

  it('после проверки: версии «было → стало», кнопка «Обновить»; гео из поставки подписано', async () => {
    core({ [CHECK]: checkWith(presetsOffer, geoOffer) });
    await checked();
    expect(row('presets').textContent).toContain(tf('upd.comp.versions', { from: 'lav-ru:2', to: 'lav-ru:3' }));
    expect(row('geo').textContent).toContain(tf('upd.comp.versions', { from: t('upd.comp.bundled'), to: '2026-10-20' }));
    expect(rowBtn('presets', t('upd.comp.apply'))).toBeDefined();
    expect(rowBtn('geo', t('upd.comp.apply'))).toBeDefined();
  });

  it('проверка прошла, новых данных нет — «Актуально» (а не «обновлений нет» до проверки)', async () => {
    core({ [CHECK]: checkWith() });
    await checked();
    expect(row('presets').textContent).toContain(t('upd.comp.upToDate'));
    expect(row('geo').textContent).toContain(t('upd.comp.upToDate'));
  });
});

describe('установка = загрузка и применение', () => {
  it('«Обновить» набор: DownloadUpdates и ApplyUpdates только для PRESETS, затем «применено» и «Актуально»', async () => {
    core({
      [CHECK]: checkWith(presetsOffer),
      [DOWNLOAD]: new StreamReply([verified(PRESETS)]),
      [APPLY]: new StreamReply([{ applied: 'presets' }]),
    });
    await checked();
    await click(rowBtn('presets', t('upd.comp.apply')));
    await flush(30);
    expect(stub.bodies(DOWNLOAD)).toEqual([{ components: [PRESETS] }]);
    expect(stub.bodies(APPLY)).toEqual([{ components: [PRESETS] }]);
    expect(row('presets').textContent).toContain(t('upd.comp.done.applied'));
    expect(row('presets').textContent).toContain(t('upd.comp.upToDate'));
    expect(row('presets').textContent).not.toContain(t('upd.comp.restart'));
  });

  it('ready_for_restart(profile): просит переподключить профиль', async () => {
    core({
      [CHECK]: checkWith(geoOffer),
      [DOWNLOAD]: new StreamReply([{ progress: { component: GEO, downloadedBytes: '5', totalBytes: '10' } }, verified(GEO)]),
      [APPLY]: new StreamReply([{ applied: 'geo' }, { readyForRestart: 'profile' }]),
    });
    await checked();
    await click(rowBtn('geo', t('upd.comp.apply')));
    await flush(30);
    expect(row('geo').textContent).toContain(t('upd.comp.restart'));
  });

  it('отказ проверки при загрузке: причина показана, применение не запускается', async () => {
    core({
      [CHECK]: checkWith(presetsOffer),
      [DOWNLOAD]: new StreamReply([{ verifyFailed: { component: PRESETS, reason: 'sha256_mismatch' } }]),
    });
    await checked();
    await click(rowBtn('presets', t('upd.comp.apply')));
    await flush(30);
    expect(stub.bodies(APPLY)).toHaveLength(0);
    expect(row('presets').querySelector('[role="alert"]')?.textContent).toBe(t('upd.reason.sha256_mismatch'));
    expect(rowBtn('presets', t('upd.comp.apply'))).toBeDefined();
  });

  it('отказ при применении (небезопасный архив): причина показана, «применено» нет', async () => {
    core({
      [CHECK]: checkWith(geoOffer),
      [DOWNLOAD]: new StreamReply([verified(GEO)]),
      [APPLY]: new StreamReply([{ verifyFailed: { component: GEO, reason: 'archive_unsafe' } }]),
    });
    await checked();
    await click(rowBtn('geo', t('upd.comp.apply')));
    await flush(30);
    expect(row('geo').querySelector('[role="alert"]')?.textContent).toBe(t('upd.reason.archive_unsafe'));
    expect(row('geo').textContent).not.toContain(t('upd.comp.done.applied'));
  });

  it('ABORTED (другое обновление данных идёт) — понятный текст, а не «ядро недоступно»', async () => {
    core({
      [CHECK]: checkWith(geoOffer),
      [DOWNLOAD]: new StreamReply([], { error: { code: 'aborted', message: 'busy' } }),
    });
    await checked();
    await click(rowBtn('geo', t('upd.comp.apply')));
    await flush(30);
    expect(row('geo').querySelector('[role="alert"]')?.textContent).toBe(t('upd.comp.busy'));
  });

  it('пока идёт обновление, кнопки обеих строк недоступны, статус объявлен для скринридера', async () => {
    core({
      [CHECK]: checkWith(presetsOffer, geoOffer),
      [DOWNLOAD]: new StreamReply([], { hold: true }),
    });
    await checked();
    await click(rowBtn('presets', t('upd.comp.apply')));
    expect(rowBtn('presets', t('upd.comp.apply')).disabled).toBe(true);
    expect(rowBtn('geo', t('upd.comp.apply')).disabled).toBe(true);
    expect(row('presets').querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
  });
});

describe('откат', () => {
  const withRollback: Json = { components: [{ component: PRESETS, rollbackAvailable: true, previousVersion: 'lav-ru:2' }] };

  it('кнопки «Откатить» нет, пока ядро не сообщило rollback_available', async () => {
    core({ [CHECK]: checkWith() });
    await checked();
    expect(rowBtn('presets', t('upd.comp.rollback'))).toBeUndefined();
    expect(rowBtn('geo', t('upd.comp.rollback'))).toBeUndefined();
  });

  it('«Откатить» → подтверждение → Rollback(PRESETS) → «возвращена прошлая ревизия»', async () => {
    let calls = 0;
    core({
      [STATE]: () => (calls++ === 0 ? withRollback : {}),
      [CHECK]: checkWith(),
      [ROLLBACK]: { success: true, restoredVersion: 'lav-ru:2' },
    });
    await checked();
    expect(row('presets').textContent).toContain(tf('upd.comp.prev', { v: 'lav-ru:2' }));
    await click(rowBtn('presets', t('upd.comp.rollback')));
    expect(stub.bodies(ROLLBACK)).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(tf('upd.comp.rbTitle', { name: t('upd.comp.presets') }));
    await click(document.querySelector('.dlg .btn-pri'));
    await flush(30);
    expect(stub.bodies(ROLLBACK)).toEqual([{ component: PRESETS }]);
    expect(row('presets').textContent).toContain(t('upd.comp.done.rolledBack'));
    expect(rowBtn('presets', t('upd.comp.rollback'))).toBeUndefined();
  });

  it('отмена в подтверждении ничего не откатывает', async () => {
    core({ [STATE]: withRollback, [CHECK]: checkWith(), [ROLLBACK]: { success: true } });
    await mount(createElement(UpdatesScreen));
    await click(rowBtn('presets', t('upd.comp.rollback')));
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('.dlg button')).find((b) => b.textContent === t('common.cancel')));
    expect(stub.bodies(ROLLBACK)).toHaveLength(0);
  });

  it('needs_profile_restart в ответе отката — просьба переподключить профиль', async () => {
    core({ [STATE]: withRollback, [ROLLBACK]: { success: true, needsProfileRestart: true } });
    await mount(createElement(UpdatesScreen));
    await click(rowBtn('presets', t('upd.comp.rollback')));
    await click(document.querySelector('.dlg .btn-pri'));
    await flush(30);
    expect(row('presets').textContent).toContain(t('upd.comp.restart'));
  });

  it('нет прошлой ревизии (FAILED_PRECONDITION) — текст причины', async () => {
    core({
      [STATE]: withRollback,
      [ROLLBACK]: new Failure('failed_precondition', 'no_previous: прошлой ревизии нет'),
    });
    await mount(createElement(UpdatesScreen));
    await click(rowBtn('presets', t('upd.comp.rollback')));
    await click(document.querySelector('.dlg .btn-pri'));
    await flush(30);
    expect(row('presets').querySelector('[role="alert"]')?.textContent).toBe(t('upd.reason.no_previous'));
  });
});

describe('доступность и вне оболочки', () => {
  it('карточка — именованная группа; строки подписаны; работает и без оболочки (веб-панель)', async () => {
    disableTauri();
    core({ [CHECK]: checkWith(presetsOffer) });
    await mount(createElement(UpdatesScreen));
    const group = card();
    expect(group.getAttribute('role')).toBe('group');
    const labelled = document.getElementById(group.getAttribute('aria-labelledby') ?? '');
    expect(labelled?.textContent).toBe(t('upd.comp.title'));
    expect(row('presets').textContent).toContain(t('upd.comp.presets'));
    expect(row('geo').textContent).toContain(t('upd.comp.geo'));
  });
});
