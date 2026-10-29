// geo.test.ts — T-60: названия стран на всех пяти языках и подпись «без страны».
import { describe, expect, it } from 'vitest';
import { geoName, groupByGeo } from './geo';
import { LANGUAGES, t } from './i18n';

describe('geoName', () => {
  it('Германия на каждом из пяти языков (раньше zh/es/de отдавали английское слово)', () => {
    expect(geoName('de', 'ru')).toBe('Германия');
    expect(geoName('de', 'en')).toBe('Germany');
    expect(geoName('de', 'zh')).toBe('德国');
    expect(geoName('de', 'es')).toBe('Alemania');
    expect(geoName('de', 'de')).toBe('Deutschland');
  });

  it('страны вне таблицы берутся из данных движка, а не печатаются кодом', () => {
    expect(geoName('lk', 'ru')).toBe('Шри-Ланка');
    expect(geoName('lk', 'de')).toBe('Sri Lanka');
    expect(geoName('lk', 'zh')).toBe('斯里兰卡');
  });

  it('неизвестный или некорректный код -> код заглавными, без исключения', () => {
    for (const lang of LANGUAGES) {
      expect(geoName('xx', lang)).toBe('XX');
      expect(geoName('hr2', lang)).toBe('HR2'); // мусорный ключ таблицы удалён
      expect(geoName('', lang)).toBe('');
    }
  });
});

describe('groupByGeo', () => {
  it('подпись группы «без страны» берётся из словаря каждого языка', () => {
    for (const lang of LANGUAGES) {
      const groups = groupByGeo([{ geo: '' }], (p) => p.geo, lang);
      expect(groups[0]?.label).toBe(t('geo.none', lang));
    }
    expect(groupByGeo([{ geo: '' }], (p) => p.geo, 'zh')[0]?.label).toBe('无国家/地区');
    expect(groupByGeo([{ geo: '' }], (p) => p.geo, 'en')[0]?.label).toBe('No country');
  });

  it('страны сортируются по названию в языке интерфейса, «без страны» — в конце', () => {
    const items = [{ geo: '' }, { geo: 'us' }, { geo: 'de' }];
    const labels = groupByGeo(items, (p) => p.geo, 'de').map((g) => g.label);
    expect(labels).toEqual(['Deutschland', 'Vereinigte Staaten', 'Kein Land']);
  });
});
