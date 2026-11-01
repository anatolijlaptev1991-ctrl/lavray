// SPDX-License-Identifier: GPL-3.0-only

// NekoBoxTile.tsx — плитка «Перенести из NekoBox» на шаге 2 онбординга (T-78).
// Настоящая кнопка (доступна с клавиатуры): открывает диалог переноса. Если
// ядро нашло установку NekoBox, плитка сразу показывает «Найдено: …» с числами.
import { useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { useNekoBoxDetect } from '../../hooks/useNekoBoxDetect';
import { foundText } from '../../lib/nekoBox';
import { Icon } from '../Icon';
import { NekoBoxImportDialog } from './NekoBoxImportDialog';

export function NekoBoxTile({ onImported }: { readonly onImported?: () => void }): JSX.Element {
  const { t, lang } = useI18n();
  const { candidates } = useNekoBoxDetect();
  const [open, setOpen] = useState(false);
  const best = candidates[0];
  const found = best === undefined ? null : foundText(best, lang);
  return (
    <>
      <button
        type="button"
        className="onb-src onb-src-btn"
        title={found ?? t('onb.neko.d')}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="layers" />
        <span>{t('onb.src.neko')}</span>
        {found !== null && <span className="badge badge-soft">{found}</span>}
      </button>
      {open && (
        <NekoBoxImportDialog
          {...(onImported === undefined ? {} : { onImported })}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
