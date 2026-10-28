/**
 * Экспорт настроек (Настройки → Резервная копия).
 *
 * T-13: файл — обычный JSON без шифрования и только с настройками программы
 * (серверов, подписок и правил в нём нет). Секреты — пароль локального прокси
 * и подобные ключи — в него не попадают: при восстановлении они остаются
 * прежними, пользователь вводит их заново. Настоящая зашифрованная копия
 * всех данных — эпик T-83.
 */

/** Ключи вида `*.pass`, `*.password`, `*.secret`, `*.token` считаются секретами. */
const SECRET_KEY = /(^|\.)(pass|password|secret|token)$/i;

export function isSecretSettingKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/** Копия настроек без секретных ключей; исходный объект не меняется. */
export function withoutSecrets<T>(values: Readonly<Record<string, T>>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!isSecretSettingKey(key)) out[key] = value;
  }
  return out;
}
