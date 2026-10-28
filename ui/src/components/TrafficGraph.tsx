// TrafficGraph.tsx — график трафика за сессию по прототипу v1.2:
// canvas, заливка загрузки акцентом, пунктир отдачи, сетка, легенда,
// пустое состояние. Данные — из StatsService.Subscribe (push-кадры).
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { formatBytes, formatSpeed } from '../lib/i18n';
import { Icon } from '../components/Icon';

const POINTS = 64;

interface Props {
  readonly active: boolean;
}

export function TrafficGraph({ active }: Props): JSX.Element {
  const { t, lang } = useI18n();
  const core = useCore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const downRef = useRef<number[]>([]);
  const upRef = useRef<number[]>([]);
  const [totals, setTotals] = useState({ down: 0, up: 0 });
  const [speed, setSpeed] = useState({ down: 0, up: 0 });
  const [err, setErr] = useState('');

  // Приём push-кадров статистики (FR-UI-210/211).
  useEffect(() => {
    if (!active) {
      downRef.current = [];
      upRef.current = [];
      setTotals({ down: 0, up: 0 });
      setSpeed({ down: 0, up: 0 });
      return undefined;
    }
    const ac = new AbortController();
    void (async (): Promise<void> => {
      try {
        const stream = core.stats.subscribe({ intervalMs: 1000 }, { signal: ac.signal });
        for await (const snap of stream) {
          const sess = snap.session;
          if (sess !== undefined) {
            setTotals({
              down: Number(sess.downlinkTotal),
              up: Number(sess.uplinkTotal),
            });
          }
          let downBps = 0;
          let upBps = 0;
          for (const tag of snap.tags) {
            downBps += tag.downlinkBps;
            upBps += tag.uplinkBps;
          }
          setSpeed({ down: downBps, up: upBps });
          const push = (arr: number[], v: number): void => {
            arr.push(v);
            if (arr.length > POINTS) arr.shift();
          };
          push(downRef.current, downBps);
          push(upRef.current, upBps);
        }
      } catch (e) {
        if (!ac.signal.aborted) setErr(showCoreError(e, t));
      }
    })();
    return (): void => {
      ac.abort();
    };
  }, [active, core, t]);

  // Перерисовка: сетка, заливка загрузки, пунктир отдачи (как в прототипе).
  useEffect(() => {
    const cv = canvasRef.current;
    if (cv === null) return undefined;
    const draw = (): void => {
      const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      const w = cv.clientWidth > 0 ? cv.clientWidth : 600;
      const h = cv.clientHeight > 0 ? cv.clientHeight : 170;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext('2d');
      if (ctx === null) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const css = getComputedStyle(document.documentElement);
      const accent = css.getPropertyValue('--accent').trim() || '#E0A03A';
      const info = css.getPropertyValue('--info').trim() || '#6E9BD1';
      const subtle = css.getPropertyValue('--b-subtle').trim() || 'rgba(255,255,255,.08)';

      const padR = 10;
      const padL = 2;
      const step = (w - padR - padL) / (POINTS - 1);
      const dn = downRef.current;
      const up = upRef.current;
      const peak = Math.max(1e5, ...dn, ...up) * 1.15;
      const y = (v: number): number => h - 4 - (v / peak) * (h - 14);

      ctx.strokeStyle = subtle;
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (h * i) / 4);
        ctx.lineTo(w, (h * i) / 4);
        ctx.stroke();
      }
      if (dn.length === 0) return;

      // Заливка загрузки.
      ctx.beginPath();
      ctx.moveTo(padL, h);
      dn.forEach((v, i) => {
        ctx.lineTo(padL + i * step, y(v));
      });
      ctx.lineTo(padL + (dn.length - 1) * step, h);
      ctx.closePath();
      ctx.fillStyle = `${accent}33`;
      ctx.fill();

      // Линия загрузки.
      ctx.beginPath();
      dn.forEach((v, i) => {
        if (i === 0) ctx.moveTo(padL, y(v));
        else ctx.lineTo(padL + i * step, y(v));
      });
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Линия отдачи.
      ctx.beginPath();
      up.forEach((v, i) => {
        if (i === 0) ctx.moveTo(padL, y(v));
        else ctx.lineTo(padL + i * step, y(v));
      });
      ctx.strokeStyle = info;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    draw();
    const onResize = (): void => { draw(); };
    window.addEventListener('resize', onResize);
    const id = window.setInterval(draw, 900);
    return (): void => {
      window.removeEventListener('resize', onResize);
      window.clearInterval(id);
    };
  }, [speed, t]);

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
      {err !== '' && <p className="cap">{err}</p>}
    </div>
  );
}
