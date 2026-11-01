// SPDX-License-Identifier: GPL-3.0-only

// saveProfile.ts — запись профиля из редактора: CreateProfile или UpdateProfile
// с переносом того, чего нет в форме. Возвращает профиль в том виде, как его сохранило
// ядро: по нему редактор решает, нужно ли подтверждать custom-поля (T-08B).
import { create } from '@bufbuild/protobuf';
import { ProfileSchema } from '../../gen/lavray_pb';
import type { Profile } from '../../gen/lavray_pb';
import type { CoreClients } from '../../lib/core';
import { mergeDetail, mergeStream } from '../../lib/profileMerge';
import { markRestartNeeded } from '../../lib/restartNeeded';

/** Копия новой модели с метаданными исходного профиля (для UpdateProfile). */
function mergedWithOriginal(original: Profile, model: Profile): Profile {
  // D1 (аудит round 2): UpdateProfile — ПОЛНАЯ замена. Переносим серверные/
  // пользовательские метаданные из исходного профиля, иначе пропадали избранное и
  // теги, а профиль уезжал в чужую группу. Custom-поля берутся из формы (model).
  // PE-01 (аудит round 3) и T-10: значения формы накладываются на исходные
  // detail/stream (lib/profileMerge.ts), а не заменяют их: поля вне формы
  // (obfs, plugin, packet_encoding…) уцелеют, а очищенное в форме поле очистится.
  return create(ProfileSchema, {
    ...model,
    detail: mergeDetail(original.detail, model.detail),
    stream: mergeStream(original.stream, model.stream),
    groupId: original.groupId,
    favorite: original.favorite,
    tags: original.tags,
  });
}

/** original = null — создание. Ошибки ядра пробрасываются вызывающему. */
export async function persistProfile(
  core: CoreClients,
  original: Profile | null,
  model: Profile,
): Promise<Profile> {
  if (original === null) return core.profiles.createProfile({ profile: model });
  const merged = mergedWithOriginal(original, model);
  const res = await core.profiles.updateProfile({ profile: merged });
  if (res.needsProfileRestart) markRestartNeeded(); // запущенный профиль: баннер «Перезапустить ядро»
  return res.profile ?? merged;
}
