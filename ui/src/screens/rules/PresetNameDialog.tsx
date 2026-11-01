// SPDX-License-Identifier: GPL-3.0-only

// PresetNameDialog.tsx — название набора: «Сохранить как пресет», «Создать
// пустой», «Переименовать». Пустое название не принимается (подсказка под
// полем), длина — до 64 символов (как в ядре).
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { DialogShell } from '../../components/dialogs';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey } from '../../lib/i18n';
import { MAX_NAME_LENGTH } from '../../lib/presetDraft';

export interface PresetNameDialogProps {
  readonly titleKey: MessageKey;
  readonly initial: string;
  readonly confirmKey: MessageKey;
  readonly onSubmit: (name: string) => void;
  readonly onClose: () => void;
}

export function PresetNameDialog({ titleKey, initial, confirmKey, onSubmit, onClose }: PresetNameDialogProps): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setInvalid(true);
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <DialogShell
      titleId="rtNameTitle"
      title={t(titleKey)}
      size="sm"
      onClose={onClose}
      autofocusRef={inputRef}
      footer={
        <>
          <span className="flex1" />
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-pri" onClick={submit}>{t(confirmKey)}</button>
        </>
      }
    >
      <div className={`field${invalid ? ' invalid' : ''}`}>
        <label htmlFor="rtName">{t('rt.presetName')}</label>
        <input
          className="input"
          id="rtName"
          ref={inputRef}
          autoComplete="off"
          maxLength={MAX_NAME_LENGTH}
          value={name}
          aria-invalid={invalid}
          onChange={(e) => { setName(e.target.value); setInvalid(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <span className="field-err" role="alert">{t('rt.nameEmpty')}</span>
      </div>
    </DialogShell>
  );
}
