// SPDX-License-Identifier: GPL-3.0-only

// uiState.test.ts — T-81 (ревью): общие настройки UI живут в файле оболочки,
// localStorage — кэш. Оболочка — подставка с «файлом» в памяти; два профиля
// WebView — два прохода через пустой localStorage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UI_STATE_KEYS,
  flushUiState,
  hydrateUiState,
  installUiStateSync,
  saveUiStateNow,
} from './uiState';

interface Call {
  readonly cmd: string;
  readonly args: unknown;
}

interface Shell {
  file: { exists: boolean; entries: Record<string, string> };
  calls: { cmd: string; args: unknown }[];
  setDelay: undefined | ((key: string) => number);
  failSet: boolean;
  failLoad: boolean;
}

const shell = vi.hoisted(
  (): Shell => ({
    file: { exists: false, entries: {} },
    calls: [],
    setDelay: undefined,
    failSet: false,
    failLoad: false,
  }),
);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: { key: string; value: string | null }): Promise<unknown> => {
    shell.calls.push({ cmd, args });
    if (cmd === 'ui_state_load') {
      if (shell.failLoad) throw new Error('нет команды');
      return { exists: shell.file.exists, entries: { ...shell.file.entries } };
    }
    if (cmd === 'ui_state_set' && args !== undefined) {
      const wait = shell.setDelay?.(args.key) ?? 0;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (shell.failSet) throw new Error('диск полон');
      const rest = Object.entries(shell.file.entries).filter(([key]) => key !== args.key);
      if (args.value !== null) rest.push([args.key, args.value]);
      shell.file = { exists: true, entries: Object.fromEntries(rest) };
      return null;
    }
    throw new Error(`неизвестная команда ${cmd}`);
  },
}));

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

const sets = (): Call[] => shell.calls.filter((c) => c.cmd === 'ui_state_set');
let uninstall: (() => void) | undefined;

beforeEach(() => {
  window.localStorage.clear();
  shell.file = { exists: false, entries: {} };
  shell.calls = [];
  shell.setDelay = undefined;
  shell.failSet = false;
  shell.failLoad = false;
  (window as TauriWindow).__TAURI_INTERNALS__ = {};
});

afterEach(async () => {
  await flushUiState();
  uninstall?.();
  uninstall = undefined;
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe('hydrateUiState', () => {
  it('значения из файла важнее кэша и не уходят обратно в файл', async () => {
    shell.file = {
      exists: true,
      entries: { 'lavray.lang': 'de', 'lavray.onboarded': '1' },
    };
    window.localStorage.setItem('lavray.lang', 'ru'); // кэш устарел
    uninstall = installUiStateSync(window.localStorage);

    await hydrateUiState(window.localStorage);
    await flushUiState();

    expect(window.localStorage.getItem('lavray.lang')).toBe('de');
    expect(window.localStorage.getItem('lavray.onboarded')).toBe('1');
    expect(sets(), 'применение файла — не изменение настроек').toEqual([]);
  });

  it('ключи, которых нет в файле, но есть в кэше, переносятся в файл (первый запуск после обновления)', async () => {
    shell.file = { exists: true, entries: { 'lavray.lang': 'en' } };
    window.localStorage.setItem('lavray.theme', 'dark');
    window.localStorage.setItem('lavray.server', '7');

    await hydrateUiState(window.localStorage);
    await flushUiState();

    expect(shell.file.entries).toEqual({
      'lavray.lang': 'en',
      'lavray.theme': 'dark',
      'lavray.server': '7',
    });
  });

  it('файла нет (или он был испорчен): весь кэш становится файлом', async () => {
    window.localStorage.setItem('lavray.modes', '{"sysProxy":true,"tunMode":false}');
    window.localStorage.setItem('lavray.onboarded', '1');

    await hydrateUiState(window.localStorage);
    await flushUiState();

    expect(shell.file.entries).toEqual({
      'lavray.modes': '{"sysProxy":true,"tunMode":false}',
      'lavray.onboarded': '1',
    });
  });

  it('чужие ключи и не-строки из файла не принимаются', async () => {
    shell.file = {
      exists: true,
      entries: {
        'lavray.lang': 'es',
        token: 'secret',
        'lavray.subErrors': '{}',
        'lavray.theme': 5 as unknown as string,
      },
    };

    await hydrateUiState(window.localStorage);

    expect(window.localStorage.getItem('lavray.lang')).toBe('es');
    expect(window.localStorage.getItem('token')).toBeNull();
    expect(window.localStorage.getItem('lavray.subErrors')).toBeNull();
    expect(window.localStorage.getItem('lavray.theme')).toBeNull();
  });

  it('сбой команды и работа вне оболочки: окно остаётся со своим кэшем', async () => {
    window.localStorage.setItem('lavray.lang', 'ru');
    shell.failLoad = true;
    await expect(hydrateUiState(window.localStorage)).resolves.toBeUndefined();
    expect(window.localStorage.getItem('lavray.lang')).toBe('ru'); // команды нет — свой кэш
    shell.failLoad = false;
    shell.failSet = true;
    await expect(hydrateUiState(window.localStorage)).resolves.toBeUndefined();
    await flushUiState(); // запись упала, очередь не сломана
    expect(window.localStorage.getItem('lavray.lang')).toBe('ru');

    delete (window as TauriWindow).__TAURI_INTERNALS__;
    shell.calls = [];
    await hydrateUiState(window.localStorage);
    expect(shell.calls).toEqual([]);
  });
});

describe('installUiStateSync', () => {
  it('каждое изменение отслеживаемых ключей сразу уходит в файл', async () => {
    uninstall = installUiStateSync(window.localStorage);

    window.localStorage.setItem('lavray.lang', 'zh');
    window.localStorage.setItem('lavray.modes', '{"tunMode":true}');
    window.localStorage.removeItem('lavray.lang');
    await flushUiState();

    expect(sets().map((c) => c.args)).toEqual([
      { key: 'lavray.lang', value: 'zh' },
      { key: 'lavray.modes', value: '{"tunMode":true}' },
      { key: 'lavray.lang', value: null },
    ]);
    expect(shell.file.entries).toEqual({ 'lavray.modes': '{"tunMode":true}' });
  });

  it('прочие ключи, sessionStorage и localStorage.clear() ведут себя ожидаемо', async () => {
    uninstall = installUiStateSync(window.localStorage);

    window.localStorage.setItem('lavray.subErrors', '{}'); // кэш, не настройка
    window.localStorage.setItem('other', '1');
    window.sessionStorage.setItem('lavray.lang', 'ru'); // другое хранилище
    await flushUiState();
    expect(sets()).toEqual([]);

    window.localStorage.setItem('lavray.theme', 'light');
    window.localStorage.setItem('lavray.onboarded', '1');
    await flushUiState();
    shell.calls = [];
    window.localStorage.clear();
    await flushUiState();
    expect(sets().map((c) => (c.args as { key: string }).key).sort()).toEqual([
      'lavray.onboarded',
      'lavray.theme',
    ]);
    expect(shell.file.entries).toEqual({});
    window.sessionStorage.clear();
  });

  it('записи идут по порядку: позднее значение не затирается ранним', async () => {
    shell.setDelay = (key): number => (key === 'lavray.lang' ? 30 : 0);
    uninstall = installUiStateSync(window.localStorage);

    window.localStorage.setItem('lavray.lang', 'ru');
    window.localStorage.setItem('lavray.lang', 'en');
    window.localStorage.setItem('lavray.theme', 'dark');
    await flushUiState();

    expect(sets().map((c) => c.args)).toEqual([
      { key: 'lavray.lang', value: 'ru' },
      { key: 'lavray.lang', value: 'en' },
      { key: 'lavray.theme', value: 'dark' },
    ]);
    expect(shell.file.entries['lavray.lang']).toBe('en');
  });

  it('сбой записи не останавливает следующие', async () => {
    uninstall = installUiStateSync(window.localStorage);
    shell.failSet = true;
    window.localStorage.setItem('lavray.lang', 'ru');
    await flushUiState();
    shell.failSet = false;
    window.localStorage.setItem('lavray.theme', 'dark');
    await flushUiState();
    expect(shell.file.entries).toEqual({ 'lavray.theme': 'dark' });
  });

  it('снятие перехвата возвращает обычное поведение хранилища', async () => {
    const stop = installUiStateSync(window.localStorage);
    stop();
    window.localStorage.setItem('lavray.lang', 'ru');
    await flushUiState();
    expect(sets()).toEqual([]);
    expect(window.localStorage.getItem('lavray.lang')).toBe('ru');
  });
});

describe('saveUiStateNow', () => {
  it('записывает текущие значения всех отслеживаемых ключей и ждёт записи', async () => {
    window.localStorage.setItem('lavray.modes', '{"tunMode":true}');
    window.localStorage.setItem('lavray.lang', 'de');
    window.localStorage.setItem('lavray.subErrors', '{}');
    shell.setDelay = (): number => 10;

    await saveUiStateNow(window.localStorage);

    expect(shell.file.entries).toEqual({
      'lavray.modes': '{"tunMode":true}',
      'lavray.lang': 'de',
    });
  });
});

describe('два профиля WebView видят одни и те же настройки', () => {
  it('after_restart_both_profiles_have_the_same_values', async () => {
    // профиль 1 (обычный экземпляр): пользователь выбрал язык, режимы, сервер
    await hydrateUiState(window.localStorage);
    uninstall = installUiStateSync(window.localStorage);
    window.localStorage.setItem('lavray.lang', 'de');
    window.localStorage.setItem('lavray.theme', 'dark');
    window.localStorage.setItem('lavray.accent', 'violet');
    window.localStorage.setItem('lavray.modes', '{"sysProxy":false,"tunMode":true}');
    window.localStorage.setItem('lavray.server', '42');
    window.localStorage.setItem('lavray.onboarded', '1');
    await saveUiStateNow(window.localStorage); // как перед перезапуском от администратора
    const first = Object.fromEntries(UI_STATE_KEYS.map((k) => [k, window.localStorage.getItem(k)]));

    // перезапуск: процесс завершён, у повышенного экземпляра профиль WebView пуст
    uninstall();
    uninstall = undefined;
    window.localStorage.clear();
    await hydrateUiState(window.localStorage);
    uninstall = installUiStateSync(window.localStorage);

    const second = Object.fromEntries(UI_STATE_KEYS.map((k) => [k, window.localStorage.getItem(k)]));
    expect(second).toEqual(first);
    expect(second['lavray.onboarded']).toBe('1');

    // и наоборот: изменение в повышенном экземпляре видит обычный после «возврата»
    window.localStorage.setItem('lavray.lang', 'es');
    await flushUiState();
    uninstall();
    uninstall = undefined;
    window.localStorage.clear();
    await hydrateUiState(window.localStorage);
    expect(window.localStorage.getItem('lavray.lang')).toBe('es');
  });
});
