// SPDX-License-Identifier: GPL-3.0-only

// geo.ts — страны в UI: ISO-код → эмодзи-флаг и локализованное название.
// Источник кодов — ядро (Profile.geo, FR-UI-008); здесь только отображение.
import { locale, t, type Language } from './i18n';

const NAMES: Record<string, Record<'ru' | 'en', string>> = {
  ru: { ru: 'Россия', en: 'Russia' },
  de: { ru: 'Германия', en: 'Germany' },
  nl: { ru: 'Нидерланды', en: 'Netherlands' },
  us: { ru: 'США', en: 'United States' },
  gb: { ru: 'Великобритания', en: 'United Kingdom' },
  fr: { ru: 'Франция', en: 'France' },
  fi: { ru: 'Финляндия', en: 'Finland' },
  se: { ru: 'Швеция', en: 'Sweden' },
  no: { ru: 'Норвегия', en: 'Norway' },
  dk: { ru: 'Дания', en: 'Denmark' },
  pl: { ru: 'Польша', en: 'Poland' },
  cz: { ru: 'Чехия', en: 'Czechia' },
  at: { ru: 'Австрия', en: 'Austria' },
  ch: { ru: 'Швейцария', en: 'Switzerland' },
  it: { ru: 'Италия', en: 'Italy' },
  es: { ru: 'Испания', en: 'Spain' },
  pt: { ru: 'Португалия', en: 'Portugal' },
  ie: { ru: 'Ирландия', en: 'Ireland' },
  be: { ru: 'Бельгия', en: 'Belgium' },
  lu: { ru: 'Люксембург', en: 'Luxembourg' },
  ee: { ru: 'Эстония', en: 'Estonia' },
  lv: { ru: 'Латвия', en: 'Latvia' },
  lt: { ru: 'Литва', en: 'Lithuania' },
  md: { ru: 'Молдова', en: 'Moldova' },
  ua: { ru: 'Украина', en: 'Ukraine' },
  by: { ru: 'Беларусь', en: 'Belarus' },
  kz: { ru: 'Казахстан', en: 'Kazakhstan' },
  am: { ru: 'Армения', en: 'Armenia' },
  ge: { ru: 'Грузия', en: 'Georgia' },
  az: { ru: 'Азербайджан', en: 'Azerbaijan' },
  uz: { ru: 'Узбекистан', en: 'Uzbekistan' },
  kg: { ru: 'Киргизия', en: 'Kyrgyzstan' },
  tr: { ru: 'Турция', en: 'Türkiye' },
  il: { ru: 'Израиль', en: 'Israel' },
  ae: { ru: 'ОАЭ', en: 'UAE' },
  sa: { ru: 'Саудовская Аравия', en: 'Saudi Arabia' },
  eg: { ru: 'Египет', en: 'Egypt' },
  za: { ru: 'ЮАР', en: 'South Africa' },
  jp: { ru: 'Япония', en: 'Japan' },
  kr: { ru: 'Южная Корея', en: 'South Korea' },
  cn: { ru: 'Китай', en: 'China' },
  hk: { ru: 'Гонконг', en: 'Hong Kong' },
  tw: { ru: 'Тайвань', en: 'Taiwan' },
  sg: { ru: 'Сингапур', en: 'Singapore' },
  th: { ru: 'Таиланд', en: 'Thailand' },
  vn: { ru: 'Вьетнам', en: 'Vietnam' },
  id: { ru: 'Индонезия', en: 'Indonesia' },
  my: { ru: 'Малайзия', en: 'Malaysia' },
  ph: { ru: 'Филиппины', en: 'Philippines' },
  in: { ru: 'Индия', en: 'India' },
  pk: { ru: 'Пакистан', en: 'Pakistan' },
  ca: { ru: 'Канада', en: 'Canada' },
  mx: { ru: 'Мексика', en: 'Mexico' },
  br: { ru: 'Бразилия', en: 'Brazil' },
  ar: { ru: 'Аргентина', en: 'Argentina' },
  cl: { ru: 'Чили', en: 'Chile' },
  co: { ru: 'Колумбия', en: 'Colombia' },
  pe: { ru: 'Перу', en: 'Peru' },
  au: { ru: 'Австралия', en: 'Australia' },
  nz: { ru: 'Новая Зеландия', en: 'New Zealand' },
  is: { ru: 'Исландия', en: 'Iceland' },
  hr: { ru: 'Хорватия', en: 'Croatia' },
  si: { ru: 'Словения', en: 'Slovenia' },
  sk: { ru: 'Словакия', en: 'Slovakia' },
  hu: { ru: 'Венгрия', en: 'Hungary' },
  ro: { ru: 'Румыния', en: 'Romania' },
  bg: { ru: 'Болгария', en: 'Bulgaria' },
  rs: { ru: 'Сербия', en: 'Serbia' },
  gr: { ru: 'Греция', en: 'Greece' },
  ng: { ru: 'Нигерия', en: 'Nigeria' },
  ke: { ru: 'Кения', en: 'Kenya' },
};

/** Эмодзи-флаг из ISO-кода (regional indicators). */
export function flagEmoji(code: string): string {
  const cc = code.trim().toUpperCase();
  if (cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) return '🌐';
  return String.fromCodePoint(
    ...Array.from(cc).map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

const displayNames = new Map<Language, Intl.DisplayNames>();

/**
 * Название региона из данных CLDR самого движка (WebView2/Chromium, WebKit):
 * для zh/es/de и для кодов вне таблицы NAMES. null — если код не двухбуквенный
 * или движок его не знает.
 */
function regionName(code: string, lang: Language): string | null {
  if (!/^[a-z]{2}$/.test(code)) return null;
  try {
    let dn = displayNames.get(lang);
    if (dn === undefined) {
      dn = new Intl.DisplayNames([locale(lang)], { type: 'region' });
      displayNames.set(lang, dn);
    }
    const name = dn.of(code.toUpperCase());
    return name === undefined || name.toUpperCase() === code.toUpperCase() ? null : name;
  } catch {
    return null;
  }
}

/**
 * Название страны на языке интерфейса. ru/en берутся из выверенной таблицы
 * NAMES, остальные языки и неизвестные коды — из CLDR; если и там нет —
 * английское название из таблицы либо сам код в верхнем регистре.
 */
export function geoName(code: string, lang: Language): string {
  const c = code.trim().toLowerCase();
  const entry = NAMES[c];
  if (lang === 'ru' && entry !== undefined) return entry.ru;
  if (lang === 'en' && entry !== undefined) return entry.en;
  return regionName(c, lang) ?? entry?.en ?? c.toUpperCase();
}

/** Порядок групп: известные страны по алфавиту локали, «другие» в конце. */
export interface GeoGroup<T> {
  readonly code: string; // '' = без страны
  readonly label: string;
  readonly flag: string;
  readonly items: readonly T[];
}

export function groupByGeo<T>(
  items: readonly T[],
  geoOf: (item: T) => string,
  lang: Language,
): GeoGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const code = geoOf(item).trim().toLowerCase();
    const list = map.get(code);
    if (list === undefined) map.set(code, [item]);
    else list.push(item);
  }
  const groups: GeoGroup<T>[] = [];
  for (const [code, list] of map) {
    groups.push({
      code,
      label: code === '' ? t('geo.none', lang) : geoName(code, lang),
      flag: code === '' ? '🌐' : flagEmoji(code),
      items: list,
    });
  }
  const collator = new Intl.Collator(lang, { sensitivity: 'base' });
  groups.sort((a, b) => {
    if (a.code === '') return 1;
    if (b.code === '') return -1;
    return collator.compare(a.label, b.label);
  });
  return groups;
}
