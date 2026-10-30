// SPDX-License-Identifier: GPL-3.0-only

// CustomJsonFields.tsx — «Custom outbound JSON» и «Custom config JSON» (FR-UI-084/085)
// для профиля ЛЮБОГО типа. Проверка идёт по мере ввода (checkJsonObject): ошибка с
// строкой и столбцом показывается у поля, а сохранение с ошибкой блокирует редактор.
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { checkJsonObject } from '../../lib/jsonText';
import { CUSTOM_CONFIG_ID, CUSTOM_OUTBOUND_ID, customErrorText } from './customJson';
import type { CustomJson } from './customJson';
import { TextAreaField } from './fields';

interface Props {
  readonly value: CustomJson;
  readonly onChange: (next: CustomJson) => void;
}

/** Тексты ошибок обоих полей; пересчитываются только при правке. */
function useCustomErrors(value: CustomJson): { outbound?: string | undefined; config?: string | undefined } {
  const { t, tf } = useI18n();
  return useMemo(
    () => ({
      outbound: customErrorText(checkJsonObject(value.outbound), t, tf),
      config: customErrorText(checkJsonObject(value.config), t, tf),
    }),
    [value, t, tf],
  );
}

export function CustomJsonFields({ value, onChange }: Props): JSX.Element {
  const { t } = useI18n();
  const errors = useCustomErrors(value);
  // Блок свёрнут, пока пуст; ошибка раскрывает его, чтобы фокус при сохранении не ушёл в скрытое.
  const [open, setOpen] = useState(value.outbound !== '' || value.config !== '');
  const shown = open || errors.outbound !== undefined || errors.config !== undefined;
  return (
    <details
      className="fold"
      open={shown}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
      }}
    >
      <summary>
        <span className="cap">{t('cf.section')}</span>
      </summary>
      <div className="fold-b">
        <p className="hint">{t('cf.sectionNote')}</p>
        <div className="form-grid">
          <TextAreaField
            id={CUSTOM_OUTBOUND_ID}
            label={t('cf.outbound')}
            hint={t('cf.outboundHint')}
            rows={5}
            wide
            value={value.outbound}
            error={errors.outbound}
            onChange={(outbound) => {
              onChange({ ...value, outbound });
            }}
          />
          <TextAreaField
            id={CUSTOM_CONFIG_ID}
            label={t('cf.config')}
            hint={t('cf.configHint')}
            rows={5}
            wide
            value={value.config}
            error={errors.config}
            onChange={(config) => {
              onChange({ ...value, config });
            }}
          />
        </div>
      </div>
    </details>
  );
}
