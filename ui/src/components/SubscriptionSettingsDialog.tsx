// SPDX-License-Identifier: GPL-3.0-only

// SubscriptionSettingsDialog.tsx — «Настройки подписки» (прототип dlgSubSet,
// FR-UI-263). Интервал автообновления и User-Agent — настройки самой подписки
// (Group.update_interval_min / user_agent, пишутся через UpdateGroup);
// «через туннель» и HWID в модели ядра общие для всех подписок (settings
// sub.use_proxy / sub.hwid_enabled), диалог пишет их туда же. Отправляется
// только изменённое: нетронутое поле не перезаписывается значением по умолчанию.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { create } from '@bufbuild/protobuf';
import { SettingValueSchema } from '../gen/lavray_pb';
import type { Group, SettingValue } from '../gen/lavray_pb';
import { CORE_UNAVAILABLE, friendlyCoreError, showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { DialogShell } from './dialogs';

const HOURS = [1, 3, 6, 12, 24] as const; // select#ssInterval прототипа
const DEFAULT_HOURS = 6;
/** Пресеты User-Agent (select#ssUa); '' — умолчание ядра (LAVRay/<версия>). */
const UA_PRESETS: Readonly<Record<string, string>> = {
  lavray: '',
  singbox: 'sing-box',
  clash: 'clash.meta',
  v2rayn: 'v2rayN/7.0',
};
const UA_MAX = 256; // как в ядре (group_service.go)

const uaKindOf = (ua: string): string => Object.entries(UA_PRESETS).find(([, v]) => v === ua)?.[0] ?? 'custom';
const nearestHours = (min: number): number =>
  min <= 0 ? DEFAULT_HOURS : HOURS.reduce((b, h) => (Math.abs(h * 60 - min) < Math.abs(b * 60 - min) ? h : b));
const flagOf = (v: SettingValue | undefined, fallback: boolean): boolean => {
  const c = v?.value;
  return c?.case === 'boolValue' ? c.value : fallback;
};
const boolValue = (on: boolean): SettingValue => create(SettingValueSchema, { value: { case: 'boolValue', value: on } });

interface Props {
  readonly group: Group;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function SubscriptionSettingsDialog({ group, onClose, onSaved }: Props): JSX.Element {
  const { t, plural } = useI18n();
  const core = useCore();
  const intervalRef = useRef<HTMLSelectElement | null>(null);
  const storedUa = group.userAgent ?? '';
  const [hours, setHours] = useState(nearestHours(group.updateIntervalMin ?? 0));
  const [uaKind, setUaKind] = useState(uaKindOf(storedUa));
  const [uaCustom, setUaCustom] = useState(uaKindOf(storedUa) === 'custom' ? storedUa : '');
  const [tunnel, setTunnel] = useState(true);
  const [hwid, setHwid] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [touched, setTouched] = useState<readonly string[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const touch = (key: string): void => {
    setTouched((s) => (s.includes(key) ? s : [...s, key]));
  };

  useEffect(() => {
    const ac = new AbortController();
    void (async (): Promise<void> => {
      try {
        const res = await core.settings.getSettings({ keys: ['sub.use_proxy', 'sub.hwid_enabled'] }, { signal: ac.signal });
        setTunnel(flagOf(res.values['sub.use_proxy'], true));
        setHwid(flagOf(res.values['sub.hwid_enabled'], false));
        setLoaded(true);
      } catch (e) {
        if (!ac.signal.aborted) setLoadErr(friendlyCoreError(e));
      }
    })();
    return (): void => {
      ac.abort();
    };
  }, [core]);

  const save = useCallback(async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      const ua = uaKind === 'custom' ? uaCustom.trim() : (UA_PRESETS[uaKind] ?? '');
      if (touched.includes('interval') || touched.includes('ua')) {
        await core.profiles.updateGroup({
          group: {
            ...group,
            ...(touched.includes('interval') ? { updateIntervalMin: hours * 60 } : {}),
            ...(touched.includes('ua') ? { userAgent: ua } : {}),
          },
        });
      }
      const values: Record<string, SettingValue> = {};
      if (touched.includes('tunnel')) values['sub.use_proxy'] = boolValue(tunnel);
      if (touched.includes('hwid')) values['sub.hwid_enabled'] = boolValue(hwid);
      if (Object.keys(values).length > 0) await core.settings.setSettings({ values });
      onSaved();
      onClose();
    } catch (e) {
      setErr(showCoreError(e, t));
    } finally {
      setBusy(false);
    }
  }, [core, group, touched, uaKind, uaCustom, hours, tunnel, hwid, onSaved, onClose, t]);

  const shownErr = err !== '' ? err : loadErr === CORE_UNAVAILABLE ? t(CORE_UNAVAILABLE) : loadErr;
  const switches = [
    { key: 'tunnel', id: 'ssTunnel', label: t('sub.set.tunnel'), on: tunnel, set: setTunnel },
    { key: 'hwid', id: 'ssHwid', label: t('sub.set.hwid'), on: hwid, set: setHwid },
  ] as const;

  return (
    <DialogShell
      titleId="ssTitle"
      title={t('sub.settings')}
      size="sm"
      onClose={onClose}
      autofocusRef={intervalRef}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <span className="flex1" />
          <button
            className="btn btn-pri"
            disabled={busy || (uaKind === 'custom' && uaCustom.trim() === '')}
            onClick={() => void save()}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shownErr !== '' && (
          <div className="banner banner-err" role="alert">
            <div className="bn-t">{shownErr}</div>
          </div>
        )}
        <div className="field">
          <label htmlFor="ssInterval">{t('sub.set.interval')}</label>
          <select
            className="select"
            id="ssInterval"
            ref={intervalRef}
            value={String(hours)}
            onChange={(e) => {
              setHours(Number(e.target.value));
              touch('interval');
            }}
          >
            {HOURS.map((h) => (
              <option key={h} value={String(h)}>
                {plural('pl.h', h)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ssUa">{t('sub.set.ua')}</label>
          <select
            className="select"
            id="ssUa"
            value={uaKind}
            onChange={(e) => {
              setUaKind(e.target.value);
              touch('ua');
            }}
          >
            <option value="lavray">{t('sub.set.uaDefault')}</option>
            <option value="singbox">sing-box</option>
            <option value="clash">Clash Meta</option>
            <option value="v2rayn">v2rayN</option>
            <option value="custom">{t('sub.set.uaCustom')}</option>
          </select>
        </div>
        {uaKind === 'custom' && (
          <div className="field">
            <label htmlFor="ssUaCustom">{t('sub.set.uaField')}</label>
            <input
              className="input"
              id="ssUaCustom"
              autoComplete="off"
              maxLength={UA_MAX}
              value={uaCustom}
              onChange={(e) => {
                setUaCustom(e.target.value);
                touch('ua');
              }}
            />
          </div>
        )}
        <p className="cap">{t('sub.set.global')}</p>
        {switches.map((s) => (
          <div key={s.key}>
            <div className="set-row" style={{ borderTop: 'none', padding: 0 }}>
              <div className="set-txt">
                <span className="set-l" id={`${s.id}L`}>
                  {s.label}
                </span>
              </div>
              <button
                className={`sw${s.on ? ' on' : ''}`}
                role="switch"
                id={s.id}
                aria-checked={s.on}
                aria-labelledby={`${s.id}L`}
                disabled={!loaded}
                onClick={() => {
                  s.set(!s.on);
                  touch(s.key);
                }}
              />
            </div>
            {s.key === 'hwid' && (
              <p className="hint" style={{ fontSize: '.75rem', color: 'var(--t3)' }}>
                {t('sub.hwid.hint')}
              </p>
            )}
          </div>
        ))}
      </div>
    </DialogShell>
  );
}
