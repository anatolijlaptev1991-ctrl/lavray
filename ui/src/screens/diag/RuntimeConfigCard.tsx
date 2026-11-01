// SPDX-License-Identifier: GPL-3.0-only

// RuntimeConfigCard.tsx — «Показать текущий конфиг (без секретов)» в диагностике
// (GetRuntimeConfig): конфиг sing-box текущего или последнего запуска. Секреты
// (пароли, ключи, UUID) ядро маскирует само до отправки; интерфейс ничего не
// достраивает. Конфиг показывается только по кнопке и не хранится в состоянии,
// пока его скрыли.
import { useState } from 'react';
import type { JSX } from 'react';
import { Icon } from '../../components/Icon';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { showCoreError } from '../../lib/core';

export function RuntimeConfigCard(): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const [json, setJson] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const load = async (): Promise<void> => {
    setErr('');
    setCopied(false);
    setBusy(true);
    try {
      setJson((await core.core.getRuntimeConfig({})).singBoxJson);
    } catch (e) {
      setErr(showCoreError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(json ?? '');
      setCopied(true);
    } catch (e) {
      setErr(showCoreError(e, t));
    }
  };

  return (
    <div className="card" id="runtimeCfgCard">
      <div className="card-h">
        <span className="ic"><Icon name="file" /></span>
        <h2>{t('diag.cfg.title')}</h2>
        <span className="flex1" />
        {json === null ? (
          <button className="btn btn-sec btn-sm" disabled={busy} aria-busy={busy} onClick={() => void load()}>
            <span>{t('diag.cfg.btn')}</span>
          </button>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => void copy()}>
              <Icon name="copy" />
              <span>{copied ? t('diag.cfg.copied') : t('diag.cfg.copy')}</span>
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setJson(null);
              }}
            >
              {t('diag.cfg.hide')}
            </button>
          </>
        )}
      </div>
      {json !== null && (
        <>
          <p className="cap">{t('diag.cfg.hint')}</p>
          {json.trim() === '' ? (
            <p className="t2">{t('diag.cfg.none')}</p>
          ) : (
            <pre className="mono" tabIndex={0} aria-label={t('diag.cfg.title')} style={{ maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {json}
            </pre>
          )}
        </>
      )}
      {err !== '' && (
        <p className="toast-err" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
