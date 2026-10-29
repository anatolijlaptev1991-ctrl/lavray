// SPDX-License-Identifier: GPL-3.0-only

// form.test.ts — регрессия T-66: форма редактора ↔ Profile для Hy2, TUIC, SS,
// цепочки и «Своего JSON» (раньше этих полей и типов в редакторе не было).
import { describe, expect, it } from 'vitest';
import type { MessageKey } from '../../lib/i18n';
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
  TuicDetailSchema,
  TuicDetail_CongestionControl,
  TuicDetail_UdpRelayMode,
} from '../../gen/lavray_pb';
import type { Profile } from '../../gen/lavray_pb';
import { emptyForm, fromProfile, toProfile, validateForm } from './form';

const t = (key: MessageKey): string => key;
const tf = (key: string, params: Readonly<Record<string, string | number>>): string =>
  `${key}:${JSON.stringify(params)}`;

function base(type: ProfileType, detail: Profile['detail']): Profile {
  return create(ProfileSchema, {
    id: 5n,
    groupId: 10n,
    type,
    name: 'P',
    address: 'h.example.org',
    port: 443,
    detail,
  });
}

describe('форма редактора ↔ Profile', () => {
  it('Hysteria2: все поля детали переживают форму (obfs, скорость, hop, CA, insecure)', () => {
    const detail = create(Hysteria2DetailSchema, {
      password: 'pw',
      obfsPassword: 'obfs',
      uploadMbps: 50,
      downloadMbps: 200,
      serverPorts: '20000:30000',
      hopInterval: '30s',
      sni: 'sni.example.org',
      ca: 'CERT',
      allowInsecure: true,
      disableSni: true,
    });
    const form = fromProfile(base(ProfileType.HYSTERIA2, { case: 'hysteria2', value: detail }));
    expect(form.obfsPassword).toBe('obfs');
    expect(form.upMbps).toBe('50');
    expect(toProfile(form, 5n, 10n).detail).toMatchObject({
      case: 'hysteria2',
      value: {
        password: 'pw',
        obfsPassword: 'obfs',
        uploadMbps: 50,
        downloadMbps: 200,
        serverPorts: '20000:30000',
        hopInterval: '30s',
        sni: 'sni.example.org',
        ca: 'CERT',
        allowInsecure: true,
        disableSni: true,
      },
    });
  });

  it('очистка необязательного поля задаётся явно (пустая строка), а не пропуском', () => {
    const detail = create(Hysteria2DetailSchema, { password: 'pw', obfsPassword: 'obfs' });
    const form = { ...fromProfile(base(ProfileType.HYSTERIA2, { case: 'hysteria2', value: detail })), obfsPassword: '' };
    const out = toProfile(form, 5n, 10n).detail;
    if (out.case !== 'hysteria2') throw new Error('ожидалась деталь hysteria2');
    // слияние {...старое, ...новое} иначе оставило бы старое значение
    expect(Object.hasOwn(out.value, 'obfsPassword')).toBe(true);
    expect(out.value.obfsPassword).toBe('');
  });

  it('TUIC: congestion, relay, zero-rtt, heartbeat, SNI, ALPN, CA', () => {
    const detail = create(TuicDetailSchema, {
      uuid: 'u',
      password: 'pw',
      congestionControl: TuicDetail_CongestionControl.CUBIC,
      udpRelayMode: TuicDetail_UdpRelayMode.QUIC,
      zeroRttHandshake: true,
      heartbeat: '10s',
      sni: 's.example.org',
      alpn: 'h3',
      ca: 'CERT',
      allowInsecure: true,
      disableSni: true,
    });
    const out = toProfile(fromProfile(base(ProfileType.TUIC, { case: 'tuic', value: detail })), 5n, 10n);
    expect(out.detail).toMatchObject({
      case: 'tuic',
      value: {
        congestionControl: TuicDetail_CongestionControl.CUBIC,
        udpRelayMode: TuicDetail_UdpRelayMode.QUIC,
        zeroRttHandshake: true,
        heartbeat: '10s',
        sni: 's.example.org',
        alpn: 'h3',
        ca: 'CERT',
        allowInsecure: true,
        disableSni: true,
      },
    });
  });

  it('Shadowsocks: плагин и UDP over TCP', () => {
    const detail = create(ShadowsocksDetailSchema, {
      method: 'aes-256-gcm',
      password: 'pw',
      plugin: 'obfs-local;obfs=http',
      udpOverTcp: ShadowsocksDetail_Uot.V2,
    });
    const out = toProfile(fromProfile(base(ProfileType.SHADOWSOCKS, { case: 'shadowsocks', value: detail })), 5n, 10n);
    expect(out.detail).toMatchObject({
      case: 'shadowsocks',
      value: {
        method: 'aes-256-gcm',
        plugin: 'obfs-local;obfs=http',
        udpOverTcp: ShadowsocksDetail_Uot.V2,
      },
    });
  });

  it('цепочка: узлы и порядок сохраняются, адрес и порт пустые', () => {
    const chain = base(ProfileType.CHAIN, { case: 'chain', value: create(ChainDetailSchema, { profileIds: [3n, 1n, 2n] }) });
    const form = fromProfile(chain);
    expect(form.chain).toEqual([3n, 1n, 2n]);
    const out = toProfile({ ...form, address: 'stale.example', port: '443' }, 5n, 10n);
    expect(out.detail).toMatchObject({ case: 'chain', value: { profileIds: [3n, 1n, 2n] } });
    expect([out.address, out.port]).toEqual(['', 0]);
  });

  it('«Свой JSON»: адрес и порт берутся из JSON исходящего', () => {
    const form = {
      ...emptyForm(ProfileType.CUSTOM_OUTBOUND),
      name: 'J',
      json: '{"type":"socks","server":"203.0.113.9","server_port":1081}',
    };
    const out = toProfile(form, 0n, 10n);
    expect([out.type, out.address, out.port]).toEqual([ProfileType.CUSTOM_OUTBOUND, '203.0.113.9', 1081]);
    expect(out.detail).toMatchObject({
      case: 'custom',
      value: { core: CustomDetail_Core.INTERNAL, outboundJson: expect.stringContaining('"server_port":1081') as unknown },
    });
  });

  it('существующий CUSTOM_CONFIG открывается и сохраняется как полный конфиг', () => {
    const detail = create(CustomDetailSchema, {
      core: CustomDetail_Core.INTERNAL_FULL,
      fullConfigJson: '{"outbounds":[]}',
    });
    const form = fromProfile(base(ProfileType.CUSTOM_CONFIG, { case: 'custom', value: detail }));
    expect(form.json).toBe('{"outbounds":[]}');
    expect(toProfile(form, 5n, 10n).detail).toMatchObject({
      case: 'custom',
      value: { core: CustomDetail_Core.INTERNAL_FULL, fullConfigJson: '{"outbounds":[]}' },
    });
  });
});

describe('validateForm', () => {
  const ok = { ...emptyForm(ProfileType.VLESS), name: 'n', address: 'a.example', port: '443' };

  it('без ошибок для заполненной формы', () => {
    expect(validateForm(ok, t, tf)).toEqual({});
  });

  it('название, адрес и порт обязательны; порт — 1…65535', () => {
    expect(validateForm({ ...ok, name: ' ', address: '', port: '' }, t, tf)).toEqual({
      name: 'ed.required',
      address: 'ed.required',
      port: 'ed.required',
    });
    expect(validateForm({ ...ok, port: '70000' }, t, tf).port).toBe('set.portErr');
    expect(validateForm({ ...ok, port: '0' }, t, tf).port).toBe('set.portErr');
  });

  it('цепочка — минимум 2 узла; адрес и порт не требуются', () => {
    const chain = { ...emptyForm(ProfileType.CHAIN), name: 'c' };
    expect(validateForm({ ...chain, chain: [1n] }, t, tf)).toEqual({ chain: 'ed.chainMin' });
    expect(validateForm({ ...chain, chain: [1n, 2n] }, t, tf)).toEqual({});
  });

  it('«Свой JSON»: нужен корректный JSON-объект', () => {
    const json = { ...emptyForm(ProfileType.CUSTOM_OUTBOUND), name: 'j' };
    expect(validateForm({ ...json, json: '{ bad' }, t, tf).json).toMatch(/^ed\.jsonErr:/);
    expect(validateForm({ ...json, json: '[1]' }, t, tf).json).toBe('ed.jsonObj');
    expect(validateForm({ ...json, json: '{"type":"direct"}' }, t, tf)).toEqual({});
  });
});
