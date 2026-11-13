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
    expect(effectsCss).toMatch(/prefers-reduced-motion: reduce\)\{[^}]*\.bf-beam,\.bf-streak,\.fx-swap\)[^}]*animation:none!important/);
    // Системный reduce-motion действует, только пока нет явного выбора (html[data-motion]).
    for (const css of ALL) {
      for (const m of css.matchAll(/prefers-reduced-motion: reduce\)\s*\{([^}]*)\}/g)) {
        expect(m[1]).toContain('html:not([data-motion])');
      }
    }
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

// Бесконечная анимация заставляет WebKitGTK перерисовывать окно 60 раз в секунду
// (на N100 это ~55 % ядра у открытого окна в покое). Разрешены только переходные
// состояния: идёт подключение (data-conn="mid") и идёт загрузка (спиннеры).
const INFINITE_ALLOWED: readonly string[] = [
  '#stateCard[data-conn="mid"] .cx-go::after', // ореол кнопки, пока идёт подключение
  '#stateCard[data-conn="mid"] .a-beam', // луч знака, пока идёт подключение
  '#stateCard[data-conn="mid"] .a-photon', // фотон знака, пока идёт подключение
  '.ic-spin', // спиннер загрузки (кнопка .btn.loading, проверка и установка обновления)
  '.upd-stage.cur .st-dot', // точка текущего этапа, пока идёт скачивание обновления
  // Дрейф лучей фона: только «Полные»; замирает (play-state: paused) через 20 с без ввода.
  'html[data-motion="full"] .bf-beam.b1',
  'html[data-motion="full"] .bf-beam.b2',
];

/** Правила (самые вложенные блоки, в том числе внутри @media), чьё тело содержит `infinite`. */
function infiniteSelectors(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\binfinite\b/.test(m[2]!)) continue;
    m[1]!.split(',').forEach((sel) => out.push(sel.trim().replace(/\s+/g, ' ')));
  }
  return out;
}

describe('бесконечные анимации только в переходных состояниях', () => {
  it('парсер находит бесконечные анимации (защита от пустой проверки)', () => {
    expect(infiniteSelectors('/* x */ .a{animation:k 1s infinite} @media (x){.b,.c{animation:k infinite}} .d{color:red}')).toEqual([
      '.a',
      '.b',
      '.c',
    ]);
    expect(infiniteSelectors(prototypeCss).length).toBeGreaterThan(0);
  });
  it('каждое правило с infinite стоит под разрешённым селектором из INFINITE_ALLOWED', () => {
    const offenders = ALL.flatMap(infiniteSelectors).filter((sel) => !INFINITE_ALLOWED.includes(sel));
    expect(
      offenders,
      'Бесконечная анимация в устойчивом состоянии (простой, «подключено», «отключено», «ошибка») ' +
        'заставляет WebKitGTK перерисовывать окно постоянно. Ограничьте её переходным состоянием ' +
        '(data-conn="mid", спиннер) и добавьте селектор в INFINITE_ALLOWED, либо уберите infinite.',
    ).toEqual([]);
  });
  it('все разрешённые селекторы реально используются (список не копит мёртвые записи)', () => {
    const used = new Set(ALL.flatMap(infiniteSelectors));
    expect(INFINITE_ALLOWED.filter((sel) => !used.has(sel))).toEqual([]);
  });
  it('устойчивые состояния знака (on, off, err) и лучи фона без бесконечных анимаций', () => {
    const sels = ALL.flatMap(infiniteSelectors);
    expect(sels.filter((s) => /data-conn="(on|off|err)"|bf-floor|bf-grain/.test(s))).toEqual([]);
    // Лучи фона дрейфуют только в режиме «Полные».
    expect(sels.filter((s) => s.includes('bf-beam') && !s.startsWith('html[data-motion="full"] '))).toEqual([]);
  });
  it('дрейф фона без ввода стоит на паузе, а в «Экономных» и «Выключены» не включается', () => {
    expect(effectsCss).toContain('html[data-motion="full"]:not([data-input="1"]) .bf-beam{animation-play-state:paused}');
    expect(effectsCss).toMatch(/html\[data-motion="lite"\] :is\(\.bf-streak,\.bf-ripple\)\{display:none\}/);
    expect(effectsCss).toMatch(/html\[data-motion="off"\] \*,[^{]*\{animation-duration:\.01ms!important;animation-iteration-count:1!important;transition:none!important/);
  });
});
