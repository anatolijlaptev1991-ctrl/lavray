// SPDX-License-Identifier: GPL-3.0-only

// trafficGraphDraw.ts — отрисовка canvas графика трафика (сетка, заливка
// загрузки, пунктир отдачи). Вынесено из TrafficGraph.tsx: чистая функция
// от canvas и двух рядов точек.

/** Точек в окне графика (по секунде). */
export const POINTS = 64;

const PAD_L = 2;
const PAD_R = 10;

interface Palette {
  readonly accent: string;
  readonly info: string;
  readonly subtle: string;
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  return {
    accent: css.getPropertyValue('--accent').trim() || '#E0A03A',
    info: css.getPropertyValue('--info').trim() || '#6E9BD1',
    subtle: css.getPropertyValue('--b-subtle').trim() || 'rgba(255,255,255,.08)',
  };
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (h * i) / 4);
    ctx.lineTo(w, (h * i) / 4);
    ctx.stroke();
  }
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  vals: readonly number[],
  step: number,
  y: (v: number) => number,
): void {
  ctx.beginPath();
  vals.forEach((v, i) => {
    if (i === 0) ctx.moveTo(PAD_L, y(v));
    else ctx.lineTo(PAD_L + i * step, y(v));
  });
}

function drawSeries(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  dn: readonly number[],
  up: readonly number[],
  pal: Palette,
): void {
  const { w, h } = size;
  const step = (w - PAD_R - PAD_L) / (POINTS - 1);
  const peak = Math.max(1e5, ...dn, ...up) * 1.15;
  const y = (v: number): number => h - 4 - (v / peak) * (h - 14);

  // Заливка загрузки.
  ctx.beginPath();
  ctx.moveTo(PAD_L, h);
  dn.forEach((v, i) => {
    ctx.lineTo(PAD_L + i * step, y(v));
  });
  ctx.lineTo(PAD_L + (dn.length - 1) * step, h);
  ctx.closePath();
  ctx.fillStyle = `${pal.accent}33`;
  ctx.fill();

  // Линия загрузки.
  tracePath(ctx, dn, step, y);
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Линия отдачи.
  tracePath(ctx, up, step, y);
  ctx.strokeStyle = pal.info;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Подгоняет размер буфера под CSS-размер и возвращает контекст (null — canvas недоступен). */
function prepare(cv: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const w = cv.clientWidth > 0 ? cv.clientWidth : 600;
  const h = cv.clientHeight > 0 ? cv.clientHeight : 170;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  // jsdom/старые webview не умеют canvas — график просто не рисуется
  // (иначе монтирование экрана падает в тестах и на урезанных webview).
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = cv.getContext('2d');
  } catch {
    return null;
  }
  if (ctx === null) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Перерисовывает график целиком. */
export function drawTraffic(cv: HTMLCanvasElement, dn: readonly number[], up: readonly number[]): void {
  const prep = prepare(cv);
  if (prep === null) return;
  const pal = readPalette();
  drawGrid(prep.ctx, prep.w, prep.h, pal.subtle);
  if (dn.length === 0) return;
  drawSeries(prep.ctx, prep, dn, up, pal);
}
