import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMobileConnectionConfig,
  getMobileCacheScope,
  parsePairingCode,
  saveMobileConnectionConfig,
} from '@/platform/runtime';
import {
  apiRequestJson,
  getBackendStatusSnapshot,
  resetApiClientState,
  resolveActiveBackendBase,
} from './apiClient';
import { clearOfflineSnapshots, readOfflineSnapshot, writeOfflineSnapshot } from './offlineCache';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function encodeBase64Utf8(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

describe('apiClient dual-channel routing & offline cache', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    clearMobileConnectionConfig();
    clearOfflineSnapshots();
    resetApiClientState();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses same-origin relative URLs with zero extra probe on desktop default mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ research_only: true, execution_allowed: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const active = await resolveActiveBackendBase();
    expect(active).toEqual({ baseUrl: '', channel: 'same_origin' });

    const data = await apiRequestJson<{ research_only: boolean }>('/api/workbench');
    expect(data.research_only).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/workbench');
  });

  it('aborts a same-origin request at its configured timeout with a readable error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
      )
    );

    const pending = apiRequestJson('/api/slow', { fallbackToCache: false, timeoutMs: 250 });
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
      message: expect.stringContaining('请求超时'),
    });
    await vi.advanceTimersByTimeAsync(250);
    await rejection;
    vi.useRealTimers();
  });

  it('prefers LAN channel, fails over to Tailscale remote, and falls back to offline snapshot', async () => {
    saveMobileConnectionConfig({
      lanUrl: 'http://192.168.1.6:8502',
      remoteUrl: 'https://pc.tailnet.ts.net',
      deviceToken: '0123456789abcdef0123456789abcdef',
    });

    // 1) LAN reachable -> sends Bearer token to LAN and writes offline cache
    const lanFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'http://192.168.1.6:8502/api/health') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok', frontend_bundle_sha256: 'abc123' }),
        };
      }
      if (url === 'http://192.168.1.6:8502/api/workbench') {
        const headers = new Headers(init?.headers);
        expect(headers.get('Authorization')).toBe('Bearer 0123456789abcdef0123456789abcdef');
        return {
          ok: true,
          status: 200,
          json: async () => ({ account_tag: 'cached_workbench_payload' }),
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', lanFetch);

    const liveWb = await apiRequestJson<{ account_tag: string }>('/api/workbench');
    expect(liveWb.account_tag).toBe('cached_workbench_payload');
    expect(getBackendStatusSnapshot().channel).toBe('lan');
    expect(readOfflineSnapshot<{ account_tag: string }>('/api/workbench')?.payload.account_tag).toBe(
      'cached_workbench_payload'
    );

    // 2) LAN down, remote reachable -> switches to remote
    resetApiClientState();
    const remoteFetch = vi.fn(async (url: string) => {
      if (url === 'http://192.168.1.6:8502/api/health') {
        throw new Error('LAN timeout');
      }
      if (url === 'https://pc.tailnet.ts.net/api/health') {
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      }
      if (url === 'https://pc.tailnet.ts.net/api/radar') {
        return { ok: true, status: 200, json: async () => ({ radar: 'ok' }) };
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', remoteFetch);

    const radar = await apiRequestJson<{ radar: string }>('/api/radar');
    expect(radar.radar).toBe('ok');
    expect(getBackendStatusSnapshot().channel).toBe('remote');

    // 3) Both channels offline -> returns cached /api/workbench with offline state; uncached fails loudly
    resetApiClientState();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network offline'))
    );

    const onCacheFallback = vi.fn();
    const cachedWb = await apiRequestJson<{ account_tag: string }>('/api/workbench', { onCacheFallback });
    expect(onCacheFallback).toHaveBeenCalledOnce();
    expect(cachedWb.account_tag).toBe('cached_workbench_payload');
    expect(getBackendStatusSnapshot().channel).toBe('offline');
    expect(getBackendStatusSnapshot().offlineSnapshotFetchedAt).toBeTruthy();

    await expect(apiRequestJson('/api/research/999999')).rejects.toThrow(
      /电脑后端离线，暂无该标的缓存研判/
    );
  });

  it.each([401, 403])('does not return a cached payload after HTTP %s', async status => {
    saveMobileConnectionConfig({ lanUrl: 'https://fixture.example', deviceToken: 'synthetic-token-A-00000000' });
    writeOfflineSnapshot('/api/workbench', { privateFixture: 'old' }, { sourceUrl: 'https://fixture.example/api/workbench' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/api/health')
      ? { ok: true, status: 200, json: async () => ({ status: 'ok' }) }
      : { ok: false, status, text: async () => 'denied' }));
    await expect(apiRequestJson('/api/workbench')).rejects.toMatchObject({ name: 'AuthError', status });
    expect(readOfflineSnapshot('/api/workbench')).toBeNull();
  });

  it('isolates cache even for different tokens with an identical suffix and never reuses an old host', async () => {
    const cfgA = saveMobileConnectionConfig({ lanUrl: 'https://alpha.example', deviceToken: 'synthetic-token-A-00000000' });
    const scopeA = getMobileCacheScope(cfgA);
    writeOfflineSnapshot('/api/workbench', { privateFixture: 'A' }, { sourceUrl: 'https://alpha.example/api/workbench' });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/health')) return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      expect(url).toBe('https://beta.example/api/workbench');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-token-B-00000000');
      return { ok: true, status: 200, json: async () => ({ privateFixture: 'B' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    expect((await resolveActiveBackendBase()).baseUrl).toBe('https://alpha.example');
    const sameHostNewToken = saveMobileConnectionConfig({ deviceToken: 'synthetic-token-B-00000000' });
    expect(getMobileCacheScope(sameHostNewToken)).not.toBe(scopeA);
    expect(readOfflineSnapshot('/api/workbench')).toBeNull();
    saveMobileConnectionConfig({ lanUrl: 'https://beta.example' });
    expect(await apiRequestJson('/api/workbench')).toEqual({ privateFixture: 'B' });
    expect(fetchMock.mock.calls.some(([url]) => url === 'https://beta.example/api/health')).toBe(true);
  });

  it('discards a response arriving after a pairing switch', async () => {
    saveMobileConnectionConfig({ lanUrl: 'https://alpha.example', deviceToken: 'synthetic-token-A-00000000' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/api/health')) return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      saveMobileConnectionConfig({ lanUrl: 'https://beta.example', deviceToken: 'synthetic-token-B-00000000' });
      return { ok: true, status: 200, json: async () => ({ privateFixture: 'A' }) };
    }));
    await expect(apiRequestJson('/api/workbench')).rejects.toMatchObject({ name: 'PairingChangedError' });
    expect(readOfflineSnapshot('/api/workbench')).toBeNull();
  });

  it('parses valid Base64 pairing codes and rejects malformed tokens', () => {
    const payload = {
      v: 1,
      lan_url: 'http://192.168.1.6:8502/',
      remote_url: 'https://pc.tailnet.ts.net/',
      device_token: 'fedcba9876543210fedcba9876543210',
    };
    const encoded = encodeBase64Utf8(JSON.stringify(payload));
    const parsed = parsePairingCode(encoded);
    expect(parsed).toEqual({
      lanUrl: 'http://192.168.1.6:8502',
      remoteUrl: 'https://pc.tailnet.ts.net',
      deviceToken: 'fedcba9876543210fedcba9876543210',
    });

    expect(() => parsePairingCode('not-valid-base64!')).toThrow();
    const shortToken = encodeBase64Utf8(JSON.stringify({ device_token: 'short' }));
    expect(() => parsePairingCode(shortToken)).toThrow(/配对码缺少有效的设备配对令牌/);
  });
});
