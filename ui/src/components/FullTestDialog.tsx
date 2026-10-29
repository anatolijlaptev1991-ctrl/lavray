// SPDX-License-Identifier: GPL-3.0-only

// FullTestDialog.tsx — опции полного теста серверов (T-84, FR-UI-202): какие
// проверки выполнить на каждом сервере. Запуск возможен при хотя бы одной
// отмеченной проверке — ядро иначе отвечает INVALID_ARGUMENT.
import { useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import type { MessageKey } from '../lib/i18n';
import { DEFAULT_FULL_TEST_OPTIONS } from '../lib/testRequest';
import type { FullTestOptions } from '../lib/testRequest';
import { DialogShell } from './dialogs';

interface OptionRow {
  readonly key: keyof FullTestOptions;
  readonly labelKey: MessageKey;
  readonly noteKey?: MessageKey;
}

const ROWS: readonly OptionRow[] = [
  { key: 'latency', labelKey: 'test.latency' },
  { key: 'udp', labelKey: 'test.opt.udp' },
  { key: 'speed', labelKey: 'test.opt.speed', noteKey: 'test.opt.speedNote' },
  { key: 'inOut', labelKey: 'test.opt.inOut' },
];

interface Props {
  readonly onStart: (options: FullTestOptions) => void;
  readonly onClose: () => void;
}

export function FullTestDialog({ onStart, onClose }: Props): JSX.Element {
  const { t } = useI18n();
  const [options, setOptions] = useState<FullTestOptions>(DEFAULT_FULL_TEST_OPTIONS);
  const anySelected = options.latency || options.udp || options.speed || options.inOut;

  return (
    <DialogShell
      titleId="fullTestTitle"
      title={t('test.full')}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <span className="flex1" />
          <button
            className="btn btn-pri"
            disabled={!anySelected}
            aria-describedby={anySelected ? undefined : 'fullTestNone'}
            onClick={() => {
              onStart(options);
            }}
          >
            {t('test.opt.start')}
          </button>
        </>
      }
    >
      <p style={{ fontSize: '.8125rem', marginBottom: 10 }}>{t('test.opt.hint')}</p>
      <div className="test-opts" role="group" aria-label={t('test.full')}>
        {ROWS.map((row) => (
          <label className="test-opt" key={row.key}>
            <input
              type="checkbox"
              checked={options[row.key]}
              onChange={(e) => {
                const on = e.target.checked;
                setOptions((prev) => ({ ...prev, [row.key]: on }));
              }}
            />
            <span className="test-opt-t">
              {t(row.labelKey)}
              {row.noteKey !== undefined && <small>{t(row.noteKey)}</small>}
            </span>
          </label>
        ))}
      </div>
      {!anySelected && (
        <p id="fullTestNone" className="test-opt-none" role="alert">
          {t('test.opt.none')}
        </p>
      )}
    </DialogShell>
  );
}
