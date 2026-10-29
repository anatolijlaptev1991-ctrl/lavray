// typeGroups.ts — состав плиток выбора типа профиля (прототип #dlgEditor:
// «Популярные», «Другие», «Особые»). AnyTLS/WireGuard/SSH из прототипа не
// показываем: этих типов нет в ядре.
import { ProfileType } from '../../gen/lavray_pb';
import type { MessageKey } from '../../lib/i18n';

export interface Tile {
  readonly type: ProfileType;
  /** Имя плитки: готовая строка (имя протокола) или ключ словаря. */
  readonly name?: string;
  readonly nameKey?: MessageKey;
  readonly caption?: string;
  readonly captionKey?: MessageKey;
}

export interface TileGroup {
  readonly id: string;
  readonly labelKey: MessageKey;
  readonly tiles: readonly Tile[];
}

export const TYPE_GROUPS: readonly TileGroup[] = [
  {
    id: 'popular',
    labelKey: 'ed.group.popular',
    tiles: [
      { type: ProfileType.VLESS, name: 'VLESS', caption: 'Reality' },
      { type: ProfileType.HYSTERIA2, name: 'Hysteria2', caption: 'QUIC' },
      { type: ProfileType.TROJAN, name: 'Trojan', caption: 'TLS' },
      { type: ProfileType.SHADOWSOCKS, name: 'Shadowsocks', caption: '2022 / AEAD' },
    ],
  },
  {
    id: 'other',
    labelKey: 'ed.group.other',
    tiles: [
      { type: ProfileType.VMESS, name: 'VMess', caption: 'ws · tls' },
      { type: ProfileType.TUIC, name: 'TUIC', caption: 'QUIC v5' },
      { type: ProfileType.SOCKS, name: 'SOCKS5', captionKey: 'ed.c.local' },
      { type: ProfileType.HTTP, name: 'HTTPS', caption: 'CONNECT' },
    ],
  },
  {
    id: 'special',
    labelKey: 'ed.group.special',
    tiles: [
      { type: ProfileType.CHAIN, nameKey: 'ed.t.chain', captionKey: 'ed.c.chain' },
      { type: ProfileType.CUSTOM_OUTBOUND, nameKey: 'ed.t.json', captionKey: 'ed.c.json' },
    ],
  },
];

type Translate = (key: MessageKey) => string;

export function tileName(tile: Tile, t: Translate): string {
  return tile.nameKey === undefined ? (tile.name ?? '') : t(tile.nameKey);
}

/** Название типа для существующего профиля (его тип не меняется). */
export function typeDisplayName(type: ProfileType, t: Translate): string {
  if (type === ProfileType.CUSTOM_CONFIG) return t('ed.t.json');
  for (const group of TYPE_GROUPS) {
    const tile = group.tiles.find((x) => x.type === type);
    if (tile !== undefined) return tileName(tile, t);
  }
  return String(type);
}
