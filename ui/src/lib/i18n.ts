/**
 * LAVRay i18n infrastructure (stage-3 scaffold).
 *
 * Mechanics mirror design/prototype.html (`I18N`, `t`, `tf`, `plural`,
 * `fmtBytes`, `LANG_NATIVE`, `LOCALES`); the full prototype dictionary is
 * migrated later (741 i18n_check keys in ru; 765 raw entries incl. plural
 * forms) — only the scaffold subset lives here. Translations are
 * copied verbatim from the prototype dictionaries.
 *
 * Rules (docs/DESIGN-SYSTEM.md §9, docs/I18N-GLOSSARY.md):
 * - the key set is identical across all five languages;
 * - units come from the dictionary (not Intl `style:'unit'`), with U+00A0
 *   between the number and the unit;
 * - numbers are formatted with Intl by locale.
 */

/** UI languages in the fixed prototype order (ru is the source language). */
export const LANGUAGES = ['ru', 'en', 'zh', 'es', 'de'] as const;

export type Language = (typeof LANGUAGES)[number];

/** Endonym for the language picker (DS §5: languages are named in themselves). */
export const LANG_NATIVE: Readonly<Record<Language, string>> = {
  ru: 'Русский',
  zh: '简体中文',
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
};

/** Full BCP-47 locale per UI language (prototype `LOCALES`). */
export const LOCALES: Readonly<Record<Language, string>> = {
  ru: 'ru-RU',
  zh: 'zh-CN',
  en: 'en-US',
  es: 'es-ES',
  de: 'de-DE',
};

/** U+00A0 — non-breaking space between a number and its unit (glossary §1.4). */
export const NB = '\u00A0';

/** Reference dictionary: `en` defines the canonical key set (prototype mechanics fall back to en). */
const en = {
  /* --- navigation (5 sections) --- */
  'nav.connection': 'Connection',
  'nav.servers': 'Servers',
  'nav.rules': 'Rules',
  'nav.diag': 'Diagnostics',
  'nav.settings': 'Settings',
  /* --- section tabs --- */
  'nav.subscriptions': 'Subscriptions',
  'nav.routing': 'Routing',
  'nav.log': 'Log',
  'nav.updates': 'Updates',
  'tab.servers': 'Servers',
  'tab.checks': 'Checks',
  'tab.conns': 'Connections',
  'tab.params': 'Preferences',
  /* --- screen subtitles --- */
  'scr.connection.sub': 'Connection state and quality',
  'scr.profiles.sub': 'Your servers: search, tests and groups',
  'scr.subs.sub': 'Provider subscriptions and updates',
  'scr.routing.sub': 'Presets, rules and route check',
  'scr.dns.sub': 'Name resolution',
  'scr.checks.sub': 'Why it doesn’t work and whether anything leaks',
  'scr.conns.sub': 'Where your traffic goes right now',
  'scr.log.sub': 'Core event stream',
  'scr.settings.sub': 'App preferences',
  'scr.updates.sub': 'App, core and preset versions',
  /* --- connection --- */
  'conn.connect': 'Connect',
  'conn.disconnect': 'Disconnect',
  /* --- appearance --- */
  'set.lang': 'Interface language',
  'set.theme': 'Theme',
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'theme.system': 'Match system',
  'set.accent': 'Accent',
  'accent.auto': 'Match theme',
  'accent.amber': 'Amber',
  'accent.sage': 'Sage',
  'accent.graphite': 'Graphite',
  /* --- aria / a11y --- */
  'aria.lang': 'Language',
  'aria.nav': 'Sections',
  'a11y.skip': 'Skip to content',
  /* --- common --- */
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  /* --- toasts --- */
  'toast.connected': 'Connected · {name}',
  'toast.disconnected': 'Disconnected',
  /* --- units (dictionary, not Intl style:'unit' — DS §9) --- */
  'unit.ms': 'ms',
  'u.b': 'B/s',
  'u.kb': 'KB/s',
  'u.mb': 'MB/s',
  'u.gb': 'GB/s',
  'ub.b': 'B',
  'ub.kb': 'KB',
  'ub.mb': 'MB',
  'ub.gb': 'GB',
} as const;

export type MessageKey = keyof typeof en;

/** A per-language dictionary must cover the full canonical key set. */
export type Dictionary = Readonly<Record<MessageKey, string>>;

const ru: Dictionary = {
  'nav.connection': 'Подключение',
  'nav.servers': 'Серверы',
  'nav.rules': 'Правила',
  'nav.diag': 'Диагностика',
  'nav.settings': 'Настройки',
  'nav.subscriptions': 'Подписки',
  'nav.routing': 'Маршрутизация',
  'nav.log': 'Журнал',
  'nav.updates': 'Обновления',
  'tab.servers': 'Серверы',
  'tab.checks': 'Проверки',
  'tab.conns': 'Соединения',
  'tab.params': 'Параметры',
  'scr.connection.sub': 'Состояние подключения и качество связи',
  'scr.profiles.sub': 'Ваши серверы: поиск, проверка и группы',
  'scr.subs.sub': 'Подписки провайдеров и их обновление',
  'scr.routing.sub': 'Пресеты, правила и проверка маршрута',
  'scr.dns.sub': 'Разрешение имён',
  'scr.checks.sub': 'Почему не работает и нет ли утечек',
  'scr.conns.sub': 'Куда сейчас идёт трафик',
  'scr.log.sub': 'Поток событий ядра',
  'scr.settings.sub': 'Параметры приложения',
  'scr.updates.sub': 'Версии приложения, ядра и пресетов',
  'conn.connect': 'Подключиться',
  'conn.disconnect': 'Отключить',
  'set.lang': 'Язык интерфейса',
  'set.theme': 'Тема',
  'theme.dark': 'Тёмная',
  'theme.light': 'Светлая',
  'theme.system': 'Как в системе',
  'set.accent': 'Акцент',
  'accent.auto': 'Как тема',
  'accent.amber': 'Янтарь',
  'accent.sage': 'Шалфей',
  'accent.graphite': 'Графит',
  'aria.lang': 'Язык',
  'aria.nav': 'Разделы',
  'a11y.skip': 'Перейти к содержимому',
  'common.close': 'Закрыть',
  'common.cancel': 'Отмена',
  'toast.connected': 'Подключено · {name}',
  'toast.disconnected': 'Отключено',
  'unit.ms': 'мс',
  'u.b': 'Б/с',
  'u.kb': 'КБ/с',
  'u.mb': 'МБ/с',
  'u.gb': 'ГБ/с',
  'ub.b': 'Б',
  'ub.kb': 'КБ',
  'ub.mb': 'МБ',
  'ub.gb': 'ГБ',
};

const zh: Dictionary = {
  'nav.connection': '连接',
  'nav.servers': '服务器',
  'nav.rules': '规则',
  'nav.diag': '诊断',
  'nav.settings': '设置',
  'nav.subscriptions': '订阅',
  'nav.routing': '路由',
  'nav.log': '日志',
  'nav.updates': '更新',
  'tab.servers': '服务器',
  'tab.checks': '检查',
  'tab.conns': '连接',
  'tab.params': '参数',
  'scr.connection.sub': '连接状态与连接质量',
  'scr.profiles.sub': '你的服务器：搜索、测试与分组',
  'scr.subs.sub': '服务商订阅与更新',
  'scr.routing.sub': '预设、规则与路由检查',
  'scr.dns.sub': '域名解析',
  'scr.checks.sub': '排查故障与泄露',
  'scr.conns.sub': '流量当前去向',
  'scr.log.sub': '内核事件流',
  'scr.settings.sub': '应用设置',
  'scr.updates.sub': '应用、内核与预设版本',
  'conn.connect': '连接',
  'conn.disconnect': '断开',
  'set.lang': '界面语言',
  'set.theme': '主题',
  'theme.dark': '深色',
  'theme.light': '浅色',
  'theme.system': '跟随系统',
  'set.accent': '主题色',
  'accent.auto': '跟随主题',
  'accent.amber': '琥珀',
  'accent.sage': '鼠尾草绿',
  'accent.graphite': '石墨',
  'aria.lang': '语言',
  'aria.nav': '分区',
  'a11y.skip': '跳到内容',
  'common.close': '关闭',
  'common.cancel': '取消',
  'toast.connected': '已连接 · {name}',
  'toast.disconnected': '已断开',
  'unit.ms': 'ms',
  'u.b': 'B/秒',
  'u.kb': 'KB/秒',
  'u.mb': 'MB/秒',
  'u.gb': 'GB/秒',
  'ub.b': 'B',
  'ub.kb': 'KB',
  'ub.mb': 'MB',
  'ub.gb': 'GB',
};

const es: Dictionary = {
  'nav.connection': 'Conexión',
  'nav.servers': 'Servidores',
  'nav.rules': 'Reglas',
  'nav.diag': 'Diagnóstico',
  'nav.settings': 'Ajustes',
  'nav.subscriptions': 'Suscripciones',
  'nav.routing': 'Enrutamiento',
  'nav.log': 'Registro',
  'nav.updates': 'Actualizaciones',
  'tab.servers': 'Servidores',
  'tab.checks': 'Comprobaciones',
  'tab.conns': 'Conexiones',
  'tab.params': 'Parámetros',
  'scr.connection.sub': 'Estado y calidad de la conexión',
  'scr.profiles.sub': 'Tus servidores: búsqueda, pruebas y grupos',
  'scr.subs.sub': 'Suscripciones de proveedores y su actualización',
  'scr.routing.sub': 'Presets, reglas y comprobación de ruta',
  'scr.dns.sub': 'Resolución de nombres',
  'scr.checks.sub': 'Por qué no funciona y si hay fugas',
  'scr.conns.sub': 'A dónde va tu tráfico ahora',
  'scr.log.sub': 'Flujo de eventos del núcleo',
  'scr.settings.sub': 'Ajustes de la app',
  'scr.updates.sub': 'Versiones de app, núcleo y presets',
  'conn.connect': 'Conectar',
  'conn.disconnect': 'Desconectar',
  'set.lang': 'Idioma de la interfaz',
  'set.theme': 'Tema',
  'theme.dark': 'Oscuro',
  'theme.light': 'Claro',
  'theme.system': 'Del sistema',
  'set.accent': 'Acento',
  'accent.auto': 'Según el tema',
  'accent.amber': 'Ámbar',
  'accent.sage': 'Salvia',
  'accent.graphite': 'Grafito',
  'aria.lang': 'Idioma',
  'aria.nav': 'Secciones',
  'a11y.skip': 'Saltar al contenido',
  'common.close': 'Cerrar',
  'common.cancel': 'Cancelar',
  'toast.connected': 'Conectado · {name}',
  'toast.disconnected': 'Desconectado',
  'unit.ms': 'ms',
  'u.b': 'B/s',
  'u.kb': 'KB/s',
  'u.mb': 'MB/s',
  'u.gb': 'GB/s',
  'ub.b': 'B',
  'ub.kb': 'KB',
  'ub.mb': 'MB',
  'ub.gb': 'GB',
};

const de: Dictionary = {
  'nav.connection': 'Verbindung',
  'nav.servers': 'Server',
  'nav.rules': 'Regeln',
  'nav.diag': 'Diagnose',
  'nav.settings': 'Einstellungen',
  'nav.subscriptions': 'Abos',
  'nav.routing': 'Routing',
  'nav.log': 'Protokoll',
  'nav.updates': 'Updates',
  'tab.servers': 'Server',
  'tab.checks': 'Prüfungen',
  'tab.conns': 'Verbindungen',
  'tab.params': 'Einstellungen',
  'scr.connection.sub': 'Verbindungsstatus und -qualität',
  'scr.profiles.sub': 'Deine Server: Suche, Tests und Gruppen',
  'scr.subs.sub': 'Anbieter-Abos und ihre Aktualisierung',
  'scr.routing.sub': 'Presets, Regeln und Routenprüfung',
  'scr.dns.sub': 'Namensauflösung',
  'scr.checks.sub': 'Warum es nicht geht und ob etwas leckt',
  'scr.conns.sub': 'Wohin dein Datenverkehr gerade läuft',
  'scr.log.sub': 'Ereignisstrom des Cores',
  'scr.settings.sub': 'App-Einstellungen',
  'scr.updates.sub': 'Versionen von App, Core und Presets',
  'conn.connect': 'Verbinden',
  'conn.disconnect': 'Trennen',
  'set.lang': 'Sprache der Oberfläche',
  'set.theme': 'Design',
  'theme.dark': 'Dunkel',
  'theme.light': 'Hell',
  'theme.system': 'Wie im System',
  'set.accent': 'Akzent',
  'accent.auto': 'Wie Design',
  'accent.amber': 'Bernstein',
  'accent.sage': 'Salbei',
  'accent.graphite': 'Grafit',
  'aria.lang': 'Sprache',
  'aria.nav': 'Bereiche',
  'a11y.skip': 'Zum Inhalt springen',
  'common.close': 'Schließen',
  'common.cancel': 'Abbrechen',
  'toast.connected': 'Verbunden · {name}',
  'toast.disconnected': 'Getrennt',
  'unit.ms': 'ms',
  'u.b': 'B/s',
  'u.kb': 'KB/s',
  'u.mb': 'MB/s',
  'u.gb': 'GB/s',
  'ub.b': 'B',
  'ub.kb': 'KB',
  'ub.mb': 'MB',
  'ub.gb': 'GB',
};

/** All dictionaries. `en` (the reference) is also the runtime fallback. */
export const DICTIONARIES: Readonly<Record<Language, Dictionary>> = { ru, en, zh, es, de };

/** Current language (module state; React subscribes via `onLanguageChange`). */
let current: Language = 'en';

const listeners = new Set<() => void>();

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Pick the initial language from the environment (navigator.language), `en` fallback. */
export function detectLanguage(nav: readonly string[]): Language {
  for (const tag of nav) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

export function getLanguage(): Language {
  return current;
}

/** Switch the language and notify subscribers (DS §9: no reload). */
export function setLanguage(lang: Language): void {
  if (!isLanguage(lang) || lang === current) return;
  current = lang;
  for (const fn of listeners) fn();
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLanguageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Active BCP-47 locale (for Intl). */
export function locale(lang: Language = current): string {
  return LOCALES[lang];
}

/** Translate a key in the current language; falls back to `en`, then to the key (prototype `t`). */
export function t(key: MessageKey, lang: Language = current): string {
  const dict = DICTIONARIES[lang];
  return dict[key] || DICTIONARIES.en[key] || key;
}

/** Translate with `{placeholder}` interpolation (prototype `tf`). */
export function tf(key: MessageKey, params: Readonly<Record<string, string | number>>, lang: Language = current): string {
  let s = t(key, lang);
  for (const [name, value] of Object.entries(params)) {
    s = s.split(`{${name}}`).join(String(value));
  }
  return s;
}

function numberFormat(lang: Language, maximumFractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits });
}

function formatNum(n: number, lang: Language, maximumFractionDigits: number): string {
  return numberFormat(lang, maximumFractionDigits).format(n);
}

const BYTE_UNITS: readonly (readonly [MessageKey, number])[] = [
  ['ub.gb', 1e9],
  ['ub.mb', 1e6],
  ['ub.kb', 1e3],
];

const SPEED_UNITS: readonly (readonly [MessageKey, number])[] = [
  ['u.gb', 1e9],
  ['u.mb', 1e6],
  ['u.kb', 1e3],
];

/** Volume in bytes → "1,2 МБ" (unit from the dictionary, NBSP, DS §9). Prototype `fmtBytes`. */
export function formatBytes(bytes: number, lang: Language = current): string {
  for (const [key, scale] of BYTE_UNITS) {
    if (bytes >= scale) return formatNum(bytes / scale, lang, 1) + NB + t(key, lang);
  }
  return formatNum(bytes, lang, 0) + NB + t('ub.b', lang);
}

/** Speed in bytes/s → "1,2 МБ/с". Prototype `fmtSpeed`. */
export function formatSpeed(bytesPerSec: number, lang: Language = current): string {
  if (!(bytesPerSec >= 1)) return formatNum(0, lang, 0) + NB + t('u.b', lang);
  for (const [key, scale] of SPEED_UNITS) {
    if (bytesPerSec >= scale) return formatNum(bytesPerSec / scale, lang, 1) + NB + t(key, lang);
  }
  return formatNum(bytesPerSec, lang, 0) + NB + t('u.b', lang);
}

/** Latency in ms → "43 мс". Prototype `fmtMs`. */
export function formatMs(ms: number | null, lang: Language = current): string {
  return ms === null ? '—' : formatNum(ms, lang, 0) + NB + t('unit.ms', lang);
}

/**
 * Duration in ms → clock form "h:mm:ss" / "m:ss" (prototype `connDur`),
 * with digits produced by Intl.NumberFormat for the active locale
 * (locale digit shaping applies).
 */
export function formatDuration(ms: number, lang: Language = current): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const two = new Intl.NumberFormat(locale(lang), { minimumIntegerDigits: 2, useGrouping: false });
  const mm = two.format(m);
  const ss = two.format(s);
  return h > 0 ? `${new Intl.NumberFormat(locale(lang)).format(h)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Set `document.documentElement.lang` (zh → zh-CN), mirroring the prototype. */
export function applyDocumentLanguage(doc: Document, lang: Language = current): void {
  doc.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
}
