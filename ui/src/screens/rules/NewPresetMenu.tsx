// SPDX-License-Identifier: GPL-3.0-only

// NewPresetMenu.tsx — кнопка «Новый пресет» (прототип #rtNew) и её меню:
// сохранить активный набор копией, создать пустой, импортировать из файла.
import { useState } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '../../components/ContextMenu';
import type { MenuAnchor } from '../../components/ContextMenu';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';

export interface NewPresetMenuProps {
  /** Есть активный набор, который можно сохранить копией. */
  readonly canSaveAs: boolean;
  readonly onSaveAs: () => void;
  readonly onCreateEmpty: () => void;
  readonly onImport: () => void;
}

export function NewPresetMenu({ canSaveAs, onSaveAs, onCreateEmpty, onImport }: NewPresetMenuProps): JSX.Element {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const pick = (action: () => void) => (): void => {
    setAnchor(null);
    action();
  };
  return (
    <>
      <button
        className="btn btn-sec btn-sm"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(e) => {
          if (anchor !== null) {
            setAnchor(null);
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ at: { x: r.left - 120, y: r.bottom + 4 }, trigger: e.currentTarget });
        }}
      >
        <Icon name="plus" />
        <span>{t('rt.new')}</span>
      </button>
      {anchor !== null &&
        createPortal(
          <ContextMenu anchor={anchor} onClose={() => { setAnchor(null); }}>
            <button className="menu-item" role="menuitem" disabled={!canSaveAs} onClick={pick(onSaveAs)}>
              <Icon name="copy" size={16} />
              <span>{t('rt.saveAs')}</span>
            </button>
            <button className="menu-item" role="menuitem" onClick={pick(onCreateEmpty)}>
              <Icon name="plus" size={16} />
              <span>{t('rt.newEmpty')}</span>
            </button>
            <button className="menu-item" role="menuitem" onClick={pick(onImport)}>
              <Icon name="upload" size={16} />
              <span>{t('rt.importPreset')}</span>
            </button>
          </ContextMenu>,
          document.body,
        )}
    </>
  );
}
