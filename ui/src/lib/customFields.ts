// SPDX-License-Identifier: GPL-3.0-only

// customFields.ts — что считается custom-содержимым профиля (T-08B). Подтверждение
// считает ядро; клиенту нужно только решить, есть ли что подтверждать: непустой
// custom_outbound_json / custom_config_json или полный конфиг профиля CUSTOM_CONFIG
// (core = internal-full). Пустая строка и `{}` — не custom-содержимое.
import { CustomDetail_Core } from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';

/** Непустой custom-JSON: не пустая строка и не пустой объект. */
export function isCustomJson(json: string | undefined): boolean {
  if (json === undefined || json.trim() === '') return false;
  try {
    const parsed: unknown = JSON.parse(json);
    const empty =
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 0;
    return !empty;
  } catch {
    return true; // нечитаемое содержимое ядро разберёт и отклонит само
  }
}

/** У профиля есть custom-содержимое, которое нужно подтверждать. */
export function hasCustomContent(profile: Profile): boolean {
  if (isCustomJson(profile.customOutboundJson) || isCustomJson(profile.customConfigJson)) return true;
  const detail = profile.detail;
  return (
    detail.case === 'custom' &&
    detail.value.core === CustomDetail_Core.INTERNAL_FULL &&
    isCustomJson(detail.value.fullConfigJson)
  );
}

/** Custom-содержимое есть, но ядро его ещё не подтвердило: оно не применяется к конфигу. */
export function needsCustomConfirm(profile: Profile): boolean {
  return hasCustomContent(profile) && !profile.customFieldsConfirmed;
}
