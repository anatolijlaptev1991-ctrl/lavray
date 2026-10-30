// SPDX-License-Identifier: GPL-3.0-only

// form.ts — состояние формы редактора профиля и преобразования форма ↔ Profile
// (чистые функции без React: проверяются тестами без монтирования диалога).
// Покрывает все внутренние типы ядра: SOCKS/HTTP, Shadowsocks, VMess, VLESS,
// Trojan, Hysteria2, TUIC, цепочку и «Свой JSON» (FR-UI-081…101).
import { create } from '@bufbuild/protobuf';
import {
  ChainDetailSchema,
  CustomDetailSchema,
  CustomDetail_Core,
  Hysteria2DetailSchema,
  ProfileSchema,
  ProfileType,
  ShadowsocksDetailSchema,
  ShadowsocksDetail_Uot,
  SocksHttpDetailSchema,
  SocksHttpDetail_Proto,
  StreamSettingsSchema,
  StreamSettings_MultiplexStatus,
  StreamSettings_Network,
  StreamSettings_PacketEncoding,
  StreamSettings_Security,
  TrojanVlessDetailSchema,
  TuicDetailSchema,
  TuicDetail_CongestionControl,
  TuicDetail_UdpRelayMode,
  VmessDetailSchema,
} from '../../gen/lavray_pb';
import type { Profile } from '../../gen/lavray_pb';
import type { MessageKey } from '../../lib/i18n';

export interface Form {
  type: ProfileType;
  name: string;
  address: string;
  port: string;
  geo: string;
  notes: string;
  // SOCKS / HTTP
  proto: SocksHttpDetail_Proto;
  username: string;
  password: string;
  // Shadowsocks
  method: string;
  plugin: string;
  uot: ShadowsocksDetail_Uot;
  // VMess / VLESS / TUIC
  uuid: string;
  security: string;
  alterId: string;
  flow: string;
  // Hysteria2 / TUIC
  obfsPassword: string;
  upMbps: string;
  downMbps: string;
  serverPorts: string;
  hopInterval: string;
  congestion: TuicDetail_CongestionControl;
  udpRelay: TuicDetail_UdpRelayMode;
  zeroRtt: boolean;
  heartbeat: string;
  ca: string;
  disableSni: boolean;
  // транспорт и TLS (v2ray-подобные типы; sni/alpn/allowInsecure — и у Hy2/TUIC)
  network: StreamSettings_Network;
  tls: StreamSettings_Security;
  sni: string;
  alpn: string;
  path: string;
  host: string;
  fingerprint: string;
  realityPbk: string;
  realitySid: string;
  allowInsecure: boolean;
  // цепочка и «Свой JSON»
  chain: bigint[];
  json: string;
}

export type FormErrors = Partial<Record<'name' | 'address' | 'port' | 'chain' | 'json', string>>;

/** Пример для нового «Своего JSON» (прототип: JSON исходящего ядра). */
export const DEFAULT_OUTBOUND_JSON = '{\n  "type": "socks",\n  "server": "example.org",\n  "server_port": 1080\n}';

/** Типы без адреса и порта в форме: адрес живёт в JSON или в узлах цепочки. */
export function isSpecialType(type: ProfileType): boolean {
  return (
    type === ProfileType.CHAIN ||
    type === ProfileType.CUSTOM_OUTBOUND ||
    type === ProfileType.CUSTOM_CONFIG
  );
}

export function isJsonType(type: ProfileType): boolean {
  return type === ProfileType.CUSTOM_OUTBOUND || type === ProfileType.CUSTOM_CONFIG;
}

/** Типы с блоком «Транспорт и TLS» (stream settings). */
export function isV2rayType(type: ProfileType): boolean {
  return (
    type === ProfileType.VMESS ||
    type === ProfileType.VLESS ||
    type === ProfileType.TROJAN ||
    type === ProfileType.SOCKS ||
    type === ProfileType.HTTP
  );
}

export function emptyForm(type: ProfileType): Form {
  return {
    type,
    name: '',
    address: '',
    port: '',
    geo: '',
    notes: '',
    proto: SocksHttpDetail_Proto.SOCKS5,
    username: '',
    password: '',
    method: '2022-blake3-aes-128-gcm',
    plugin: '',
    uot: ShadowsocksDetail_Uot.OFF,
    uuid: '',
    security: 'auto',
    alterId: '0',
    flow: '',
    obfsPassword: '',
    upMbps: '',
    downMbps: '',
    serverPorts: '',
    hopInterval: '',
    congestion: TuicDetail_CongestionControl.UNSPECIFIED,
    udpRelay: TuicDetail_UdpRelayMode.UNSPECIFIED,
    zeroRtt: false,
    heartbeat: '',
    ca: '',
    disableSni: false,
    network: StreamSettings_Network.TCP,
    tls: StreamSettings_Security.NONE,
    sni: '',
    alpn: '',
    path: '',
    host: '',
    fingerprint: '',
    realityPbk: '',
    realitySid: '',
    allowInsecure: false,
    chain: [],
    json: DEFAULT_OUTBOUND_JSON,
  };
}

function numText(n: number | undefined): string {
  return n === undefined || n === 0 ? '' : String(n);
}

function toInt(text: string): number {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Поля формы, которые задаёт типоспецифичная часть профиля (oneof detail). */
function detailPatch(p: Profile): Partial<Form> {
  const d = p.detail;
  switch (d.case) {
    case 'socksHttp':
      return {
        proto: d.value.proto,
        username: d.value.username ?? '',
        password: d.value.password ?? '',
      };
    case 'shadowsocks':
      return {
        method: d.value.method,
        password: d.value.password ?? '',
        plugin: d.value.plugin ?? '',
        uot: d.value.udpOverTcp,
      };
    case 'vmess':
      return {
        uuid: d.value.uuid,
        security: d.value.security,
        alterId: String(d.value.alterId),
      };
    case 'trojanVless':
      return { password: d.value.password, flow: d.value.flow ?? '' };
    case 'hysteria2':
      return {
        password: d.value.password ?? '',
        obfsPassword: d.value.obfsPassword ?? '',
        upMbps: numText(d.value.uploadMbps),
        downMbps: numText(d.value.downloadMbps),
        serverPorts: d.value.serverPorts ?? '',
        hopInterval: d.value.hopInterval ?? '',
        sni: d.value.sni ?? '',
        ca: d.value.ca ?? '',
        allowInsecure: d.value.allowInsecure ?? false,
        disableSni: d.value.disableSni ?? false,
      };
    case 'tuic':
      return {
        uuid: d.value.uuid,
        password: d.value.password ?? '',
        congestion: d.value.congestionControl,
        udpRelay: d.value.udpRelayMode,
        zeroRtt: d.value.zeroRttHandshake ?? false,
        heartbeat: d.value.heartbeat ?? '',
        sni: d.value.sni ?? '',
        alpn: d.value.alpn ?? '',
        ca: d.value.ca ?? '',
        allowInsecure: d.value.allowInsecure ?? false,
        disableSni: d.value.disableSni ?? false,
      };
    case 'chain':
      return { chain: [...d.value.profileIds] };
    case 'custom':
      return {
        json:
          d.value.core === CustomDetail_Core.INTERNAL_FULL
            ? (d.value.fullConfigJson ?? '')
            : (d.value.outboundJson ?? ''),
      };
    default:
      return {};
  }
}

function streamPatch(p: Profile): Partial<Form> {
  const s = p.stream;
  if (s === undefined) return {};
  return {
    network: s.network,
    tls: s.security,
    sni: s.sni,
    alpn: s.alpn,
    host: s.host,
    path: s.path,
    fingerprint: s.utlsFingerprint,
    realityPbk: s.realityPublicKey ?? '',
    realitySid: s.realityShortId ?? '',
    allowInsecure: s.allowInsecure,
  };
}

export function fromProfile(p: Profile): Form {
  return {
    ...emptyForm(p.type),
    name: p.name,
    address: p.address,
    port: String(p.port),
    geo: p.geo,
    notes: p.notes ?? '',
    ...detailPatch(p),
    ...streamPatch(p),
  };
}

/** server / server_port из JSON исходящего: по ним строка списка и TCP-проверка. */
function jsonEndpoint(raw: string): { address: string; port: number } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      const server = rec.server;
      const port = rec.server_port;
      return {
        address: typeof server === 'string' ? server : '',
        port: typeof port === 'number' ? port : 0,
      };
    }
  } catch {
    /* невалидный JSON отсекает validateForm */
  }
  return { address: '', port: 0 };
}

/**
 * Типоспецифичная деталь (ровно одна). Необязательные поля всегда заданы
 * явно (пустая строка / 0 / false): тогда очистка поля в форме перезаписывает
 * старое значение и при слиянии с исходным профилем.
 */
function buildDetail(f: Form): Profile['detail'] {
  switch (f.type) {
    case ProfileType.SOCKS:
    case ProfileType.HTTP:
      return {
        case: 'socksHttp',
        value: create(SocksHttpDetailSchema, {
          proto:
            f.type === ProfileType.HTTP
              ? SocksHttpDetail_Proto.HTTP
              : f.proto === SocksHttpDetail_Proto.UNSPECIFIED
                ? SocksHttpDetail_Proto.SOCKS5
                : f.proto,
          username: f.username,
          password: f.password,
        }),
      };
    case ProfileType.SHADOWSOCKS:
      return {
        case: 'shadowsocks',
        value: create(ShadowsocksDetailSchema, {
          method: f.method,
          password: f.password,
          plugin: f.plugin.trim(),
          udpOverTcp: f.uot,
        }),
      };
    case ProfileType.VMESS:
      return {
        case: 'vmess',
        value: create(VmessDetailSchema, {
          uuid: f.uuid.trim(),
          security: f.security,
          alterId: Number.parseInt(f.alterId, 10) || 0,
        }),
      };
    case ProfileType.VLESS:
    case ProfileType.TROJAN:
      return {
        case: 'trojanVless',
        value: create(TrojanVlessDetailSchema, {
          password: f.password.trim(),
          flow: f.flow,
        }),
      };
    case ProfileType.HYSTERIA2:
      return {
        case: 'hysteria2',
        value: create(Hysteria2DetailSchema, {
          password: f.password,
          obfsPassword: f.obfsPassword,
          uploadMbps: toInt(f.upMbps),
          downloadMbps: toInt(f.downMbps),
          serverPorts: f.serverPorts.trim(),
          hopInterval: f.hopInterval.trim(),
          sni: f.sni.trim(),
          ca: f.ca,
          allowInsecure: f.allowInsecure,
          disableSni: f.disableSni,
        }),
      };
    case ProfileType.TUIC:
      return {
        case: 'tuic',
        value: create(TuicDetailSchema, {
          uuid: f.uuid.trim(),
          password: f.password,
          congestionControl: f.congestion,
          udpRelayMode: f.udpRelay,
          zeroRttHandshake: f.zeroRtt,
          heartbeat: f.heartbeat.trim(),
          sni: f.sni.trim(),
          alpn: f.alpn.trim(),
          ca: f.ca,
          allowInsecure: f.allowInsecure,
          disableSni: f.disableSni,
        }),
      };
    case ProfileType.CHAIN:
      return { case: 'chain', value: create(ChainDetailSchema, { profileIds: f.chain }) };
    case ProfileType.CUSTOM_OUTBOUND:
      return {
        case: 'custom',
        value: create(CustomDetailSchema, {
          core: CustomDetail_Core.INTERNAL,
          outboundJson: f.json.trim(),
        }),
      };
    case ProfileType.CUSTOM_CONFIG:
      return {
        case: 'custom',
        value: create(CustomDetailSchema, {
          core: CustomDetail_Core.INTERNAL_FULL,
          fullConfigJson: f.json.trim(),
        }),
      };
    default:
      return { case: undefined };
  }
}

/** Форма → proto-профиль (detail — ровно один, по типу). */
export function toProfile(f: Form, id: bigint, groupId: bigint): Profile {
  const special = isSpecialType(f.type);
  const endpoint =
    f.type === ProfileType.CUSTOM_OUTBOUND ? jsonEndpoint(f.json) : { address: '', port: 0 };
  const port = Number.parseInt(f.port, 10);
  const base = create(ProfileSchema, {
    id,
    groupId,
    type: f.type,
    name: f.name.trim(),
    address: special ? endpoint.address : f.address.trim(),
    port: special ? endpoint.port : Number.isFinite(port) ? port : 0,
    geo: f.geo.trim().toLowerCase(),
    favorite: false,
    tags: [],
    notes: f.notes.trim(),
  });
  base.detail = buildDetail(f);

  if (isV2rayType(f.type)) {
    base.stream = create(StreamSettingsSchema, {
      network: f.network,
      headerType: '',
      path: f.path,
      host: f.host,
      security: f.tls,
      sni: f.sni,
      alpn: f.alpn,
      allowInsecure: f.allowInsecure,
      certificate: '',
      utlsFingerprint: f.fingerprint,
      realityPublicKey: f.realityPbk.trim() === '' ? undefined : f.realityPbk.trim(),
      realityShortId: f.realitySid.trim() === '' ? undefined : f.realitySid.trim(),
      packetEncoding: StreamSettings_PacketEncoding.DEFAULT,
      multiplex: StreamSettings_MultiplexStatus.MULTIPLEX_DEFAULT,
    });
  }
  return base;
}

type Translate = (key: MessageKey) => string;
type TranslateWith = (key: MessageKey, params: Readonly<Record<string, string | number>>) => string;

/** Проверка формы перед сохранением: ошибки по полям (пусто = можно сохранять). */
export function validateForm(f: Form, t: Translate, tf: TranslateWith): FormErrors {
  const errors: FormErrors = {};
  if (f.name.trim() === '') errors.name = t('ed.required');
  if (!isSpecialType(f.type)) {
    if (f.address.trim() === '') errors.address = t('ed.required');
    const port = Number.parseInt(f.port, 10);
    if (f.port.trim() === '') errors.port = t('ed.required');
    else if (!(port >= 1 && port <= 65535)) errors.port = t('set.portErr');
  }
  if (f.type === ProfileType.CHAIN && f.chain.length < 2) errors.chain = t('ed.chainMin');
  if (isJsonType(f.type)) {
    try {
      const parsed: unknown = JSON.parse(f.json);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        errors.json = t('ed.jsonObj');
      }
    } catch (e) {
      errors.json = tf('ed.jsonErr', { msg: e instanceof Error ? e.message.slice(0, 60) : '' });
    }
  }
  return errors;
}
