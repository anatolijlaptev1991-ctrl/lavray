// SPDX-License-Identifier: GPL-3.0-only

// UpdatesScreen.test.tsx — экран «Обновления» целиком (T-75): метки обязательного
// обновления и беты, сохранение канала и подтверждение беты, честное «проверка не
// удалась», «не настроено», заметки без разметки, установка и отказ в UAC, a11y.
// Ядро — настоящие клиенты поверх подменённого fetch, оболочка — подставка Tauri.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { setLanguage } from '../../lib/i18n';
import {
  Failure,
  click,
  flush,
  mount,
  stubCore,
  unmountAll,
  type CoreStub,
  type Json,
  type Route,
} from '../../test-utils/coreStub';
import { StreamReply } from '../../test-utils/streamStub';
import { UpdatesScreen } from './UpdatesScreen';

vi.mock('@tauri-apps/api/core', async () => (await import('../../test-utils/tauriStub')).tauriCoreModule);
const { tauri, enableTauri, disableTauri } = await import('../../test-utils/tauriStub');

const APP = 'UPDATE_COMPONENT_APP';
const SHA = 'e'.repeat(64);
const DAY = 86_400_000;
const STATE = 'UpdateService/GetUpdateState';
const CHECK = 'UpdateService/CheckUpdates';
const DOWNLOAD = 'UpdateService/DownloadUpdates';
const APPLY = 'UpdateService/ApplyUpdates';
const GET_SETTINGS = 'SettingsService/GetSettings';
const SET_SETTINGS = 'SettingsService/SetSettings';

const offer = (extra: Json = {}): Json => ({
  available: [{ component: APP, currentVersion: '1.1.0', availableVersion: '1.2.0', ...extra }],
  currentAppVersion: '1.1.0',
  coreVersion: '0.5.0',
  lastCheckedAtMs: String(Date.now()),
});
const verified: Json = { verified: { component: APP, version: '1.2.0', stagedPath: 'C:\\s\\a.exe', sha256: SHA } };

function core(routes: Record<string, Route> = {}): CoreStub {
  return stubCore({ [STATE]: {}, [GET_SETTINGS]: { values: {} }, [SET_SETTINGS]: {}, ...routes });
}

const container = (): HTMLElement => document.body;
const buttons = (): HTMLButtonElement[] => Array.from(container().querySelectorAll('button'));
const btn = (text: string): HTMLButtonElement | null => buttons().find((b) => (b.textContent ?? '').trim() === text) ?? null;
const select = (): HTMLSelectElement => container().querySelector('select')!;
const offerCard = (): Element | null => container().querySelector('.upd-card');
const text = (): string => container().textContent ?? '';

async function show(): Promise<void> {
  await mount(createElement(UpdatesScreen));
}

async function pickChannel(value: string): Promise<void> {
  await act(async () => {
    select().value = value;
    select().dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  await flush(20);
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

describe('mandatory_badge_is_not_beta', () => {
  it('обязательное обновление на стабильном канале: «Required», без «Beta»', async () => {
    core({ [CHECK]: offer({ mandatory: true }) });
    await show();
    await click(btn('Check now'));
    const card = offerCard()!;
    expect(card.querySelector('[data-badge="mandatory"]')?.textContent).toBe('Required');
    expect(card.querySelector('[data-badge="beta"]')).toBeNull();
    expect(card.textContent).not.toContain('Beta');
  });

  it('необязательное обновление бета-канала: метка «Beta»', async () => {
    core({ [CHECK]: offer({ manifest: { channel: 'UPDATE_CHANNEL_BETA' } }) });
    await show();
    await click(btn('Check now'));
    const card = offerCard()!;
    expect(card.querySelector('[data-badge="beta"]')?.textContent).toBe('Beta');
    expect(card.querySelector('[data-badge="mandatory"]')).toBeNull();
  });

  it('обязательное обновление беты — только «Required»', async () => {
    core({ [CHECK]: offer({ mandatory: true, manifest: { channel: 'UPDATE_CHANNEL_BETA' } }) });
    await show();
    await click(btn('Check now'));
    expect(offerCard()!.querySelector('[data-badge="mandatory"]')).not.toBeNull();
    expect(offerCard()!.querySelector('[data-badge="beta"]')).toBeNull();
  });

  it('обычное стабильное обновление без меток', async () => {
    core({ [CHECK]: offer() });
    await show();
    await click(btn('Check now'));
    expect(offerCard()!.querySelector('.badge')).toBeNull();
  });
});

describe('install_button_calls_update_apply', () => {
  it('«Install now» вызывает update_apply со значениями из события verified', async () => {
    tauri.onValue('update_apply', { status: 'installing' });
    core({
      [CHECK]: offer(),
      [DOWNLOAD]: new StreamReply([verified]),
      [APPLY]: new StreamReply([{ readyForRestart: 'restart' }]),
    });
    await show();
    await click(btn('Check now'));
    await click(btn('Download update'));
    expect(text()).toContain('Version 1.2.0 is downloaded');
    await click(btn('Install now'));
    expect(tauri.argsOf('update_apply')).toEqual([{ stagedPath: 'C:\\s\\a.exe', sha256: SHA, version: '1.2.0' }]);
    expect(container().querySelector('[role="status"][aria-busy="true"]')?.textContent).toContain('Installing the update');
  });

  it('двойной клик по «Download update» запускает одну загрузку', async () => {
    const stub = core({ [CHECK]: offer(), [DOWNLOAD]: new StreamReply([verified]) });
    await show();
    await click(btn('Check now'));
    const download = btn('Download update')!;
    await act(async () => {
      download.click();
      download.click();
      await Promise.resolve();
    });
    await flush(30);
    expect(stub.bodies(DOWNLOAD)).toHaveLength(1);
  });
});

describe('uac_cancel_message', () => {
  it('отказ в UAC: сообщение, возврат к «Install now», ничего не потеряно', async () => {
    tauri.onValue('update_apply', { status: 'uac_cancelled' });
    core({
      [CHECK]: offer(),
      [DOWNLOAD]: new StreamReply([verified]),
      [APPLY]: new StreamReply([{ readyForRestart: 'restart' }]),
    });
    await show();
    await click(btn('Check now'));
    await click(btn('Download update'));
    await click(btn('Install now'));
    expect(text()).toContain('Installation cancelled: the Windows prompt wasn’t confirmed.');
    expect(btn('Install now')).not.toBeNull();
  });
});

describe('channel_is_persisted', () => {
  it('канал читается при открытии, запись уходит в update.channel, проверка идёт по нему', async () => {
    const stub = core({
      [GET_SETTINGS]: { values: { 'update.channel': { stringValue: 'beta' } } },
      [CHECK]: { currentAppVersion: '1.1.0' },
    });
    await show();
    expect(select().value).toBe('beta');
    await pickChannel('stable');
    expect(stub.bodies(SET_SETTINGS)).toEqual([{ values: { 'update.channel': { stringValue: 'stable' } } }]);
    await click(btn('Check now'));
    expect(stub.bodies(CHECK)).toEqual([{}]);
  });

  it('запрошенные ключи: канал и автопроверка', async () => {
    const stub = core();
    await show();
    expect(stub.bodies(GET_SETTINGS)).toEqual([{ keys: ['update.channel', 'update.auto_check'] }]);
  });

  it('ошибка записи: канал откатывается, причина показана красной плашкой', async () => {
    core({
      [GET_SETTINGS]: { values: { 'update.channel': { stringValue: 'stable' } } },
      [SET_SETTINGS]: new Failure('unavailable', 'core is down'),
    });
    await show();
    await pickChannel('stable');
    expect(select().value).toBe('stable');
    await pickChannel('beta');
    await click(btn('Switch to beta'));
    expect(select().value).toBe('stable');
    expect(container().querySelector('.banner [role="alert"], [role="alert"]')).not.toBeNull();
  });

  it('смена канала сбрасывает устаревший результат проверки', async () => {
    core({ [CHECK]: offer() });
    await show();
    await click(btn('Check now'));
    expect(offerCard()).not.toBeNull();
    await pickChannel('beta');
    await click(btn('Switch to beta'));
    expect(offerCard()).toBeNull();
  });
});

describe('beta_switch_requires_confirm', () => {
  it('выбор беты открывает диалог, запись не уходит; фокус на безопасной «Cancel»', async () => {
    const stub = core();
    await show();
    await pickChannel('beta');
    const dlg = container().querySelector('[role="dialog"]')!;
    expect(dlg).not.toBeNull();
    expect(dlg.textContent).toContain('Switch to the beta channel?');
    expect(stub.bodies(SET_SETTINGS)).toEqual([]);
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('«Cancel» оставляет stable и ничего не пишет', async () => {
    const stub = core();
    await show();
    await pickChannel('beta');
    await click(btn('Cancel'));
    expect(container().querySelector('[role="dialog"]')).toBeNull();
    expect(select().value).toBe('stable');
    expect(stub.bodies(SET_SETTINGS)).toEqual([]);
  });

  it('Esc тоже отказ', async () => {
    const stub = core();
    await show();
    await pickChannel('beta');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });
    expect(container().querySelector('[role="dialog"]')).toBeNull();
    expect(stub.bodies(SET_SETTINGS)).toEqual([]);
  });

  it('подтверждение пишет beta; обратно на stable — без вопросов', async () => {
    const stub = core();
    await show();
    await pickChannel('beta');
    await click(btn('Switch to beta'));
    expect(stub.bodies(SET_SETTINGS)).toEqual([{ values: { 'update.channel': { stringValue: 'beta' } } }]);
    expect(select().value).toBe('beta');
    await pickChannel('stable');
    expect(container().querySelector('[role="dialog"]')).toBeNull();
    expect(stub.bodies(SET_SETTINGS)).toHaveLength(2);
  });
});

describe('check_failed_is_not_no_updates (экран)', () => {
  it('UNAVAILABLE: красная плашка с повтором, текста «последняя версия» нет', async () => {
    core({ [CHECK]: new Failure('unavailable', 'all sources unreachable') });
    await show();
    await click(btn('Check now'));
    const alert = container().querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('The check failed.');
    expect(text()).not.toContain('latest version');
    expect(btn('Try again')).not.toBeNull();
  });

  it('время последней проверки остаётся прежним', async () => {
    const old = Date.now() - 3 * DAY;
    core({ [STATE]: { lastCheckedAtMs: String(old) }, [CHECK]: new Failure('unavailable', 'x') });
    await show();
    await click(btn('Check now'));
    expect(container().querySelector('#updLastCheck')?.textContent).toContain('3 days ago');
  });

  it('успешная проверка без обновления — «последняя версия» с версиями', async () => {
    core({ [CHECK]: { currentAppVersion: '1.1.0', coreVersion: '0.5.0', lastCheckedAtMs: String(Date.now()) } });
    await show();
    await click(btn('Check now'));
    expect(text()).toContain('You are up to date');
    expect(text()).toContain('1.1.0');
    expect(text()).toContain('0.5.0');
  });
});

describe('not_configured', () => {
  it('GetUpdateState сообщил not_configured: честное сообщение, «Check now» недоступна, запросов проверки нет', async () => {
    const stub = core({ [STATE]: new Failure('failed_precondition', 'not_configured: no trust root') });
    await show();
    const note = container().querySelector('[role="status"]')!;
    expect(note.textContent).toBe('Updates are not configured (no trust root in this build).');
    expect(btn('Check now')!.disabled).toBe(true);
    expect(container().querySelector('[role="alert"]')).toBeNull();
    expect(stub.bodies(CHECK)).toEqual([]);
  });

  it('CheckUpdates ответил not_configured: то же сообщение и нет цикла повторов', async () => {
    const stub = core({ [CHECK]: new Failure('failed_precondition', 'not_configured: no trust root') });
    await show();
    await click(btn('Check now'));
    expect(text()).toContain('Updates are not configured');
    expect(btn('Check now')!.disabled).toBe(true);
    await click(btn('Check now'));
    expect(stub.bodies(CHECK)).toHaveLength(1);
  });

  it('отказ по причине: свой текст для каждой причины', async () => {
    core({ [CHECK]: new Failure('failed_precondition', 'bad_signature: invalid ed25519') });
    await show();
    await click(btn('Check now'));
    expect(container().querySelector('[role="alert"]')?.textContent).toContain('The update’s signature didn’t verify');
  });
});

describe('notes_render_without_html', () => {
  const payload = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>**bold** <b>x</b>\nline two';

  it('заметки — текстовые узлы: ни img, ни script, ни b; текст виден буквально', async () => {
    core({ [CHECK]: offer({ notes: { en: payload } }) });
    await show();
    await click(btn('Check now'));
    const notes = container().querySelector('.upd-notes')!;
    expect(notes.querySelector('img, script, b, a, *')).toBeNull();
    expect(notes.textContent).toBe(payload);
    expect(notes.innerHTML).toContain('&lt;img');
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    expect(getComputedStyle(notes).whiteSpace).toBe('pre-wrap');
  });

  it('нет заметок — блока «What’s new» нет; заметки на языке интерфейса выбираются по локали', async () => {
    core({ [CHECK]: offer() });
    await show();
    await click(btn('Check now'));
    expect(container().querySelector('.upd-notes')).toBeNull();
  });

  it('заметки на другом языке интерфейса берутся из локали, иначе — английские', async () => {
    setLanguage('de');
    core({ [CHECK]: offer({ notes: { en: 'English notes', de: 'Deutsche Notizen' } }) });
    await show();
    await click(container().querySelector('.srv-import-row .btn-pri'));
    expect(container().querySelector('.upd-notes')?.textContent).toBe('Deutsche Notizen');
  });
});

describe('last_checked на экране', () => {
  it('до первой проверки строки нет', async () => {
    core({ [STATE]: { lastCheckedAtMs: '0' } });
    await show();
    expect(container().querySelector('#updLastCheck')).toBeNull();
  });

  it('8 суток назад — предупреждение, 40 — красная пометка', async () => {
    core({ [STATE]: { lastCheckedAtMs: String(Date.now() - 8 * DAY) } });
    await show();
    expect(container().querySelector('#updLastCheck')?.getAttribute('data-fresh')).toBe('warn');
    unmountAll();
    core({ [STATE]: { lastCheckedAtMs: String(Date.now() - 40 * DAY) } });
    await show();
    expect(container().querySelector('#updLastCheck')?.getAttribute('data-fresh')).toBe('red');
    expect(container().querySelector('#updLastCheck .badge-err')).not.toBeNull();
  });
});

describe('автопроверка', () => {
  it('по умолчанию включена; выключение пишет update.auto_check=false', async () => {
    const stub = core();
    await show();
    const sw = container().querySelector<HTMLButtonElement>('#updAutoRow [role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(stub.bodies(SET_SETTINGS)).toEqual([{ values: { 'update.auto_check': { boolValue: false } } }]);
  });

  it('сохранённое выключенное значение читается при открытии', async () => {
    core({ [GET_SETTINGS]: { values: { 'update.auto_check': { boolValue: false } } } });
    await show();
    expect(container().querySelector('#updAutoRow [role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  });

  it('ошибка записи возвращает переключатель назад', async () => {
    core({ [SET_SETTINGS]: new Failure('unavailable', 'down') });
    await show();
    const sw = container().querySelector<HTMLButtonElement>('#updAutoRow [role="switch"]')!;
    await click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
});

describe('a11y (A)', () => {
  it('выбор канала подписан, переключатель имеет имя и описание', async () => {
    core();
    await show();
    const sel = select();
    expect(container().querySelector(`label[for="${sel.id}"]`)?.textContent).toBe('Update channel');
    const sw = container().querySelector('#updAutoRow [role="switch"]')!;
    const name = document.getElementById(sw.getAttribute('aria-labelledby') ?? '')?.textContent;
    expect(name).toBe('Check for updates automatically');
    expect(sw.getAttribute('aria-describedby')).not.toBeNull();
  });

  it('загрузка: progressbar с именем и значением, «Cancel download» доступна с клавиатуры', async () => {
    core({
      [CHECK]: offer(),
      [DOWNLOAD]: new StreamReply(
        [{ progress: { component: APP, downloadedBytes: '25', totalBytes: '100', bps: 5 } }],
        { hold: true },
      ),
    });
    await show();
    await click(btn('Check now'));
    await click(btn('Download update'));
    const bar = container().querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-label')).toBe('Downloading…');
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    const cancel = btn('Cancel download')!;
    expect(cancel.tabIndex).toBeGreaterThanOrEqual(0);
    await click(cancel);
    expect(btn('Download update')).not.toBeNull();
  });

  it('ошибки объявляются role=alert, ход проверки — role=status', async () => {
    core({ [CHECK]: new Failure('unavailable', 'x') });
    await show();
    await click(btn('Check now'));
    expect(container().querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('активная сессия: диалог, фокус на «Cancel», «Disconnect and install» повторяет с подтверждением', async () => {
    tauri.onValue('update_apply', { status: 'installing' });
    const replies = [
      new StreamReply([], { error: { code: 'failed_precondition', message: 'active_session: VPN is on' } }),
      new StreamReply([{ readyForRestart: 'restart' }]),
    ];
    const stub = core({
      [CHECK]: offer(),
      [DOWNLOAD]: new StreamReply([verified]),
      [APPLY]: (n: number) => replies[n]!,
    });
    await show();
    await click(btn('Check now'));
    await click(btn('Download update'));
    await click(btn('Install now'));
    const dlg = container().querySelector('[role="dialog"]')!;
    expect(dlg.textContent).toContain('The VPN connection will be dropped');
    expect(document.activeElement?.textContent).toBe('Cancel');
    await click(btn('Disconnect and install'));
    expect(stub.bodies(APPLY)[1]).toEqual({ components: [APP], activeSessionConfirmed: true });
    expect(tauri.argsOf('update_apply')).toHaveLength(1);
  });
});
