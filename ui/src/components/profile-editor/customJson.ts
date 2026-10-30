// SPDX-License-Identifier: GPL-3.0-only

// customJson.ts — «Custom outbound JSON» и «Custom config JSON» редактора профиля
// (FR-UI-084/085): состояние, проверка и перенос в proto-профиль. Подтверждение этих
// полей клиент не выставляет: его считает ядро, а редактор лишь отправляет текст.
import { create } from '@bufbuild/protobuf';
import { ProfileSchema } from '../../gen/lavray_pb';
import type { Profile } from '../../gen/lavray_pb';
import { checkJsonObject, MAX_CUSTOM_JSON_BYTES } from '../../lib/jsonText';
import type { JsonCheck } from '../../lib/jsonText';
import type { MessageKey } from '../../lib/i18n';

export interface CustomJson {
  readonly outbound: string;
  readonly config: string;
}

/** id полей в DOM: на них уходит фокус при отказе сохранять. */
export const CUSTOM_OUTBOUND_ID = 'edCustomOut';
export const CUSTOM_CONFIG_ID = 'edCustomCfg';

/** Начальные значения: у нового профиля пусто, у существующего — как в ядре. */
export function customFromProfile(profile: Profile | null): CustomJson {
  return { outbound: profile?.customOutboundJson ?? '', config: profile?.customConfigJson ?? '' };
}

/** Пустой (пробельный) текст в proto не отправляется: поле очищается. */
const orUnset = (text: string): string | undefined => (text.trim() === '' ? undefined : text);

/** Копия профиля с custom-полями формы (UpdateProfile — полная замена, поэтому и очистка уходит). */
export function withCustom(model: Profile, custom: CustomJson): Profile {
  return create(ProfileSchema, {
    ...model,
    customOutboundJson: orUnset(custom.outbound),
    customConfigJson: orUnset(custom.config),
  });
}

/** id первого поля с ошибкой или null, если оба текста годятся. */
export function firstInvalidCustom(custom: CustomJson): string | null {
  if (!checkJsonObject(custom.outbound).ok) return CUSTOM_OUTBOUND_ID;
  if (!checkJsonObject(custom.config).ok) return CUSTOM_CONFIG_ID;
  return null;
}

type Translate = (key: MessageKey) => string;
type TranslateWith = (key: MessageKey, params: Readonly<Record<string, string | number>>) => string;

/** Текст ошибки поля; undefined — ошибки нет. */
export function customErrorText(check: JsonCheck, t: Translate, tf: TranslateWith): string | undefined {
  if (check.ok) return undefined;
  switch (check.code) {
    case 'too_large':
      return tf('cf.err.tooLarge', { kb: MAX_CUSTOM_JSON_BYTES / 1024 });
    case 'not_object':
      return t('ed.jsonObj');
    case 'syntax':
      return check.line === undefined || check.column === undefined
        ? t('cf.err.syntax')
        : tf('cf.err.syntaxAt', { line: check.line, col: check.column });
  }
}
