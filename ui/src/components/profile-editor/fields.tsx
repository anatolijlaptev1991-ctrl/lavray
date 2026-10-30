// SPDX-License-Identifier: GPL-3.0-only

// fields.tsx — поля формы редактора профиля (разметка .field из прототипа:
// <label for> + контрол + .field-err; ошибка помечает поле aria-invalid).
import type { JSX, Ref } from 'react';

interface BaseProps {
  readonly id: string;
  readonly label: string;
  /** Текст ошибки: показывается под полем, поле получает aria-invalid. */
  readonly error?: string | undefined;
  /** Поле на всю ширину сетки (.span2). */
  readonly wide?: boolean;
  readonly required?: boolean;
}

function fieldClass(props: BaseProps): string {
  return `field${props.wide === true ? ' span2' : ''}${props.error === undefined ? '' : ' invalid'}`;
}

interface TextFieldProps extends BaseProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly mono?: boolean;
  readonly password?: boolean;
  /** Только цифры. */
  readonly numeric?: boolean;
  readonly placeholder?: string | undefined;
  /** Ссылка на поле: диалог ставит на него фокус при открытии (T-40/T-66). */
  readonly inputRef?: Ref<HTMLInputElement>;
}

export function TextField(props: TextFieldProps): JSX.Element {
  const { id, label, value, onChange, mono = false, password = false, numeric = false } = props;
  return (
    <div className={fieldClass(props)}>
      <label htmlFor={id} className={props.required === true ? 'req' : undefined}>
        {label}
      </label>
      <input
        ref={props.inputRef}
        className={`input${mono ? ' input-mono' : ''}`}
        id={id}
        type={password ? 'password' : 'text'}
        inputMode={numeric ? 'numeric' : undefined}
        value={value}
        placeholder={props.placeholder}
        autoComplete={password ? 'new-password' : 'off'}
        spellCheck={false}
        aria-invalid={props.error === undefined ? undefined : true}
        onChange={(e) => {
          onChange(numeric ? e.target.value.replace(/\D/g, '') : e.target.value);
        }}
      />
      {props.error !== undefined && <span className="field-err" role="alert">{props.error}</span>}
    </div>
  );
}

export interface Option<T extends string | number = string> {
  readonly value: T;
  readonly label: string;
}

interface SelectFieldProps<T extends string | number> extends BaseProps {
  readonly value: T;
  readonly options: readonly Option<T>[];
  readonly onChange: (value: T) => void;
}

/** Значения options — строки или числа (enum контракта); в DOM они строки. */
export function SelectField<T extends string | number>(props: SelectFieldProps<T>): JSX.Element {
  const { id, label, value, options, onChange } = props;
  return (
    <div className={fieldClass(props)}>
      <label htmlFor={id}>{label}</label>
      <select
        className="select"
        id={id}
        value={String(value)}
        onChange={(e) => {
          const chosen = options.find((o) => String(o.value) === e.target.value);
          if (chosen !== undefined) onChange(chosen.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface TextAreaFieldProps extends BaseProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly rows?: number;
  /** Моноширинный шрифт (сертификат, JSON); для заметок выключен. */
  readonly mono?: boolean;
  /** Пояснение под полем; связано с ним через aria-describedby. */
  readonly hint?: string;
}

export function TextAreaField(props: TextAreaFieldProps): JSX.Element {
  const { id, label, value, onChange, rows = 3, mono = true, hint } = props;
  return (
    <div className={fieldClass(props)}>
      <label htmlFor={id}>{label}</label>
      <textarea
        className={`textarea${mono ? ' mono' : ''}`}
        id={id}
        rows={rows}
        value={value}
        spellCheck={false}
        aria-invalid={props.error === undefined ? undefined : true}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      {hint !== undefined && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {props.error !== undefined && <span className="field-err" role="alert">{props.error}</span>}
    </div>
  );
}

interface SwitchFieldProps extends BaseProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly hint?: string | undefined;
}

/** Переключатель (.sw, role=switch); подпись — <label for>, клик по ней тоже переключает. */
export function SwitchField(props: SwitchFieldProps): JSX.Element {
  const { id, label, checked, onChange, hint } = props;
  return (
    <div className={fieldClass(props)}>
      <label htmlFor={id}>{label}</label>
      <button
        type="button"
        className="sw"
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => {
          onChange(!checked);
        }}
      />
      {hint !== undefined && <span className="hint">{hint}</span>}
    </div>
  );
}
