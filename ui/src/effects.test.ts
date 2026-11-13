// SPDX-License-Identifier: GPL-3.0-only

// effects.test.ts — защита от дорогой отрисовки: в @keyframes только дешёвые свойства,
// фон без blend-режимов, на Linux нет blur-подложки, анимации встают на паузу.
import { describe, expect, it } from 'vitest';
import prototypeCss from './prototype.css?raw';
import baseCss from './base.css?raw';
import effectsCss from './effects.css?raw';
import connectionScreen from './screens/screen_connection.tsx?raw';

const ALL = [prototypeCss, baseCss, effectsCss];
// Свойства, пересчитывающие раскладку или требующие перерисовки с размытием.
const FORBIDDEN = ['left', 'right', 'top', 'bottom', 'width', 'height', 'box-shadow', 'filter', 'background-color', 'margin', 'padding'];

function keyframes(css: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (depth > 0 && i < css.length) {
      const ch = css[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    out.push({ name: m[1]!, body: css.slice(start, i - 1) });
  }
  return out;
}

describe('@keyframes анимируют только дешёвые свойства', () => {
  const frames = ALL.flatMap(keyframes);
  it('keyframes найдены', () => {
    expect(frames.length).toBeGreaterThan(15);
    expect(frames.map((f) => f.name)).toContain('bfStreak');
  });
  it.each(frames.map((f) => [f.name, f.body] as const))('%s', (_name, body) => {
    const props = Array.from(body.matchAll(/([a-z-]+)\s*:/g), (m) => m[1] ?? '');
    expect(props.filter((p) => FORBIDDEN.includes(p))).toEqual([]);
  });
});

describe('фон и подложки', () => {
  it('mix-blend-mode и will-change нигде не используются', () => {
    for (const css of ALL) {
      expect(css).not.toMatch(/mix-blend-mode\s*:/);
      expect(css).not.toMatch(/will-change\s*:/);
    }
  });
  it('на Linux у диалога и зоны перетаскивания нет backdrop-filter', () => {
    expect(effectsCss).toMatch(/html\[data-os="linux"\] \.dlg-back,html\[data-os="linux"\] #dropOv\{backdrop-filter:none/);
  });
  it('размытие остаётся только базовым правилам (Windows)', () => {
    expect(effectsCss.match(/backdrop-filter\s*:\s*blur/g)).toBeNull();
    expect(prototypeCss.match(/backdrop-filter\s*:\s*blur/g)?.length).toBe(2);
  });
  it('мёртвые data-bg и bg-paused удалены', () => {
    for (const css of ALL) {
      expect(css.includes('data-bg')).toBe(false);
      expect(css.includes('bg-paused')).toBe(false);
    }
  });
});

describe('пауза и reduce-motion', () => {
  it('при html[data-active="0"] на паузе декоративный фон и ореол кнопки', () => {
    expect(effectsCss).toMatch(
      /html\[data-active="0"\] #bgField \*,html\[data-active="0"\] \.cx-go::after\{animation-play-state:paused!important\}/,
    );
  });
  it('пауза не накрывает всё окно: тосты, диалоги и индикаторы продолжают играть', () => {
    expect(effectsCss).not.toMatch(/html\[data-active="0"\] \*/);
  });
  it('при reduce-motion глобально гасятся анимации и переходы, а эффекты фона выключены', () => {
    expect(prototypeCss).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration:\.01ms !important[\s\S]*transition:none !important/);
    expect(effectsCss).toMatch(/prefers-reduced-motion: reduce\)\{[^}]*\.bf-beam,\.bf-streak[^}]*animation:none!important/);
  });
  it('бесконечные анимации из effects.css используют токены длительности', () => {
    const infinite = effectsCss.split('\n').filter((l) => l.includes('infinite'));
    for (const l of infinite) expect(l).toMatch(/var\(--t-/);
  });

  it('каскад появления не вешается на строки серверов .prow (сортировка и фильтр перезапускали бы анимацию)', () => {
    const cascade = effectsCss.split('\n').filter((l) => l.includes('nth-child') && l.includes('fxRow'));
    expect(cascade.length).toBeGreaterThan(0);
    for (const l of cascade) {
      expect(l).not.toContain('.prow');
      expect(l).toContain('.sub-card');
    }
  });

  it('живая область #connState меняет только текст: без перемонтирования дочернего узла по key', () => {
    const src = connectionScreen.slice(connectionScreen.indexOf('id="connState"'));
    const region = src.slice(0, src.indexOf('</div>'));
    expect(region).not.toMatch(/key=/);
  });
});
