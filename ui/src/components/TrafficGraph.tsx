// SPDX-License-Identifier: GPL-3.0-only

// TrafficGraph.tsx — график трафика за сессию по прототипу v1.2:
// canvas, заливка загрузки акцентом, пунктир отдачи, сетка, легенда,
// пустое состояние. Данные — из StatsService.Subscribe (push-кадры).
import { useCallback, useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import { useTrafficStats } from '../hooks/useTraffic';
import type { Speed } from '../hooks/useTraffic';
import { formatBytes, formatSpeed } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { drawTraffic, POINTS } from './trafficGraphDraw';

interface Props {
  readonly active: boolean;
}

/** Добавляет точку, держа в буфере не больше POINTS последних. */
function pushPoint(buf: number[], v: number): void {
  buf.push(v);
  if (buf.length > POINTS) buf.shift();
}

export function TrafficGraph({ active }: Props): JSX.Element {
  const { t, lang } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const downRef = useRef<number[]>([]);
  const upRef = useRef<number[]>([]);

  // Точки копим по кадрам статистики (FR-UI-210/211): тот же хук, что у статус-бара.
  const onSample = useCallback((s: Speed): void => {
    pushPoint(downRef.current, s.down);
    pushPoint(upRef.current, s.up);
  }, []);
  const { speed, totals, error } = useTrafficStats(active, onSample);
  useEffect(() => {
    if (active) return;
    downRef.current = [];
    upRef.current = [];
  }, [active]);

  // Перерисовка: на каждый кадр и по таймеру; слушатель resize и интервал
  // создаются один раз, а не на каждый кадр статистики.
  const redraw = useCallback((): void => {
    const cv = canvasRef.current;
    if (cv !== null) drawTraffic(cv, downRef.current, upRef.current);
  }, []);
  const redrawRef = useRef(redraw);
  useEffect(() => {
    redrawRef.current = redraw;
  });
  useEffect(() => {
    const run = (): void => {
      redrawRef.current();
    };
    window.addEventListener('resize', run);
    const id = window.setInterval(run, 900);
    return (): void => {
      window.removeEventListener('resize', run);
      window.clearInterval(id);
    };
  }, []);
  useEffect(() => {
    redraw();
  }, [speed, redraw]);

  return (
    <div className="card traffic-card">
      <div className="traffic-top">
        <div className="card-h" style={{ margin: 0 }}>
          <span className="ic"><Icon name="activity" /></span>
          <h2>{t('conn.traffic')}</h2>
        </div>
        <div className="speeds">
          <span className="spd dn">
            <Icon name="download" />
            <b>{formatSpeed(speed.down, lang)}</b>
          </span>
          <span className="spd up">
            <Icon name="upload" />
            <b>{formatSpeed(speed.up, lang)}</b>
          </span>
        </div>
      </div>
      <div className="traffic-legend">
        <span className="tl-item">
          <span className="dot" style={{ background: 'var(--accent)' }} />
          <span>{t('conn.down')}</span>&nbsp;
          <span className="mono t3">{formatBytes(totals.down, lang)}</span>
        </span>
        <span className="tl-item">
          <span className="dot" style={{ background: 'var(--info)' }} />
          <span>{t('conn.up')}</span>&nbsp;
          <span className="mono t3">{formatBytes(totals.up, lang)}</span>
        </span>
      </div>
      <canvas ref={canvasRef} height={170} role="img" aria-label={t('conn.traffic')} />
      {!active && <div className="graph-empty">{t('graph.empty')}</div>}
      {error !== '' && <p className="cap" role="alert">{error}</p>}
    </div>
  );
}
