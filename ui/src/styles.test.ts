// SPDX-License-Identifier: GPL-3.0-only

// styles.test.ts — T-62: токены вместо жёстких цветов и контраст по WCAG 2.2.
// Значения берутся из самого prototype.css, поэтому правка токена или правила
// сразу меняет результат. jsdom не считает стили, а вычисление цвета по токенам
// и формуле WCAG от этого не зависит.
import { describe, expect, it } from 'vitest';
// Текст стилей: vite.config.ts → test.css.include отдаёт эти файлы как есть
// (по умолчанию Vitest подменяет любой .css, в том числе ?raw, пустой строкой).
import prototypeCss from './prototype.css?raw';
import baseCss from './base.css?raw';

type Rgb = readonly [number, number, number];

const hex = (value: string): Rgb => {
  const h = value.trim().replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb;
};
const luminance = ([r, g, b]: Rgb): number => {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** Цвет a с прозрачностью alpha поверх b. */
const over = (a: Rgb, alpha: number, b: Rgb): Rgb =>
  a.map((c, i) => Math.round(c * alpha + (b[i] ?? 0) * (1 - alpha))) as unknown as Rgb;
/** Смесь in srgb: pa процентов a и остальное b. */
const mixSrgb = (a: Rgb, pa: number, b: Rgb): Rgb => over(a, pa / 100, b);

/** Тело первого правила с точным селектором (без учёта вложенных @media). */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector}{`);
  expect(start, `правило ${selector} не найдено`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

function tokens(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of rule(css, selector).matchAll(/(--[a-z0-9-]+):\s*([^;]+);?/g)) {
    out[m[1] ?? ''] = (m[2] ?? '').trim();
  }
  return out;
}

const THEMES = {
  dark: tokens(prototypeCss, 'html[data-theme="dark"]'),
  light: tokens(prototypeCss, 'html[data-theme="light"]'),
} as const;

/** Акцент-токены для пары «тема × акцент». amber — акцент по умолчанию в теме. */
function accentTokens(theme: 'dark' | 'light', accent: 'amber' | 'sage' | 'graphite'): Record<string, string> {
  if (accent === 'amber') return THEMES[theme];
  const base = tokens(prototypeCss, `html[data-accent="${accent}"]`);
  const themed = theme === 'light' ? tokens(prototypeCss, `html[data-accent="${accent}"][data-theme="light"]`) : {};
  return { ...base, ...themed };
}

function rgba(value: string): { rgb: Rgb; alpha: number } {
  const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(value.replace(/\s+/g, ''));
  expect(m, `ожидался rgba(...), получено «${value}»`).not.toBeNull();
  return { rgb: [Number(m?.[1]), Number(m?.[2]), Number(m?.[3])], alpha: Number(m?.[4]) };
}

describe('контраст контролов и текста', () => {
  it('граница .seg — токен с контрастом ≥ 3:1 к фону окна, карточке и самому контролу (WCAG 1.4.11)', () => {
    const body = rule(prototypeCss, '.seg');
    const token = /border:\s*1px solid var\((--[a-z-]+)\)/.exec(body)?.[1] ?? '';
    expect(token, '.seg: граница не задана токеном').not.toBe('');
    for (const theme of ['dark', 'light'] as const) {
      const t = THEMES[theme];
      const border = hex(t[token] ?? '#000000');
      for (const bg of ['--bg', '--surface', '--surface2']) {
        const ratio = contrast(border, hex(t[bg] ?? '#000000'));
        expect(ratio, `${theme}: ${token} на ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('активный пункт оглавления настроек — текст ≥ 4,5:1 при всех акцентах в обеих темах', () => {
    const body = rule(prototypeCss, '.set-toc button.on');
    const color = /(?:^|;)\s*color:\s*([^;]+)/.exec(body)?.[1]?.replace(/\s+/g, '') ?? '';
    for (const theme of ['dark', 'light'] as const) {
      for (const accent of ['amber', 'sage', 'graphite'] as const) {
        const a = accentTokens(theme, accent);
        const t = THEMES[theme];
        const base = hex(a['--accent'] ?? '#000000');
        let text = base;
        if (color !== 'var(--accent)') {
          const mix = /^color-mix\(insrgb,var\(--accent\)(\d+)%,var\(--t1\)\)$/.exec(color);
          expect(mix, `неожиданное значение color: ${color}`).not.toBeNull();
          text = mixSrgb(base, Number(mix?.[1]), hex(t['--t1'] ?? '#000000'));
        }
        const soft = rgba(a['--accent-soft'] ?? '');
        for (const bgToken of ['--bg', '--surface']) {
          const bg = over(soft.rgb, soft.alpha, hex(t[bgToken] ?? '#000000'));
          expect(contrast(text, bg), `${theme}/${accent} на ${bgToken}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe('токены вместо жёстких цветов', () => {
  it('.banner-ok строится на --ok, как .banner-err на --err (баннер следует теме)', () => {
    const body = rule(prototypeCss, '.banner-ok');
    expect(body).toContain('var(--ok)');
    expect(body).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b/i);
  });

  it('var(--имя) без запасного значения всегда ссылается на объявленный токен', () => {
    const css = `${prototypeCss}\n${baseCss}`;
    const declared = new Set(Array.from(css.matchAll(/(--[a-z0-9-]+)\s*:/g), (m) => m[1]));
    const undeclared = Array.from(css.matchAll(/var\((--[a-z0-9-]+)\s*\)/g), (m) => m[1] ?? '')
      .filter((name) => !declared.has(name));
    expect(Array.from(new Set(undeclared))).toEqual([]);
  });
});

describe('китайский текст', () => {
  it('для zh отключены text-transform и letter-spacing (DS §9: заглавных в CJK нет)', () => {
    const body = rule(prototypeCss, 'html[lang^="zh"] *');
    expect(body).toContain('text-transform:none');
    expect(body).toContain('letter-spacing:0');
  });
});
