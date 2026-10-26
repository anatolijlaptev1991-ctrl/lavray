// core.test.ts — ConnectRPC-клиент против живого ядра (go test уже
// прогоняет те же RPC в internal/api; здесь — типы/транспорт-мок fetch).
import { describe, expect, it, vi } from 'vitest';
import { createCoreClients } from './core';

function fetchOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('core clients (transport mock)', () => {
  it('sends Bearer token and parses GetStatus', async () => {
    const fetchMock = fetchOk({ state: 'CORE_STATE_IDLE', profileId: '0' });
    const clients = createCoreClients('http://127.0.0.1:1', { token: 'tok-42' });
    // Подменяем fetch транспорта.
    (globalThis as { fetch?: typeof fetch }).fetch = fetchMock;
    const st = await clients.core.getStatus({});
    expect(st.state).toBeDefined();
    const call = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [
      RequestInfo,
      RequestInit?,
    ];
    const headers = new Headers(call[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer tok-42');
  });

  it('profile list maps typed response', async () => {
    const fetchMock = fetchOk({ profiles: [], total: 0 });
    const clients = createCoreClients('http://127.0.0.1:1');
    (globalThis as { fetch?: typeof fetch }).fetch = fetchMock;
    const res = await clients.profiles.listProfiles({});
    expect(res.total).toBe(0n); // int64 → bigint в protobuf-es
  });
});
