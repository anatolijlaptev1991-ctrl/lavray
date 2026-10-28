// profile_editor.tsx — редактор профиля (FR-UI-080…099, 33 FR):
// создание/правка сервера, типоспецифичные поля по типу, транспорт и TLS
// (ws/grpc/http/h2, REALITY), название/группа/заметки.
// Реализованы все внутренние типы; Naive/внешние ядра скрыты флагом ядра.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { create } from '@bufbuild/protobuf';
import {
  Hysteria2DetailSchema,
  ProfileSchema,
  ProfileType,
  ShadowsocksDetailSchema,
  SocksHttpDetailSchema,
  StreamSettingsSchema,
  TrojanVlessDetailSchema,
  TuicDetailSchema,
  VmessDetailSchema,
  ShadowsocksDetail_Uot,
  SocksHttpDetail_Proto,
  StreamSettings_MultiplexStatus,
  StreamSettings_Network,
  StreamSettings_PacketEncoding,
  StreamSettings_Security,
} from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { friendlyCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { Icon } from '../components/Icon';

interface Props {
  readonly profile: Profile | null; // null = создание
  readonly groupId: bigint;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

interface Form {
  type: ProfileType;
  name: string;
  address: string;
  port: string;
  geo: string;
  notes: string;
  // детали
  proto: SocksHttpDetail_Proto;
  username: string;
  password: string;
  method: string;
  uuid: string;
  security: string;
  alterId: string;
  flow: string;
  // транспорт
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
}

const TYPE_OPTIONS: readonly { value: ProfileType; label: string }[] = [
  { value: ProfileType.SOCKS, label: 'SOCKS' },
  { value: ProfileType.HTTP, label: 'HTTP' },
  { value: ProfileType.SHADOWSOCKS, label: 'Shadowsocks' },
  { value: ProfileType.VMESS, label: 'VMess' },
  { value: ProfileType.VLESS, label: 'VLESS' },
  { value: ProfileType.TROJAN, label: 'Trojan' },
  { value: ProfileType.HYSTERIA2, label: 'Hysteria2' },
  { value: ProfileType.TUIC, label: 'TUIC' },
];

const SS_METHODS = [
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  'xchacha20-ietf-poly1305',
  'none',
];

interface ProtoOption {
  readonly value: SocksHttpDetail_Proto;
  readonly label: string;
}

const PROTO_OPTIONS: readonly ProtoOption[] = [
  { value: SocksHttpDetail_Proto.SOCKS4, label: 'SOCKS4' },
  { value: SocksHttpDetail_Proto.SOCKS5, label: 'SOCKS5' },
];

interface TlsOption {
  readonly value: StreamSettings_Security;
  readonly label: string;
}

const TLS_OPTIONS: readonly TlsOption[] = [
  { value: StreamSettings_Security.NONE, label: 'none' },
  { value: StreamSettings_Security.TLS, label: 'TLS' },
  { value: StreamSettings_Security.REALITY, label: 'REALITY' },
];

const NETWORKS: readonly { value: StreamSettings_Network; label: string }[] = [
  { value: StreamSettings_Network.TCP, label: 'TCP' },
  { value: StreamSettings_Network.WS, label: 'WebSocket' },
  { value: StreamSettings_Network.GRPC, label: 'gRPC' },
  { value: StreamSettings_Network.HTTP, label: 'HTTP/2' },
  { value: StreamSettings_Network.HTTP_UPGRADE, label: 'HTTPUpgrade' },
];

function emptyForm(type: ProfileType): Form {
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
    uuid: '',
    security: 'auto',
    alterId: '0',
    flow: '',
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
  };
}

function fromProfile(p: Profile): Form {
  const f = emptyForm(p.type);
  f.name = p.name;
  f.address = p.address;
  f.port = String(p.port);
  f.geo = p.geo;
  f.notes = p.notes ?? '';
  const d = p.detail;
  {
    switch (d.case) {
      case 'socksHttp':
        f.proto = d.value.proto;
        f.username = d.value.username ?? '';
        f.password = d.value.password ?? '';
        break;
      case 'shadowsocks':
        f.method = d.value.method;
        f.password = d.value.password ?? '';
        break;
      case 'vmess':
        f.uuid = d.value.uuid;
        f.security = d.value.security;
        f.alterId = String(d.value.alterId);
        break;
      case 'trojanVless':
        f.password = d.value.password;
        f.flow = d.value.flow ?? '';
        break;
      case 'hysteria2':
        f.password = d.value.password ?? '';
        f.sni = d.value.sni ?? '';
        f.allowInsecure = d.value.allowInsecure ?? false;
        break;
      case 'tuic':
        f.uuid = d.value.uuid;
        f.password = d.value.password ?? '';
        break;
      default:
        break;
    }
  }
  if (p.stream !== undefined) {
    f.network = p.stream.network;
    f.tls = p.stream.security;
    f.sni = p.stream.sni;
    f.alpn = p.stream.alpn;
    f.host = p.stream.host;
    f.path = p.stream.path;
    f.fingerprint = p.stream.utlsFingerprint;
    f.realityPbk = p.stream.realityPublicKey ?? '';
    f.realitySid = p.stream.realityShortId ?? '';
    f.allowInsecure = p.stream.allowInsecure;
  }
  return f;
}

/** Форма → proto-профиль (detail — ровно один, по типу). */
function toProfile(f: Form, id: bigint, groupId: bigint): Profile {
  const port = Number.parseInt(f.port, 10);
  const base = create(ProfileSchema, {
    id,
    groupId,
    type: f.type,
    name: f.name.trim(),
    address: f.address.trim(),
    port: Number.isFinite(port) ? port : 0,
    geo: f.geo.trim().toLowerCase(),
    favorite: false,
    tags: [],
    // создано вручную — custom-поля можно применять без diff-подтверждения
    customFieldsConfirmed: true,
    notes: f.notes.trim(),
  });

  switch (f.type) {
    case ProfileType.SOCKS:
    case ProfileType.HTTP:
      base.detail = {
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
      break;
    case ProfileType.SHADOWSOCKS:
      base.detail = {
        case: 'shadowsocks',
        value: create(ShadowsocksDetailSchema, {
          method: f.method,
          password: f.password,
          udpOverTcp: ShadowsocksDetail_Uot.OFF,
        }),
      };
      break;
    case ProfileType.VMESS:
      base.detail = {
        case: 'vmess',
        value: create(VmessDetailSchema, {
          uuid: f.uuid.trim(),
          security: f.security,
          alterId: Number.parseInt(f.alterId, 10) || 0,
        }),
      };
      break;
    case ProfileType.VLESS:
    case ProfileType.TROJAN:
      base.detail = {
        case: 'trojanVless',
        value: create(TrojanVlessDetailSchema, {
          password: f.password.trim(),
          flow: f.flow === '' ? undefined : f.flow,
        }),
      };
      break;
    case ProfileType.HYSTERIA2:
      base.detail = {
        case: 'hysteria2',
        value: create(Hysteria2DetailSchema, {
          password: f.password,
          sni: f.sni === '' ? undefined : f.sni,
          allowInsecure: f.allowInsecure,
        }),
      };
      break;
    case ProfileType.TUIC:
      base.detail = {
        case: 'tuic',
        value: create(TuicDetailSchema, {
          uuid: f.uuid.trim(),
          password: f.password,
        }),
      };
      break;
    default:
      break;
  }

  const v2ray =
    f.type === ProfileType.VMESS ||
    f.type === ProfileType.VLESS ||
    f.type === ProfileType.TROJAN ||
    f.type === ProfileType.SOCKS ||
    f.type === ProfileType.HTTP;
  if (v2ray) {
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

export function ProfileEditor({ profile, groupId, onClose, onSaved }: Props): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const [f, setF] = useState<Form>(() => (profile === null ? emptyForm(ProfileType.VMESS) : fromProfile(profile)));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setF(profile === null ? emptyForm(ProfileType.VMESS) : fromProfile(profile));
  }, [profile]);

  const set = useCallback(<K extends keyof Form>(key: K, value: Form[K]): void => {
    setF((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isV2ray = useMemo(
    () =>
      f.type === ProfileType.VMESS ||
      f.type === ProfileType.VLESS ||
      f.type === ProfileType.TROJAN ||
      f.type === ProfileType.SOCKS ||
      f.type === ProfileType.HTTP,
    [f.type],
  );

  const save = useCallback(async (): Promise<void> => {
    setErr('');
    if (f.name.trim() === '' || f.address.trim() === '' || f.port.trim() === '') {
      setErr(t('srv.empty.d'));
      return;
    }
    setBusy(true);
    try {
      const model = toProfile(f, profile?.id ?? 0n, groupId);
      if (profile === null) {
        await core.profiles.createProfile({ profile: model });
      } else {
        // D1 (аудит round 2): UpdateProfile — ПОЛНАЯ замена. Переносим
        // серверные/пользовательские метаданные из исходного профиля, иначе
        // пропадали избранное, теги, custom-поля и профиль уезжал в чужую
        // группу.
        // PE-01 (аудит round 3): UpdateProfile — полная замена. Сохраняем
        // поля, которых нет в форме: у TUIC — congestion/udp-relay/CA,
        // у stream — header_type/early-data/certificate/packet_encoding/
        // multiplex. Иначе они молча терялись при любом редактировании.
        const keepDetail = ((): Profile['detail'] => {
          if (profile.detail.case !== model.detail.case) return model.detail;
          if (profile.detail.case === 'tuic' && model.detail.case === 'tuic') {
            return {
              case: 'tuic',
              value: create(TuicDetailSchema, {
                ...profile.detail.value,
                ...model.detail.value,
              }),
            };
          }
          return model.detail;
        })();
        const keepStream =
          profile.stream === undefined
            ? model.stream
            : model.stream === undefined
              ? profile.stream
              : create(StreamSettingsSchema, {
                  ...profile.stream,
                  ...model.stream,
                  // Пустые значения формы не должны стирать сохранённые.
                  certificate: model.stream.certificate === ''
                    ? profile.stream.certificate
                    : model.stream.certificate,
                  headerType:
                    model.stream.headerType === ''
                      ? profile.stream.headerType
                      : model.stream.headerType,
                });
        const merged = create(ProfileSchema, {
          ...model,
          detail: keepDetail,
          stream: keepStream,
          groupId: profile.groupId,
          favorite: profile.favorite,
          tags: profile.tags,
          customOutboundJson: profile.customOutboundJson,
          customConfigJson: profile.customConfigJson,
          customFieldsConfirmed: profile.customFieldsConfirmed,
        });
        await core.profiles.updateProfile({ profile: merged });
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(friendlyCoreError(e));
    } finally {
      setBusy(false);
    }
  }, [core, f, profile, groupId, onSaved, onClose, t]);

  return (
    <div className="dlg-back open" role="presentation" onClick={onClose}>
      <div
        className="dlg dlg-lg"
        role="dialog"
        aria-modal="true"
        aria-label={profile === null ? t('quick.import') : t('common.edit')}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="dlg-h">
          <h2>{profile === null ? t('quick.import') : t('common.edit')}</h2>
          <button className="btn btn-ic btn-sm" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        {err !== '' && (
          <div className="banner banner-err" role="alert">
            <span className="ic">
              <Icon name="alert" />
            </span>
            <div className="bn-t">{err}</div>
          </div>
        )}

        <div className="dlg-b">
          <div className="form-grid">
            <label className="field">
              <span className="cap">{t('srv.type')}</span>
              <select
                className="select"
                value={String(f.type)}
                disabled={profile !== null}
                onChange={(e) => {
                  const chosen = TYPE_OPTIONS.find((o) => String(o.value) === e.target.value);
                  if (chosen !== undefined) set('type', chosen.value);
                }}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.label} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="cap">{t('imp.name')}</span>
              <input
                className="input"
                value={f.name}
                onChange={(e) => {
                  set('name', e.target.value);
                }}
              />
            </label>

            <label className="field">
              <span className="cap">{t('set.addr')}</span>
              <input
                className="input mono"
                value={f.address}
                placeholder="example.org"
                onChange={(e) => {
                  set('address', e.target.value);
                }}
              />
            </label>

            <label className="field">
              <span className="cap">{t('set.port')}</span>
              <input
                className="input mono"
                inputMode="numeric"
                value={f.port}
                placeholder="443"
                onChange={(e) => {
                  set('port', e.target.value.replace(/\D/g, ''));
                }}
              />
            </label>
          </div>

          {/* ---- Типоспецифичные поля ---- */}
          {(f.type === ProfileType.SOCKS || f.type === ProfileType.HTTP) && (
            <div className="form-grid">
              {f.type === ProfileType.SOCKS && (
                <label className="field">
                  <span className="cap">SOCKS</span>
                  <select
                    className="select"
                    value={String(f.proto)}
                    onChange={(e) => {
                      const chosen = PROTO_OPTIONS.find((o) => String(o.value) === e.target.value);
                      if (chosen !== undefined) set('proto', chosen.value);
                    }}
                  >
                    {PROTO_OPTIONS.map((o) => (
                      <option key={o.label} value={String(o.value)}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                <span className="cap">{t('set.login')}</span>
                <input
                  className="input"
                  value={f.username}
                  autoComplete="off"
                  onChange={(e) => {
                    set('username', e.target.value);
                  }}
                />
              </label>
              <label className="field">
                <span className="cap">{t('set.password')}</span>
                <input
                  className="input"
                  type="password"
                  value={f.password}
                  autoComplete="new-password"
                  onChange={(e) => {
                    set('password', e.target.value);
                  }}
                />
              </label>
            </div>
          )}

          {f.type === ProfileType.SHADOWSOCKS && (
            <div className="form-grid">
              <label className="field">
                <span className="cap">Method</span>
                <select
                  className="select"
                  value={f.method}
                  onChange={(e) => {
                    set('method', e.target.value);
                  }}
                >
                  {SS_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="cap">{t('set.password')}</span>
                <input
                  className="input"
                  type="password"
                  value={f.password}
                  autoComplete="new-password"
                  onChange={(e) => {
                    set('password', e.target.value);
                  }}
                />
              </label>
            </div>
          )}

          {f.type === ProfileType.VMESS && (
            <div className="form-grid">
              <label className="field">
                <span className="cap">UUID</span>
                <input
                  className="input mono"
                  value={f.uuid}
                  onChange={(e) => {
                    set('uuid', e.target.value);
                  }}
                />
              </label>
              <label className="field">
                <span className="cap">Alter ID</span>
                <input
                  className="input mono"
                  inputMode="numeric"
                  value={f.alterId}
                  onChange={(e) => {
                    set('alterId', e.target.value.replace(/\D/g, ''));
                  }}
                />
              </label>
              <label className="field">
                <span className="cap">Security</span>
                <select
                  className="select"
                  value={f.security}
                  onChange={(e) => {
                    set('security', e.target.value);
                  }}
                >
                  {['auto', 'none', 'zero', 'aes-128-gcm', 'chacha20-poly1305'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {(f.type === ProfileType.VLESS || f.type === ProfileType.TROJAN) && (
            <div className="form-grid">
              <label className="field">
                <span className="cap">{f.type === ProfileType.VLESS ? 'UUID' : t('set.password')}</span>
                <input
                  className="input mono"
                  type={f.type === ProfileType.VLESS ? 'text' : 'password'}
                  value={f.password}
                  autoComplete="new-password"
                  onChange={(e) => {
                    set('password', e.target.value);
                  }}
                />
              </label>
              {f.type === ProfileType.VLESS && (
                <label className="field">
                  <span className="cap">Flow</span>
                  <select
                    className="select"
                    value={f.flow}
                    onChange={(e) => {
                      set('flow', e.target.value);
                    }}
                  >
                    <option value="">—</option>
                    <option value="xtls-rprx-vision">xtls-rprx-vision</option>
                  </select>
                </label>
              )}
            </div>
          )}

          {f.type === ProfileType.TUIC && (
            <div className="form-grid">
              <label className="field">
                <span className="cap">UUID</span>
                <input
                  className="input mono"
                  value={f.uuid}
                  onChange={(e) => {
                    set('uuid', e.target.value);
                  }}
                />
              </label>
              <label className="field">
                <span className="cap">{t('set.password')}</span>
                <input
                  className="input"
                  type="password"
                  value={f.password}
                  autoComplete="new-password"
                  onChange={(e) => {
                    set('password', e.target.value);
                  }}
                />
              </label>
            </div>
          )}

          {f.type === ProfileType.HYSTERIA2 && (
            <div className="form-grid">
              <label className="field">
                <span className="cap">{t('set.password')}</span>
                <input
                  className="input"
                  type="password"
                  value={f.password}
                  autoComplete="new-password"
                  onChange={(e) => {
                    set('password', e.target.value);
                  }}
                />
              </label>
              <label className="field">
                <span className="cap">SNI</span>
                <input
                  className="input mono"
                  value={f.sni}
                  onChange={(e) => {
                    set('sni', e.target.value);
                  }}
                />
              </label>
            </div>
          )}

          {/* ---- Транспорт/TLS (v2ray-подобные) ---- */}
          {isV2ray && (
            <details className="fold" open>
              <summary>
                <span className="cap">Transport / TLS</span>
              </summary>
              <div className="form-grid">
                <label className="field">
                  <span className="cap">Network</span>
                  <select
                    className="select"
                    value={String(f.network)}
                    onChange={(e) => {
                      const chosen = NETWORKS.find((n) => String(n.value) === e.target.value);
                      if (chosen !== undefined) set('network', chosen.value);
                    }}
                  >
                    {NETWORKS.map((n) => (
                      <option key={n.label} value={String(n.value)}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="cap">Security</span>
                  <select
                    className="select"
                    value={String(f.tls)}
                    onChange={(e) => {
                      const chosen = TLS_OPTIONS.find((o) => String(o.value) === e.target.value);
                      if (chosen !== undefined) set('tls', chosen.value);
                    }}
                  >
                    {TLS_OPTIONS.map((o) => (
                      <option key={o.label} value={String(o.value)}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="cap">SNI</span>
                  <input
                    className="input mono"
                    value={f.sni}
                    onChange={(e) => {
                      set('sni', e.target.value);
                    }}
                  />
                </label>
                <label className="field">
                  <span className="cap">ALPN</span>
                  <input
                    className="input mono"
                    placeholder="h2,http/1.1"
                    value={f.alpn}
                    onChange={(e) => {
                      set('alpn', e.target.value);
                    }}
                  />
                </label>
                {(f.network === StreamSettings_Network.WS ||
                  f.network === StreamSettings_Network.HTTP ||
                  f.network === StreamSettings_Network.HTTP_UPGRADE) && (
                  <>
                    <label className="field">
                      <span className="cap">Path</span>
                      <input
                        className="input mono"
                        value={f.path}
                        onChange={(e) => {
                          set('path', e.target.value);
                        }}
                      />
                    </label>
                    <label className="field">
                      <span className="cap">Host</span>
                      <input
                        className="input mono"
                        value={f.host}
                        onChange={(e) => {
                          set('host', e.target.value);
                        }}
                      />
                    </label>
                  </>
                )}
                {f.tls === StreamSettings_Security.REALITY && (
                  <>
                    <label className="field">
                      <span className="cap">Public key</span>
                      <input
                        className="input mono"
                        value={f.realityPbk}
                        onChange={(e) => {
                          set('realityPbk', e.target.value);
                        }}
                      />
                    </label>
                    <label className="field">
                      <span className="cap">Short ID</span>
                      <input
                        className="input mono"
                        value={f.realitySid}
                        onChange={(e) => {
                          set('realitySid', e.target.value);
                        }}
                      />
                    </label>
                  </>
                )}
                <label className="field">
                  <span className="cap">uTLS</span>
                  <input
                    className="input mono"
                    placeholder="chrome"
                    value={f.fingerprint}
                    onChange={(e) => {
                      set('fingerprint', e.target.value);
                    }}
                  />
                </label>
              </div>
            </details>
          )}

          <label className="field">
            <span className="cap">{t('srv.details')}</span>
            <textarea
              className="input"
              rows={2}
              value={f.notes}
              onChange={(e) => {
                set('notes', e.target.value);
              }}
            />
          </label>
        </div>

        <div className="dlg-f">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-pri" disabled={busy} onClick={() => void save()}>
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
