// SPDX-License-Identifier: GPL-3.0-only

// secretWarning.ts — несёт ли ссылка профиля секрет. QR-код показывает ссылку
// целиком, и тот, кто его сфотографировал, получает доступ к серверу; диалог
// QR предупреждает об этом, пока ссылка содержит ключи.

/** Параметры запроса, в которых лежат ключи (регистр не важен). */
const SECRET_PARAMS: ReadonlySet<string> = new Set([
  'pbk', // публичный ключ Reality
  'psk',
  'password',
  'pass',
  'auth',
  'token',
  'secret',
  'key',
  'obfs-password',
  'private-key',
]);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** «схема://userinfo@»: запасной разбор, когда URL() не принимает ссылку. */
const USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/?#@]+@/i;

/** base64 / base64url без обязательных «=» → текст или null. */
function fromBase64(raw: string): string | null {
  const body = raw.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  try {
    const bin = atob(body.padEnd(Math.ceil(body.length / 4) * 4, '='));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** vmess://base64(JSON): секрет — поле id (UUID пользователя). */
function vmessJsonHasId(body: string): boolean {
  const json = fromBase64(body.split(/[?#]/, 1)[0] ?? '');
  if (json === null) return false;
  try {
    const parsed: unknown = JSON.parse(json);
    const id = typeof parsed === 'object' && parsed !== null ? (parsed as { id?: unknown }).id : undefined;
    return typeof id === 'string' && id !== '';
  } catch {
    return false;
  }
}

/** ss://base64(метод:пароль@хост:порт): без «@» в открытом виде секрет внутри base64. */
function ssBase64HasPassword(body: string): boolean {
  const plain = fromBase64(body.split(/[?#]/, 1)[0] ?? '');
  return plain?.includes(':') === true;
}

/** Ключи в параметрах запроса: pbk, psk, password, auth и им подобные. */
function queryHasSecret(query: string): boolean {
  for (const [name, value] of new URLSearchParams(query)) {
    if (value !== '' && SECRET_PARAMS.has(name.toLowerCase())) return true;
  }
  return false;
}

/** Есть ли в ссылке userinfo («логин:пароль@» или «uuid@»), по URL() либо по запасному разбору. */
function hasUserinfo(link: string): boolean {
  try {
    const u = new URL(link);
    if (u.username !== '' || u.password !== '') return true;
  } catch {
    /* ссылка в нестандартной форме: смотрим регулярным выражением ниже */
  }
  return USERINFO.test(link);
}

/**
 * Содержит ли ссылка секрет: userinfo (uuid, пароль, логин:пароль), UUID в
 * любом месте, ключевой параметр запроса, vmess с id в base64-JSON, ss с
 * паролем (открытым или в base64). Адрес без секретов (https://example.org/
 * или socks5://127.0.0.1:1080) — false.
 */
export function linkHasSecret(link: string): boolean {
  const text = link.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/is.exec(text);
  if (scheme === null) return false;
  const name = (scheme[1] ?? '').toLowerCase();
  const rest = scheme[2] ?? '';
  if (name === 'vmess' && vmessJsonHasId(rest)) return true;
  if (name === 'ss' && !rest.split(/[?#]/, 1)[0]?.includes('@') && ssBase64HasPassword(rest)) return true;
  if (hasUserinfo(text) || UUID.test(text)) return true;
  const q = text.indexOf('?');
  return q >= 0 && queryHasSecret(text.slice(q + 1).split('#', 1)[0] ?? '');
}
