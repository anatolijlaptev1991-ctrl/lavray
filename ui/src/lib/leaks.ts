// leaks.ts — строки карточки «Проверка утечек» из отчёта ядра
// (DiagnosticsService.CheckLeaks). «Всё в порядке» ставится только при
// подтверждении замером; что ядро не измерило — «не проверено». Раньше
// «DNS: утечек нет» и «IPv6: через туннель» горели всегда.
import type { LeakReport } from '../gen/lavray_pb';
import type { MessageKey } from './i18n';

export interface LeakRow {
  readonly label: MessageKey;
  /** ok/warn — вывод по замеру; info — вывода нет (не проверено или просто значение). */
  readonly kind: 'ok' | 'warn' | 'info';
  readonly value: string;
}

export function leakRows(r: LeakReport, t: (key: MessageKey) => string): LeakRow[] {
  const tunnel = r.tunnelIp ?? '';
  const direct = r.directIp ?? '';
  const dns = r.dnsEgress ?? '';
  const na = t('st.na');
  // Адрес через туннель — признак того, что ядро выполнило полный замер
  // (контракт CheckLeaks: одна операция — все замеры). Без него булево поле
  // ipv6_direct_available не отличить от «не измерялось».
  const measured = tunnel !== '';
  const leak = measured && direct !== '' && tunnel === direct;
  const hidden = measured && direct !== '' && !leak;
  return [
    { label: 'leak.ip', kind: !measured ? 'info' : leak ? 'warn' : 'ok', value: measured ? tunnel : na },
    {
      label: 'leak.direct',
      kind: leak ? 'warn' : hidden ? 'ok' : 'info',
      value: leak ? direct : hidden ? t('leak.hidden') : na,
    },
    { label: 'leak.dns', kind: 'info', value: dns === '' ? na : dns },
    {
      label: 'leak.ipv6',
      kind: !measured ? 'info' : r.ipv6DirectAvailable ? 'warn' : 'ok',
      value: !measured ? na : r.ipv6DirectAvailable ? t('leak.ipv6.direct') : t('leak.noLeak'),
    },
  ];
}
