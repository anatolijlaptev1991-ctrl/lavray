// SPDX-License-Identifier: GPL-3.0-only

// AppNotices.tsx — баннеры уровня приложения над любым экраном: «перезапустите
// ядро» (needs_profile_restart) и «системный прокси сохранён» (kill switch).
// Здесь же живёт карта настроек ядра (useSettingsSync), из которой зеркалится
// kill switch для оболочки.
import type { JSX } from 'react';
import type { CoreState } from '../gen/lavray_pb';
import { useKillSwitch } from '../hooks/useKillSwitch';
import { useSettingsSync } from '../hooks/useSettingsSync';
import { KillSwitchNotice } from './KillSwitchNotice';
import { RestartNotice } from './RestartNotice';

export function AppNotices({ state }: { readonly state: CoreState }): JSX.Element {
  useKillSwitch(useSettingsSync(), state);
  return (
    <>
      <KillSwitchNotice />
      <RestartNotice />
    </>
  );
}
