// SPDX-License-Identifier: GPL-3.0-only

// saveProfile.restart.test.ts — сохранение запущенного профиля поднимает общий
// баннер «Перезапустить ядро» (UpdateProfileResponse.needs_profile_restart).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { UpdateProfileResponseSchema } from '../../gen/lavray_pb';
import { clearRestartNeeded, getRestartNeeded } from '../../lib/restartNeeded';
import { makeClients, profileOf } from '../../test-harness';
import { persistProfile } from './saveProfile';

afterEach(() => {
  clearRestartNeeded();
  vi.restoreAllMocks();
});

describe('persistProfile: needs_profile_restart', () => {
  it('ядро просит перезапуск — флаг поднят', async () => {
    const clients = makeClients();
    const profile = profileOf(1, 'S1');
    vi.spyOn(clients.profiles, 'updateProfile').mockResolvedValue(
      create(UpdateProfileResponseSchema, { profile, needsProfileRestart: true }),
    );
    await persistProfile(clients, profile, profile);
    expect(getRestartNeeded()).toBe(true);
  });

  it('перезапуск не нужен — флаг не трогается', async () => {
    const clients = makeClients();
    const profile = profileOf(1, 'S1');
    vi.spyOn(clients.profiles, 'updateProfile').mockResolvedValue(create(UpdateProfileResponseSchema, { profile }));
    await persistProfile(clients, profile, profile);
    expect(getRestartNeeded()).toBe(false);
  });

  it('создание нового профиля баннер не поднимает', async () => {
    const clients = makeClients();
    const profile = profileOf(0, 'New');
    vi.spyOn(clients.profiles, 'createProfile').mockResolvedValue(profile);
    await persistProfile(clients, null, profile);
    expect(getRestartNeeded()).toBe(false);
  });
});
