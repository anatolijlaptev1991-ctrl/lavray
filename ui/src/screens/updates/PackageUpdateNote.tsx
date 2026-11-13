// SPDX-License-Identifier: GPL-3.0-only

// PackageUpdateNote.tsx — вместо «Установить», «Установить из файла» и «Откатиться»
// там, где оболочка не умеет самообновляться (Linux): новая версия ставится
// пакетом поверх текущей. Ссылок нет — только команда.
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';

/** Команда установки; версия неизвестна — подставляется общий вид имени файла. */
function packageInstallCommand(version: string | undefined): string {
  const v = version === undefined || version === '' ? '<version>' : version;
  return `sudo apt install ./lavray-${v}-linux-amd64.deb`;
}

export function PackageUpdateNote({ version }: { readonly version?: string }): JSX.Element {
  const { tf } = useI18n();
  return (
    <p className="cap" id="updPackageNote" style={{ marginTop: 8 }}>
      {tf('upd.pkg.lx', { cmd: packageInstallCommand(version) })}
    </p>
  );
}
