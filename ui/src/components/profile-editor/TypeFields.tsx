// TypeFields.tsx — типоспецифичные поля редактора профиля: SOCKS/HTTP,
// Shadowsocks, VMess, VLESS/Trojan, Hysteria2, TUIC, цепочка, «Свой JSON» и
// блок «Транспорт и TLS». Подписи — из словаря (ключи ed.*); технические токены
// (UUID, SNI, ALPN, Flow, Short ID) в словарях одинаковы.
import type { JSX } from 'react';
import {
  ProfileType,
  ShadowsocksDetail_Uot,
  SocksHttpDetail_Proto,
  StreamSettings_Network,
  StreamSettings_Security,
  TuicDetail_CongestionControl,
  TuicDetail_UdpRelayMode,
} from '../../gen/lavray_pb';
import { useI18n } from '../../hooks/useI18n';
import { ChainField } from './ChainField';
import { SelectField, SwitchField, TextAreaField, TextField } from './fields';
import type { Option } from './fields';
import { isV2rayType } from './form';
import type { Form, FormErrors } from './form';

export type SetField = <K extends keyof Form>(key: K, value: Form[K]) => void;

type StringKey = { [K in keyof Form]: Form[K] extends string ? K : never }[keyof Form];
type BoolKey = { [K in keyof Form]: Form[K] extends boolean ? K : never }[keyof Form];

/** Пропсы value/onChange текстового поля формы. */
function text(f: Form, set: SetField, key: StringKey): { value: string; onChange: (v: string) => void } {
  return {
    value: f[key],
    onChange: (v: string): void => {
      set(key, v);
    },
  };
}

/** Пропсы checked/onChange переключателя формы. */
function flag(f: Form, set: SetField, key: BoolKey): { checked: boolean; onChange: (v: boolean) => void } {
  return {
    checked: f[key],
    onChange: (v: boolean): void => {
      set(key, v);
    },
  };
}

const plain = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: v }));

const SS_METHODS = plain([
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  'xchacha20-ietf-poly1305',
  'none',
]);

const VMESS_CIPHERS = plain(['auto', 'none', 'zero', 'aes-128-gcm', 'chacha20-poly1305']);

const SOCKS_VERSIONS: readonly Option<SocksHttpDetail_Proto>[] = [
  { value: SocksHttpDetail_Proto.SOCKS4, label: 'SOCKS4' },
  { value: SocksHttpDetail_Proto.SOCKS5, label: 'SOCKS5' },
];

const NETWORKS: readonly Option<StreamSettings_Network>[] = [
  { value: StreamSettings_Network.TCP, label: 'TCP' },
  { value: StreamSettings_Network.WS, label: 'WebSocket' },
  { value: StreamSettings_Network.GRPC, label: 'gRPC' },
  { value: StreamSettings_Network.HTTP, label: 'HTTP/2' },
  { value: StreamSettings_Network.HTTP_UPGRADE, label: 'HTTPUpgrade' },
];

const SECURITIES: readonly Option<StreamSettings_Security>[] = [
  { value: StreamSettings_Security.NONE, label: 'none' },
  { value: StreamSettings_Security.TLS, label: 'TLS' },
  { value: StreamSettings_Security.REALITY, label: 'REALITY' },
];

const CONGESTIONS: readonly Option<TuicDetail_CongestionControl>[] = [
  { value: TuicDetail_CongestionControl.BBR, label: 'bbr' },
  { value: TuicDetail_CongestionControl.CUBIC, label: 'cubic' },
  { value: TuicDetail_CongestionControl.NEW_RENO, label: 'new_reno' },
];

const UDP_RELAYS: readonly Option<TuicDetail_UdpRelayMode>[] = [
  { value: TuicDetail_UdpRelayMode.NATIVE, label: 'native' },
  { value: TuicDetail_UdpRelayMode.QUIC, label: 'quic' },
];

const FLOWS: readonly Option[] = [
  { value: '', label: '—' },
  { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
];

interface BlockProps {
  readonly f: Form;
  readonly set: SetField;
}

function SocksHttpFields({ f, set }: BlockProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="form-grid">
      {f.type === ProfileType.SOCKS && (
        <SelectField
          id="edf-socks"
          label="SOCKS"
          value={f.proto}
          options={SOCKS_VERSIONS}
          onChange={(v) => {
            set('proto', v);
          }}
        />
      )}
      <TextField id="edf-username" label={t('ed.username')} {...text(f, set, 'username')} />
      <TextField id="edf-password" label={t('ed.password')} password {...text(f, set, 'password')} />
    </div>
  );
}

function ShadowsocksFields({ f, set }: BlockProps): JSX.Element {
  const { t } = useI18n();
  const uot: readonly Option<ShadowsocksDetail_Uot>[] = [
    { value: ShadowsocksDetail_Uot.OFF, label: t('ed.off') },
    { value: ShadowsocksDetail_Uot.V1, label: 'v1' },
    { value: ShadowsocksDetail_Uot.V2, label: 'v2' },
  ];
  return (
    <div className="form-grid">
      <SelectField
        id="edf-method"
        label={t('ed.method')}
        options={SS_METHODS}
        {...text(f, set, 'method')}
      />
      <TextField id="edf-password" label={t('ed.password')} password {...text(f, set, 'password')} />
      <TextField
        id="edf-plugin"
        label={t('ed.plugin')}
        mono
        placeholder="obfs-local;obfs=http;obfs-host=example.org"
        {...text(f, set, 'plugin')}
      />
      <SelectField
        id="edf-uot"
        label={t('ed.uot')}
        value={f.uot}
        options={uot}
        onChange={(v) => {
          set('uot', v);
        }}
      />
    </div>
  );
}

function VmessFields({ f, set }: BlockProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="form-grid">
      <TextField id="edf-uuid" label={t('ed.uuid')} mono {...text(f, set, 'uuid')} />
      <TextField id="edf-alterId" label={t('ed.alterId')} mono numeric {...text(f, set, 'alterId')} />
      <SelectField
        id="edf-cipher"
        label={t('ed.cipher')}
        options={VMESS_CIPHERS}
        {...text(f, set, 'security')}
      />
    </div>
  );
}

function VlessTrojanFields({ f, set }: BlockProps): JSX.Element {
  const { t } = useI18n();
  const vless = f.type === ProfileType.VLESS;
  return (
    <div className="form-grid">
      <TextField
        id="edf-secret"
        label={vless ? t('ed.uuid') : t('ed.password')}
        mono
        password={!vless}
        {...text(f, set, 'password')}
      />
      {vless && <SelectField id="edf-flow" label={t('ed.flow')} options={FLOWS} {...text(f, set, 'flow')} />}
    </div>
  );
}

/** Общие для Hysteria2 и TUIC поля TLS: SNI, CA, «не проверять сертификат», «не слать SNI». */
function QuicTlsFields({ f, set }: BlockProps): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <TextField id="edf-sni" label={t('ed.sni')} mono {...text(f, set, 'sni')} />
      <TextAreaField id="edf-ca" label={t('ed.ca')} rows={3} wide {...text(f, set, 'ca')} />
      <SwitchField
        id="edf-insecure"
        label={t('ed.insecure')}
        hint={f.allowInsecure ? t('ed.insecureHint') : undefined}
        {...flag(f, set, 'allowInsecure')}
      />
      <SwitchField id="edf-disableSni" label={t('ed.disableSni')} {...flag(f, set, 'disableSni')} />
    </>
  );
}

function Hysteria2Fields({ f, set }: BlockProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="form-grid">
      <TextField id="edf-password" label={t('ed.password')} password {...text(f, set, 'password')} />
      <TextField id="edf-obfs" label={t('ed.obfsPassword')} password {...text(f, set, 'obfsPassword')} />
      <TextField id="edf-up" label={t('ed.upMbps')} mono numeric {...text(f, set, 'upMbps')} />
      <TextField id="edf-down" label={t('ed.downMbps')} mono numeric {...text(f, set, 'downMbps')} />
      <TextField
        id="edf-ports"
        label={t('ed.hopPorts')}
        mono
        placeholder="20000:30000"
        {...text(f, set, 'serverPorts')}
      />
      <TextField
        id="edf-hop"
        label={t('ed.hopInterval')}
        mono
        placeholder="30s"
        {...text(f, set, 'hopInterval')}
      />
      <QuicTlsFields f={f} set={set} />
    </div>
  );
}

function TuicFields({ f, set }: BlockProps): JSX.Element {
  const { t } = useI18n();
  // «Не задано» в контракте = bbr / native: показываем их, пока значение не выбрано.
  const congestion =
    f.congestion === TuicDetail_CongestionControl.UNSPECIFIED
      ? TuicDetail_CongestionControl.BBR
      : f.congestion;
  const relay =
    f.udpRelay === TuicDetail_UdpRelayMode.UNSPECIFIED ? TuicDetail_UdpRelayMode.NATIVE : f.udpRelay;
  return (
    <div className="form-grid">
      <TextField id="edf-uuid" label={t('ed.uuid')} mono {...text(f, set, 'uuid')} />
      <TextField id="edf-password" label={t('ed.password')} password {...text(f, set, 'password')} />
      <SelectField
        id="edf-congestion"
        label={t('ed.congestion')}
        value={congestion}
        options={CONGESTIONS}
        onChange={(v) => {
          set('congestion', v);
        }}
      />
      <SelectField
        id="edf-relay"
        label={t('ed.udpRelay')}
        value={relay}
        options={UDP_RELAYS}
        onChange={(v) => {
          set('udpRelay', v);
        }}
      />
      <TextField
        id="edf-heartbeat"
        label={t('ed.heartbeat')}
        mono
        placeholder="10s"
        {...text(f, set, 'heartbeat')}
      />
      <TextField id="edf-alpn" label={t('ed.alpn')} mono placeholder="h3" {...text(f, set, 'alpn')} />
      <SwitchField id="edf-zeroRtt" label={t('ed.zeroRtt')} {...flag(f, set, 'zeroRtt')} />
      <QuicTlsFields f={f} set={set} />
    </div>
  );
}

function JsonFields({ f, set, errors }: BlockProps & { readonly errors: FormErrors }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="form-grid">
      <TextAreaField
        id="edf-json"
        label={f.type === ProfileType.CUSTOM_CONFIG ? t('ed.jsonFull') : t('ed.json')}
        rows={8}
        wide
        error={errors.json}
        {...text(f, set, 'json')}
      />
    </div>
  );
}

function TransportFold({ f, set }: BlockProps): JSX.Element {
  const { t } = useI18n();
  const hasPath =
    f.network === StreamSettings_Network.WS ||
    f.network === StreamSettings_Network.HTTP ||
    f.network === StreamSettings_Network.HTTP_UPGRADE;
  return (
    <details className="fold" open>
      <summary>
        <span className="cap">{t('ed.transportTls')}</span>
      </summary>
      <div className="form-grid">
        <SelectField
          id="edf-network"
          label={t('ed.transport')}
          value={f.network}
          options={NETWORKS}
          onChange={(v) => {
            set('network', v);
          }}
        />
        <SelectField
          id="edf-tls"
          label={t('ed.security')}
          value={f.tls}
          options={SECURITIES}
          onChange={(v) => {
            set('tls', v);
          }}
        />
        <TextField id="edf-sni" label={t('ed.sni')} mono {...text(f, set, 'sni')} />
        <TextField id="edf-alpn" label={t('ed.alpn')} mono placeholder="h2,http/1.1" {...text(f, set, 'alpn')} />
        {hasPath && (
          <>
            <TextField id="edf-path" label={t('ed.path')} mono {...text(f, set, 'path')} />
            <TextField id="edf-host" label={t('ed.host')} mono {...text(f, set, 'host')} />
          </>
        )}
        {f.tls === StreamSettings_Security.REALITY && (
          <>
            <TextField id="edf-pbk" label={t('ed.publicKey')} mono {...text(f, set, 'realityPbk')} />
            <TextField id="edf-sid" label={t('ed.shortId')} mono {...text(f, set, 'realitySid')} />
          </>
        )}
        <TextField id="edf-utls" label={t('ed.utls')} mono placeholder="chrome" {...text(f, set, 'fingerprint')} />
        <SwitchField
          id="edf-insecure"
          label={t('ed.insecure')}
          hint={f.allowInsecure ? t('ed.insecureHint') : undefined}
          {...flag(f, set, 'allowInsecure')}
        />
      </div>
    </details>
  );
}

interface Props extends BlockProps {
  readonly errors: FormErrors;
  /** id редактируемого профиля (0n у нового): его нельзя добавить в узлы цепочки. */
  readonly selfId: bigint;
}

export function TypeFields({ f, set, errors, selfId }: Props): JSX.Element {
  return (
    <>
      {(f.type === ProfileType.SOCKS || f.type === ProfileType.HTTP) && <SocksHttpFields f={f} set={set} />}
      {f.type === ProfileType.SHADOWSOCKS && <ShadowsocksFields f={f} set={set} />}
      {f.type === ProfileType.VMESS && <VmessFields f={f} set={set} />}
      {(f.type === ProfileType.VLESS || f.type === ProfileType.TROJAN) && (
        <VlessTrojanFields f={f} set={set} />
      )}
      {f.type === ProfileType.HYSTERIA2 && <Hysteria2Fields f={f} set={set} />}
      {f.type === ProfileType.TUIC && <TuicFields f={f} set={set} />}
      {f.type === ProfileType.CHAIN && (
        <div className="form-grid">
          <ChainField
            value={f.chain}
            selfId={selfId}
            error={errors.chain}
            onChange={(ids) => {
              set('chain', ids);
            }}
          />
        </div>
      )}
      {(f.type === ProfileType.CUSTOM_OUTBOUND || f.type === ProfileType.CUSTOM_CONFIG) && (
        <JsonFields f={f} set={set} errors={errors} />
      )}
      {isV2rayType(f.type) && <TransportFold f={f} set={set} />}
    </>
  );
}
