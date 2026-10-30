// SPDX-License-Identifier: GPL-3.0-only

// profile_editor.tsx — редактор профиля (FR-UI-080…101):
// создание/правка сервера, типоспецифичные поля по типу, транспорт и TLS
// (ws/grpc/http/h2, REALITY), цепочка, «Свой JSON», название/заметки.
// Реализованы все внутренние типы; Naive/внешние ядра скрыты флагом ядра.
// Состояние формы и преобразования — profile-editor/form.ts, поля — profile-editor/*.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ProfileType } from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { friendlyCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { Icon } from '../components/Icon';
import { DialogShell } from './dialogs';
import { CustomJsonFields } from './profile-editor/CustomJsonFields';
import { customFromProfile, firstInvalidCustom, withCustom } from './profile-editor/customJson';
import type { CustomJson } from './profile-editor/customJson';
import { TextAreaField, TextField } from './profile-editor/fields';
import { emptyForm, fromProfile, isSpecialType, toProfile, validateForm } from './profile-editor/form';
import type { Form, FormErrors } from './profile-editor/form';
import { persistProfile } from './profile-editor/saveProfile';
import { TypeFields } from './profile-editor/TypeFields';
import type { SetField } from './profile-editor/TypeFields';
import { TypePicker } from './profile-editor/TypePicker';
import { typeDisplayName } from './profile-editor/typeGroups';

interface Props {
  readonly profile: Profile | null; // null = создание
  readonly groupId: bigint;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

/** Ошибка поля → id элемента, на который уходит фокус при неудачной проверке. */
const ERROR_FOCUS: readonly (readonly [keyof FormErrors, string])[] = [
  ['name', 'edRemark'],
  ['address', 'edAddr'],
  ['port', 'edPort'],
  ['chain', 'edChainAdd'],
  ['json', 'edf-json'],
];

function withoutError(errors: FormErrors, key: string): FormErrors {
  if (!(key in errors)) return errors;
  return Object.fromEntries(Object.entries(errors).filter(([k]) => k !== key));
}

function initialForm(profile: Profile | null): Form {
  return profile === null ? emptyForm(ProfileType.VMESS) : fromProfile(profile);
}

export function ProfileEditor({ profile, groupId, onClose, onSaved }: Props): JSX.Element {
  const { t, tf } = useI18n();
  const core = useCore();
  const [f, setF] = useState<Form>(() => initialForm(profile));
  const [custom, setCustom] = useState<CustomJson>(() => customFromProfile(profile));
  const [errors, setErrors] = useState<FormErrors>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setF(initialForm(profile));
    setCustom(customFromProfile(profile));
    setErrors({});
  }, [profile]);

  // Начальный фокус диалога — на поле названия (T-66, id=edRemark).
  const nameRef = useRef<HTMLInputElement | null>(null);

  const set: SetField = useCallback((key, value) => {
    setF((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => withoutError(prev, key));
  }, []);

  const save = useCallback(async (): Promise<void> => {
    setErr('');
    const problems = validateForm(f, t, tf);
    setErrors(problems);
    const bad = ERROR_FOCUS.find(([key]) => problems[key] !== undefined)?.[1] ?? firstInvalidCustom(custom);
    if (bad !== null) {
      document.getElementById(bad)?.focus();
      return;
    }
    setBusy(true);
    try {
      // T-08B: подтверждение custom-полей считает ядро; редактор шлёт только текст.
      await persistProfile(core, profile, withCustom(toProfile(f, profile?.id ?? 0n, groupId), custom));
      onSaved();
      onClose();
    } catch (e) {
      setErr(friendlyCoreError(e));
    } finally {
      setBusy(false);
    }
  }, [core, f, custom, profile, groupId, onSaved, onClose, t, tf]);

  const title = profile === null ? t('ed.titleNew') : t('ed.titleEdit');

  return (
    <DialogShell
      titleId="edTitle"
      title={title}
      size="lg"
      onClose={onClose}
      autofocusRef={nameRef}
      dismissOnBackdrop={false}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-pri" disabled={busy} onClick={() => void save()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      {err !== '' && (
        <div className="banner banner-err" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{err}</div>
        </div>
      )}
      <div className="ed-body">
        {/* Тип выбирается плитками только при создании; у существующего
            профиля он фиксирован (FR-UI-082). */}
        {profile === null ? (
          <div>
            <TypePicker
              value={f.type}
              t={t}
              onChange={(type) => {
                set('type', type);
                setErrors({});
              }}
            />
          </div>
        ) : (
          <div className="field">
            <span className="cap">{t('srv.type')}</span>
            <span>
              <span className="badge bt-type">{typeDisplayName(f.type, t)}</span>
            </span>
          </div>
        )}

        <div className="form-grid">
          <TextField
            id="edRemark"
            inputRef={nameRef}
            label={t('ed.remark')}
            required
            wide
            value={f.name}
            placeholder={t('ed.remarkPh')}
            error={errors.name}
            onChange={(v) => {
              set('name', v);
            }}
          />
          {!isSpecialType(f.type) && (
            <>
              <TextField
                id="edAddr"
                label={t('ed.address')}
                required
                mono
                value={f.address}
                placeholder="example.org"
                error={errors.address}
                onChange={(v) => {
                  set('address', v);
                }}
              />
              <TextField
                id="edPort"
                label={t('ed.port')}
                required
                mono
                numeric
                value={f.port}
                placeholder="443"
                error={errors.port}
                onChange={(v) => {
                  set('port', v);
                }}
              />
            </>
          )}
        </div>

        <TypeFields f={f} set={set} errors={errors} selfId={profile?.id ?? 0n} />
        <CustomJsonFields value={custom} onChange={setCustom} />

        <TextAreaField
          id="edNotes"
          label={t('ed.notes')}
          rows={2}
          mono={false}
          value={f.notes}
          onChange={(v) => {
            set('notes', v);
          }}
        />
      </div>
    </DialogShell>
  );
}
