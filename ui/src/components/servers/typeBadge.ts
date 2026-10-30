// SPDX-License-Identifier: GPL-3.0-only

// typeBadge.ts — бейдж типа профиля в строке списка серверов (прототип .badge.bt-*,
// нейтральный: цвет — только у статусов). Вынесено из screen_servers.tsx без изменений.
import { ProfileType } from '../../gen/lavray_pb';
import type { MessageKey } from '../../lib/i18n';

/** Подпись (готовая или ключ словаря) и суффикс CSS-класса .badge.bt-<cls>. */
interface TypeInfo {
  readonly cls: string;
  readonly label?: string;
  readonly labelKey?: MessageKey;
}

const TYPE_INFO: Record<number, TypeInfo> = {
  [ProfileType.SOCKS]: { cls: 'socks', label: 'SOCKS5' },
  [ProfileType.HTTP]: { cls: 'https', label: 'HTTPS' },
  [ProfileType.SHADOWSOCKS]: { cls: 'ss', label: 'Shadowsocks' },
  [ProfileType.TROJAN]: { cls: 'trojan', label: 'Trojan' },
  [ProfileType.VMESS]: { cls: 'vmess', label: 'VMess' },
  [ProfileType.VLESS]: { cls: 'vless', label: 'VLESS' },
  [ProfileType.HYSTERIA2]: { cls: 'hy2', label: 'Hysteria2' },
  [ProfileType.TUIC]: { cls: 'tuic', label: 'TUIC' },
  [ProfileType.CHAIN]: { cls: 'chain', labelKey: 'ed.t.chain' },
  [ProfileType.CUSTOM_OUTBOUND]: { cls: 'json', labelKey: 'ed.t.json' },
  [ProfileType.CUSTOM_CONFIG]: { cls: 'json', labelKey: 'ed.t.json' },
};

export function typeBadge(type: ProfileType, t: (key: MessageKey) => string): { cls: string; label: string } {
  const info = TYPE_INFO[type];
  if (info === undefined) return { cls: 'unknown', label: '?' };
  return { cls: info.cls, label: info.labelKey === undefined ? (info.label ?? '?') : t(info.labelKey) };
}
