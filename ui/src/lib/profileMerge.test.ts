// SPDX-License-Identifier: GPL-3.0-only

// profileMerge.test.ts — T-10 (F-006, B1-01): значения формы накладываются на
// исходный профиль, поля вне формы не стираются, а поля формы можно очистить.
import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  Hysteria2DetailSchema,
  ShadowsocksDetail_Uot,
  ShadowsocksDetailSchema,
  StreamSettings_MultiplexStatus,
  StreamSettings_Network,
  StreamSettings_PacketEncoding,
  StreamSettings_Security,
  StreamSettingsSchema,
  TrojanVlessDetailSchema,
  TuicDetail_CongestionControl,
  TuicDetail_UdpRelayMode,
  TuicDetailSchema,
} from '../gen/lavray_pb';
import { mergeDetail, mergeStream } from './profileMerge';

describe('mergeDetail', () => {
  it('Hysteria2: obfs, порты, скорости, CA и флаги вне формы сохраняются; пароль из формы применяется', () => {
    const old = {
      case: 'hysteria2' as const,
      value: create(Hysteria2DetailSchema, {
        password: 'old-pass',
        obfsPassword: 'salamander-secret',
        serverPorts: '20000:30000',
        hopInterval: '30s',
        uploadMbps: 50,
        downloadMbps: 200,
        sni: 'old.example.org',
        ca: '-----BEGIN CERTIFICATE-----',
        allowInsecure: true,
        disableSni: true,
      }),
    };
    // то, что собирает форма: пароль и SNI (пустой SNI = undefined)
    const fromForm = {
      case: 'hysteria2' as const,
      value: create(Hysteria2DetailSchema, { password: 'new-pass', sni: undefined, allowInsecure: false }),
    };
    const merged = mergeDetail(old, fromForm);
    expect(merged.case).toBe('hysteria2');
    if (merged.case !== 'hysteria2') return;
    expect(merged.value.password).toBe('new-pass');
    expect(merged.value.sni, 'очищенное в форме поле очищается').toBeUndefined();
    expect(merged.value.obfsPassword).toBe('salamander-secret');
    expect(merged.value.serverPorts).toBe('20000:30000');
    expect(merged.value.hopInterval).toBe('30s');
    expect(merged.value.uploadMbps).toBe(50);
    expect(merged.value.downloadMbps).toBe(200);
    expect(merged.value.ca).toBe('-----BEGIN CERTIFICATE-----');
    expect(merged.value.disableSni).toBe(true);
    expect(merged.value.allowInsecure, 'allow_insecure в форме нет — остаётся исходное').toBe(true);
  });

  it('Shadowsocks: plugin и UDP-over-TCP сохраняются; метод и пароль из формы применяются', () => {
    const old = {
      case: 'shadowsocks' as const,
      value: create(ShadowsocksDetailSchema, {
        method: 'aes-128-gcm',
        password: 'old',
        plugin: 'obfs-local;obfs=http;obfs-host=example.com',
        udpOverTcp: ShadowsocksDetail_Uot.V2,
      }),
    };
    const fromForm = {
      case: 'shadowsocks' as const,
      value: create(ShadowsocksDetailSchema, {
        method: '2022-blake3-aes-128-gcm',
        password: 'new',
        udpOverTcp: ShadowsocksDetail_Uot.OFF,
      }),
    };
    const merged = mergeDetail(old, fromForm);
    if (merged.case !== 'shadowsocks') throw new Error('ожидался shadowsocks');
    expect(merged.value.method).toBe('2022-blake3-aes-128-gcm');
    expect(merged.value.password).toBe('new');
    expect(merged.value.plugin).toBe('obfs-local;obfs=http;obfs-host=example.com');
    expect(merged.value.udpOverTcp).toBe(ShadowsocksDetail_Uot.V2);
  });

  it('TUIC: congestion, udp relay, 0-RTT, heartbeat, CA сохраняются; UUID и пароль из формы применяются', () => {
    const old = {
      case: 'tuic' as const,
      value: create(TuicDetailSchema, {
        uuid: 'old-uuid',
        password: 'old',
        congestionControl: TuicDetail_CongestionControl.CUBIC,
        udpRelayMode: TuicDetail_UdpRelayMode.QUIC,
        zeroRttHandshake: true,
        heartbeat: '10s',
        sni: 'tuic.example.org',
        alpn: 'h3',
        ca: 'CA',
        allowInsecure: true,
        disableSni: false,
        udpOverStream: true,
      }),
    };
    const fromForm = {
      case: 'tuic' as const,
      value: create(TuicDetailSchema, { uuid: 'new-uuid', password: 'new' }),
    };
    const merged = mergeDetail(old, fromForm);
    if (merged.case !== 'tuic') throw new Error('ожидался tuic');
    expect(merged.value.uuid).toBe('new-uuid');
    expect(merged.value.password).toBe('new');
    expect(merged.value.congestionControl).toBe(TuicDetail_CongestionControl.CUBIC);
    expect(merged.value.udpRelayMode).toBe(TuicDetail_UdpRelayMode.QUIC);
    expect(merged.value.zeroRttHandshake).toBe(true);
    expect(merged.value.heartbeat).toBe('10s');
    expect(merged.value.sni).toBe('tuic.example.org');
    expect(merged.value.alpn).toBe('h3');
    expect(merged.value.ca).toBe('CA');
    expect(merged.value.allowInsecure).toBe(true);
    expect(merged.value.udpOverStream).toBe(true);
  });

  it('VLESS/Trojan: в форме все поля сообщения — берётся значение формы', () => {
    const old = {
      case: 'trojanVless' as const,
      value: create(TrojanVlessDetailSchema, { password: 'old', flow: 'xtls-rprx-vision' }),
    };
    const fromForm = {
      case: 'trojanVless' as const,
      value: create(TrojanVlessDetailSchema, { password: 'new', flow: undefined }),
    };
    const merged = mergeDetail(old, fromForm);
    if (merged.case !== 'trojanVless') throw new Error('ожидался trojanVless');
    expect(merged.value.password).toBe('new');
    expect(merged.value.flow, 'flow очищен в форме').toBeUndefined();
  });

  it('форма не дала detail (цепочка, свой JSON) — остаётся исходный', () => {
    const old = {
      case: 'hysteria2' as const,
      value: create(Hysteria2DetailSchema, { password: 'p', obfsPassword: 'o' }),
    };
    expect(mergeDetail(old, { case: undefined, value: undefined })).toBe(old);
  });

  it('другой тип detail — берётся значение формы целиком', () => {
    const old = {
      case: 'hysteria2' as const,
      value: create(Hysteria2DetailSchema, { password: 'p', obfsPassword: 'o' }),
    };
    const fromForm = {
      case: 'tuic' as const,
      value: create(TuicDetailSchema, { uuid: 'u', password: 'p' }),
    };
    expect(mergeDetail(old, fromForm)).toBe(fromForm);
  });
});

describe('mergeStream', () => {
  const oldStream = create(StreamSettingsSchema, {
    network: StreamSettings_Network.WS,
    path: '/old',
    host: 'old.example.org',
    security: StreamSettings_Security.REALITY,
    sni: 'old.sni',
    alpn: 'h2',
    allowInsecure: false,
    utlsFingerprint: 'chrome',
    realityPublicKey: 'OLDPBK',
    realityShortId: 'abcd',
    // ниже — поля, которых в форме нет
    headerType: 'http',
    wsEarlyDataHeader: 'Sec-WebSocket-Protocol',
    wsEarlyDataMax: 2048,
    certificate: 'CERT-PEM',
    realitySpx: '/spx',
    packetEncoding: StreamSettings_PacketEncoding.XUDP,
    multiplex: StreamSettings_MultiplexStatus.MULTIPLEX_ON,
  });

  it('packet_encoding, multiplex, early data, certificate, header_type, reality_spx сохраняются', () => {
    // форма пересоздаёт поток с дефолтами packet_encoding/multiplex и без прочего
    const fromForm = create(StreamSettingsSchema, {
      network: StreamSettings_Network.GRPC,
      path: '/new',
      host: 'new.example.org',
      security: StreamSettings_Security.TLS,
      sni: 'new.sni',
      alpn: 'h3',
      allowInsecure: false,
      utlsFingerprint: 'firefox',
      realityPublicKey: undefined,
      realityShortId: undefined,
      packetEncoding: StreamSettings_PacketEncoding.DEFAULT,
      multiplex: StreamSettings_MultiplexStatus.MULTIPLEX_DEFAULT,
    });
    const merged = mergeStream(oldStream, fromForm);
    expect(merged).toBeDefined();
    if (merged === undefined) return;
    // поля формы — из формы
    expect(merged.network).toBe(StreamSettings_Network.GRPC);
    expect(merged.path).toBe('/new');
    expect(merged.host).toBe('new.example.org');
    expect(merged.security).toBe(StreamSettings_Security.TLS);
    expect(merged.sni).toBe('new.sni');
    expect(merged.alpn).toBe('h3');
    expect(merged.utlsFingerprint).toBe('firefox');
    expect(merged.realityPublicKey, 'очищенный в форме pbk очищается').toBeUndefined();
    expect(merged.realityShortId, 'очищенный в форме sid очищается').toBeUndefined();
    // поля вне формы — из исходного профиля
    expect(merged.packetEncoding).toBe(StreamSettings_PacketEncoding.XUDP);
    expect(merged.multiplex).toBe(StreamSettings_MultiplexStatus.MULTIPLEX_ON);
    expect(merged.headerType).toBe('http');
    expect(merged.wsEarlyDataHeader).toBe('Sec-WebSocket-Protocol');
    expect(merged.wsEarlyDataMax).toBe(2048);
    expect(merged.certificate).toBe('CERT-PEM');
    expect(merged.realitySpx).toBe('/spx');
  });

  it('у профиля не было транспорта — берётся значение формы; формы нет — остаётся исходный', () => {
    const fromForm = create(StreamSettingsSchema, { network: StreamSettings_Network.TCP });
    expect(mergeStream(undefined, fromForm)).toBe(fromForm);
    expect(mergeStream(oldStream, undefined)).toBe(oldStream);
    expect(mergeStream(undefined, undefined)).toBeUndefined();
  });

  it('xhttp_mode и xhttp_extra сохраняются при правке других полей (UpdateProfile — полная замена)', () => {
    const xhttp = create(StreamSettingsSchema, {
      network: StreamSettings_Network.XHTTP,
      path: '/split',
      xhttpMode: 'packet-up',
      xhttpExtra: '{"xPaddingBytes":"100-1000"}',
    });
    const fromForm = create(StreamSettingsSchema, { network: StreamSettings_Network.XHTTP, path: '/other' });
    const merged = mergeStream(xhttp, fromForm);
    expect(merged?.path).toBe('/other');
    expect(merged?.xhttpMode).toBe('packet-up');
    expect(merged?.xhttpExtra).toBe('{"xPaddingBytes":"100-1000"}');
  });
});
