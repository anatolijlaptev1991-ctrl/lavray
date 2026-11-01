// SPDX-License-Identifier: GPL-3.0-only

// appUpdate.ts — из ответа CheckUpdates в «доступное обновление приложения» и
// выбор заметок по языку (T-75). Остальные компоненты (ядро, пресеты, гео) этим
// потоком не ставятся: их доставка — отдельные фазы плана.
import { UpdateChannel, UpdateComponent } from '../../gen/lavray_pb';
import type { CheckUpdatesResponse } from '../../gen/lavray_pb';
import type { AvailableUpdate, Channel, Versions } from './types';

/** Предел длины заметок: подписанный манифест не должен раздувать экран. */
const MAX_NOTES_CHARS = 4000;

export function versionsOf(res: CheckUpdatesResponse): Versions {
  return { app: res.currentAppVersion, core: res.coreVersion };
}

/** Обновление приложения из ответа проверки; `null` — приложение уже последней версии. */
export function appUpdateOf(res: CheckUpdatesResponse, requested: Channel): AvailableUpdate | null {
  const app = res.available.find((c) => c.component === UpdateComponent.APP);
  const version = app?.availableVersion ?? '';
  if (app === undefined || version === '') return null;
  const { manifest } = app;
  const channel: Channel =
    manifest === undefined ? requested : manifest.channel === UpdateChannel.BETA ? 'beta' : 'stable';
  const own = Object.keys(app.notes).length > 0;
  return {
    version,
    currentVersion: app.currentVersion,
    mandatory: app.mandatory,
    channel,
    notes: own ? { ...app.notes } : { ...(manifest?.notes ?? {}) },
  };
}

/** Заметки на языке интерфейса: язык → локаль с регионом → английский → любой; только текст. */
export function pickNotes(notes: Readonly<Record<string, string>>, lang: string): string {
  const keys = Object.keys(notes).sort();
  const region = keys.find((k) => k.toLowerCase().startsWith(`${lang.toLowerCase()}-`));
  const candidates = [lang, region, 'en', ...keys];
  for (const key of candidates) {
    const text = key === undefined ? '' : (notes[key] ?? '').trim();
    if (text !== '') return text.length > MAX_NOTES_CHARS ? `${text.slice(0, MAX_NOTES_CHARS)}…` : text;
  }
  return '';
}
