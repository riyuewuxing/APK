import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMobileConnectionConfig,
  getMobileCacheScope,
  parsePairingCode,
  saveMobileConnectionConfig,
} from '@/platform/runtime';
import {
  apiRequestJson,
  apiRequestText,
  captureApiAuthorizationGuard,
  subscribeApiAuthorizationChanges,
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

  it('coalesces simultaneous normal and forced probes of the same pairing', async () => {
    saveMobileConnectionConfig({ lanUrl: 'https://fixture.example', remoteUrl: 'https://remote.example', deviceToken: 'synthetic-token-00000000' });
    let finish: (response: unknown) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const a = resolveActiveBackendBase();
    const b = resolveActiveBackendBase(true);
    const c = resolveActiveBackendBase();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish({ ok: true, status: 200, json: async () => ({ status: 'ok' }) });
    for (const result of await Promise.all([a, b, c])) expect(result.channel).toBe('lan');
    expect(getBackendStatusSnapshot().channel).toBe('lan');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a superseded in-flight host cannot overwrite the new host status', async () => {
    saveMobileConnectionConfig({ lanUrl: 'https://alpha.example', deviceToken: 'synthetic-token-A-00000000' });
    let finishOld: (response: unknown) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('alpha')
      ? new Promise(resolve => { finishOld = resolve; })
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'ok' }) })));
    const old = resolveActiveBackendBase();
    const rejected = expect(old).rejects.toMatchObject({ name: 'PairingChangedError' });
    saveMobileConnectionConfig({ lanUrl: 'https://beta.example', deviceToken: 'synthetic-token-B-00000000' });
    expect(await resolveActiveBackendBase(true)).toEqual({ baseUrl: 'https://beta.example', channel: 'lan' });
    finishOld({ ok: true, status: 200, json: async () => ({ status: 'ok' }) });
    await rejected;
    expect(getBackendStatusSnapshot().activeBaseUrl).toBe('https://beta.example');
  });

  it('uses a bounded LAN probe long enough for a cold WebView connection', async () => {
    vi.useFakeTimers();
    saveMobileConnectionConfig({ lanUrl: 'https://fixture.example', deviceToken: 'synthetic-token-00000000' });
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({ status: 'ok' }) }), 1800);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); });
    })));
    const pending = resolveActiveBackendBase(true);
    await vi.advanceTimersByTimeAsync(1800);
    expect((await pending).channel).toBe('lan');
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


describe('R09 pairing and transport isolation', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', createMemoryStorage()); clearMobileConnectionConfig(); resetApiClientState(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('rotates namespaces on A→B→A and drops legacy snapshots', () => {
    const input = {lanUrl:'https://fixture.example',deviceToken:'synthetic-token-aaaaaaaa'};
    const first = saveMobileConnectionConfig(input);
    const scope = getMobileCacheScope(first);
    expect(scope).toMatch(/^host_v3_[0-9a-f]{32}$/);
    expect(getMobileCacheScope()).toBe(scope);
    expect(getMobileCacheScope(saveMobileConnectionConfig({autoWebBundleSync:true}))).toBe(scope);
    writeOfflineSnapshot('/api/workbench',{old:true},{sourceUrl:'fixture'});
    saveMobileConnectionConfig({deviceToken:'synthetic-token-bbbbbbbb'});
    const next = saveMobileConnectionConfig(input);
    expect(getMobileCacheScope(next)).not.toBe(scope);
    expect(readOfflineSnapshot('/api/workbench',scope)).toBeNull();
  });
  it('migrates legacy short-hash namespace without reusing old cached bytes', () => {
    localStorage.setItem('tz.mobile.connection.v1',JSON.stringify({lanUrl:'https://fixture.example',remoteUrl:'',deviceToken:'synthetic-token-aaaaaaaa'}));
    localStorage.setItem('tz.offline_snapshot.v1:host_deadbeef:/api/workbench','{"payload":{"old":true}}');
    const scope=getMobileCacheScope();
    expect(scope).toMatch(/^host_v3_/);
    expect(getMobileCacheScope()).toBe(scope);
    expect(localStorage.getItem('tz.offline_snapshot.v1:host_deadbeef:/api/workbench')).toBeNull();
  });
  it.each(['https://user:pass@fixture.example','https://fixture.example/a','https://fixture.example?x=1','https://fixture.example#x'])('rejects non-origin pairing URL %s', url => {
    expect(()=>saveMobileConnectionConfig({lanUrl:url})).toThrow();
  });
  it.each(['//evil.example/api/workbench','/api/../private','/api/%2e%2e/private','/api/\\evil'])('refuses path escape %s before fetching', async path => {
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    await expect(apiRequestJson(path)).rejects.toThrow('无效 API 路径');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('never follows an authenticated redirect or converts malformed JSON into an offline cache hit', async () => {
    saveMobileConnectionConfig({lanUrl:'https://fixture.example',deviceToken:'synthetic-token-aaaaaaaa'});
    writeOfflineSnapshot('/api/workbench',{old:true},{sourceUrl:'fixture'});
    vi.stubGlobal('fetch',vi.fn(async (url:string,init?:RequestInit)=>{
      expect(init?.redirect).toBe('error');expect(init?.cache).toBe('no-store');
      return url.endsWith('/api/health')?{ok:true,status:200,json:async()=>({status:'ok'})}
      :{ok:true,status:200,json:async()=>{throw new SyntaxError('invalid JSON')}};
    }));
    await expect(apiRequestJson('/api/workbench')).rejects.toThrow('JSON');
  });
  it('rejects stale namespace metadata or a future cache clock', () => {
    saveMobileConnectionConfig({lanUrl:'https://fixture.example',deviceToken:'synthetic-token-aaaaaaaa'});
    const scope=getMobileCacheScope(),key='tz.offline_snapshot.v1:'+scope+':/api/workbench';
    const entry={key:'/api/workbench',payload:{x:1},fetched_at:'2099-01-01T00:00:00Z',scope};
    localStorage.setItem(key,JSON.stringify(entry));expect(readOfflineSnapshot('/api/workbench')).toBeNull();
    localStorage.setItem(key,JSON.stringify({...entry,fetched_at:'2020-01-01T00:00:00Z',scope:undefined}));expect(readOfflineSnapshot('/api/workbench')).toBeNull();
  });
});


describe('R09 late authorization response invalidation', () => {
  it('discards an earlier success if another request invalidates authorization', async () => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    clearMobileConnectionConfig();
    resetApiClientState();
    let finish!: (data: unknown) => void;
    let started!: () => void;
    const headerRead = new Promise<void>(resolve => { started = resolve; });
    const body = new Promise<unknown>(resolve => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/workbench'
      ? { ok: true, status: 200, json: () => { started(); return body; } }
      : { ok: false, status: 401, text: async () => '' }));
    try {
      const late = apiRequestJson('/api/workbench');
      await headerRead;
      await expect(apiRequestJson('/api/denied')).rejects.toMatchObject({ name: 'AuthError' });
      finish({ account: 'obsolete synthetic account' });
      await expect(late).rejects.toMatchObject({ name: 'AuthError' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


describe('R12 response body deadlines', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    clearMobileConnectionConfig();
    resetApiClientState();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it.each(['json', 'text'] as const)('times out a stalled %s body after headers', async mode => {
    let finish!: (data: unknown) => void;
    let signal: AbortSignal | null | undefined;
    const body = new Promise(resolve => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      signal = init?.signal;
      return { ok: true, status: 200, json: () => body, text: () => body };
    }));
    const pending = mode === 'json'
      ? apiRequestJson('/api/workbench', { timeoutMs: 250 })
      : apiRequestText('/api/report', { timeoutMs: 250 });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(250);
    await rejected;
    expect(signal?.aborted).toBe(true);
    finish({ stale: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(readOfflineSnapshot('/api/workbench')).toBeNull();
  });
  it('caller abort after headers prevents late body success', async () => {
    let begin!: () => void;
    let finish!: (data: unknown) => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    const body = new Promise(resolve => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: () => { begin(); return body; } })));
    const ac = new AbortController();
    const pending = apiRequestJson('/api/workbench', { signal: ac.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    ac.abort();
    await rejected;
    finish({ stale: true });
  });
  it('a denial at headers is not delayed by its body', async () => {
    const text = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, text })));
    await expect(apiRequestText('/api/report')).rejects.toMatchObject({ name: 'AuthError', status: 403 });
    expect(text).not.toHaveBeenCalled();
  });
  it('reset invalidates a late body even when pairing scope is unchanged', async () => {
    let begin!: () => void;
    let finish!: (data: unknown) => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    const body = new Promise(resolve => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: () => { begin(); return body; } })));
    const pending = apiRequestJson('/api/workbench');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AuthError' });
    await started;
    resetApiClientState();
    finish({ stale: true });
    await rejected;
  });
});


describe('R12 shared authorization epoch for deferred research', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', createMemoryStorage()); clearMobileConnectionConfig(); resetApiClientState(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('denial invalidates stream and deferred commit guards and notifies current views', async () => {
    const previous = captureApiAuthorizationGuard();
    const listener = vi.fn();
    const unsubscribe = subscribeApiAuthorizationChanges(listener);
    try {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => '' })));
      await expect(apiRequestJson('/api/denied')).rejects.toMatchObject({name: 'AuthError'});
      expect(() => previous.assertCurrent()).toThrow('鉴权状态已变化');
      expect(listener).toHaveBeenCalledOnce();
      expect(() => captureApiAuthorizationGuard().assertCurrent()).not.toThrow();
    } finally { unsubscribe(); }
  });
  it('a stream denial clears same-scope cached observations and invalidates other reads', () => {
    saveMobileConnectionConfig({lanUrl:'https://fixture.example',deviceToken:'synthetic-token-00000000'});
    writeOfflineSnapshot('/api/workbench',{old:true},{sourceUrl:'fixture'});
    const streaming = captureApiAuthorizationGuard();
    const other = captureApiAuthorizationGuard();
    expect(() => streaming.rejectIfDenied(403)).toThrow('403');
    expect(() => other.assertCurrent()).toThrow('鉴权状态已变化');
    expect(readOfflineSnapshot('/api/workbench')).toBeNull();
  });
  it('a superseded stream denial cannot invalidate a newer pairing', () => {
    saveMobileConnectionConfig({lanUrl:'https://fixture.example',deviceToken:'synthetic-token-00000000'});
    const old = captureApiAuthorizationGuard();
    saveMobileConnectionConfig({lanUrl:'https://other.example',deviceToken:'synthetic-token-00000001'});
    const current = captureApiAuthorizationGuard();
    expect(() => old.rejectIfDenied(401)).toThrow('配对已变更');
    expect(() => current.assertCurrent()).not.toThrow();
  });
});
