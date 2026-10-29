// SPDX-License-Identifier: GPL-3.0-only

// profileType.ts — читаемое название протокола профиля для бейджей и меню.
// Названия протоколов — технические токены и не переводятся (VLESS, TUIC);
// переводятся только «Цепочка» и «Свой JSON» (как в прототипе: typeLabel).
import { ProfileType } from '../gen/lavray_pb';
import type { MessageKey } from './i18n';

export function profileTypeLabel(type: ProfileType, t: (key: MessageKey) => string): string {
  switch (type) {
    case ProfileType.SOCKS:
      return 'SOCKS';
    case ProfileType.HTTP:
      return 'HTTP';
    case ProfileType.SHADOWSOCKS:
      return 'Shadowsocks';
    case ProfileType.TROJAN:
      return 'Trojan';
    case ProfileType.VMESS:
      return 'VMess';
    case ProfileType.VLESS:
      return 'VLESS';
    case ProfileType.NAIVE:
      return 'Naive';
    case ProfileType.HYSTERIA2:
      return 'Hysteria2';
    case ProfileType.TUIC:
      return 'TUIC';
    case ProfileType.CHAIN:
      return t('ed.t.chain');
    case ProfileType.CUSTOM_OUTBOUND:
    case ProfileType.CUSTOM_CONFIG:
    case ProfileType.CUSTOM_EXTERNAL:
      return t('ed.t.json');
    default:
      return '—';
  }
}
