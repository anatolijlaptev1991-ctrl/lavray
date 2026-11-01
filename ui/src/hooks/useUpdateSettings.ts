// SPDX-License-Identifier: GPL-3.0-only

// useUpdateSettings.ts — настройки обновлений в ядре (SettingsService, T-75):
// `update.channel` ("stable" | "beta", по умолчанию stable) и `update.auto_check`
// (bool, по умолчанию включено). Значения читаются при открытии экрана и пишутся
// при изменении; неудачная запись откатывает значение и сообщает об ошибке.
import { create } from '@bufbuild/protobuf';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingValueSchema } from '../gen/lavray_pb';
import type { SettingValue } from '../gen/lavray_pb';
import type { Channel } from '../lib/updates/types';
import { useCore } from './useCore';

/** Ключ настройки: выбранный канал обновлений. */
export const CHANNEL_KEY = 'update.channel';
/** Ключ настройки: фоновая проверка раз в несколько часов. */
export const AUTO_CHECK_KEY = 'update.auto_check';

export interface UpdateSettings {
  readonly channel: Channel;
  readonly autoCheck: boolean;
  /** Записать канал; `true` — записано. */
  readonly setChannel: (next: Channel) => Promise<boolean>;
  readonly setAutoCheck: (next: boolean) => Promise<boolean>;
}

/**
 * Значение, которое показывается сразу и записывается в ядро: при отказе записи
 * возвращается прежнее. Пока пользователь ничего не менял, `hydrate` подставляет
 * прочитанное; после его выбора запоздавший ответ чтения значение не затирает.
 */
function useSavedValue<T>(
  initial: T,
  persist: (value: T) => Promise<boolean>,
): { value: T; set: (next: T) => Promise<boolean>; hydrate: (read: T) => void } {
  const [value, setValue] = useState<T>(initial);
  const touched = useRef(false);
  const set = useCallback(
    async (next: T): Promise<boolean> => {
      touched.current = true;
      const prev = value;
      setValue(next);
      const ok = await persist(next);
      if (!ok) setValue(prev);
      return ok;
    },
    [value, persist],
  );
  const hydrate = useCallback((read: T): void => {
    if (!touched.current) setValue(read);
  }, []);
  return { value, set, hydrate };
}

const str = (value: string): SettingValue => create(SettingValueSchema, { value: { case: 'stringValue', value } });
const bool = (value: boolean): SettingValue => create(SettingValueSchema, { value: { case: 'boolValue', value } });

/** `onError` получает исходную ошибку записи; текст для пользователя собирает экран. */
export function useUpdateSettings(onError: (e: unknown) => void): UpdateSettings {
  const core = useCore();
  const report = useRef(onError);
  report.current = onError;

  const write = useCallback(
    async (key: string, value: SettingValue): Promise<boolean> => {
      try {
        await core.settings.setSettings({ values: { [key]: value } });
        return true;
      } catch (e) {
        report.current(e);
        return false;
      }
    },
    [core],
  );
  const channel = useSavedValue<Channel>('stable', useCallback((c: Channel) => write(CHANNEL_KEY, str(c)), [write]));
  const auto = useSavedValue<boolean>(true, useCallback((b: boolean) => write(AUTO_CHECK_KEY, bool(b)), [write]));
  const { hydrate: hydrateChannel } = channel;
  const { hydrate: hydrateAuto } = auto;

  useEffect(() => {
    const ac = new AbortController();
    void (async (): Promise<void> => {
      try {
        const res = await core.settings.getSettings({ keys: [CHANNEL_KEY, AUTO_CHECK_KEY] }, { signal: ac.signal });
        const ch = res.values[CHANNEL_KEY]?.value;
        const on = res.values[AUTO_CHECK_KEY]?.value;
        if (ch?.case === 'stringValue') hydrateChannel(ch.value === 'beta' ? 'beta' : 'stable');
        if (on?.case === 'boolValue') hydrateAuto(on.value);
      } catch {
        /* настройки недоступны: остаются значения по умолчанию (stable, проверка включена) */
      }
    })();
    return (): void => {
      ac.abort();
    };
  }, [core, hydrateChannel, hydrateAuto]);

  return { channel: channel.value, autoCheck: auto.value, setChannel: channel.set, setAutoCheck: auto.set };
}
