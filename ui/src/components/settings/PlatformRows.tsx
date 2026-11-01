// SPDX-License-Identifier: GPL-3.0-only

// PlatformRows.tsx — строки «Настроек → Общие», зависящие от того, где открыт
// интерфейс. В окне приложения — автозапуск и настройки оболочки (трей,
// уведомления); в веб-панели их нет (окна и ОС роутера у браузера нет), вместо
// них — сессии панели и смена пароля.
import type { JSX } from 'react';
import { SessionsPanel } from '../../screens/web/SessionsPanel';
import { AutostartRow } from '../AutostartRow';
import { ShellPrefRows } from './ShellPrefRows';

export function PlatformRows(): JSX.Element {
  return (
    <>
      <AutostartRow />
      <ShellPrefRows />
      <SessionsPanel />
    </>
  );
}
