/**
 * 统一后端 API 客户端
 * - 桌面同源（!isNativeApp && 未配置远端地址）：保持零额外探测与原样相对路径 fetch，100% 兼容现有桌面终端与单测。
 * - 移动/远程双通道：自动按 lanUrl (3s) -> remoteUrl (4s) 探测并附加 Bearer Token，离线自动显式回退本地快照。
 */

import {
  getMobileCacheScope,
  getMobileConnectionConfig,
  hasConfiguredRemoteBackend,
  isNativeApp,
} from '@/platform/runtime';
import {
  clearOfflineSnapshots,
  getLatestOfflineSnapshotTime,
  isCacheableExpertEndpoint,
  readOfflineSnapshot,
  writeOfflineSnapshot,
} from './offlineCache';

class HttpStatusError extends Error {
  status: number;
  constructor(status: number, message: string, isAuth = false) {
    super(message);
    this.status = status;
    this.name = isAuth ? 'AuthError' : 'HttpStatusError';
  }
}

export type BackendChannel = 'same_origin' | 'lan' | 'remote' | 'offline';

export interface BackendStatusSnapshot {
  channel: BackendChannel;
  activeBaseUrl: string;
  lastLatencyMs: number | null;
  lastCheckedAt: string | null;
  offlineSnapshotFetchedAt: string | null;
  lastError: string | null;
  remoteBundleSha256: string | null;
}

export interface ChannelProbeResult {
  reachable: boolean;
  latencyMs: number | null;
  health: Record<string, unknown> | null;
  error: string | null;
}

class PairingChangedError extends Error {
  constructor() {
    super('设备配对已变更，丢弃旧请求并重新连接');
    this.name = 'PairingChangedError';
  }
}

function assertPairingScope(scope: string): void {
  if (getMobileCacheScope() !== scope) throw new PairingChangedError();
}

const CHANNEL_CACHE_TTL_MS = 30_000;
const LAN_PROBE_TIMEOUT_MS = 3000;
const REMOTE_PROBE_TIMEOUT_MS = 4000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const HEAVY_REQUEST_TIMEOUT_MS = 60_000;

function requestTimeoutForPath(path: string): number {
  return /\/api\/(?:research\/|quantstats\/tearsheet|eod\/analyze-vetting|market\/pit-sync\?sync=true)/i.test(
    path
  )
    ? HEAVY_REQUEST_TIMEOUT_MS
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function createRequestSignal(path: string, signal: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let didTimeout = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeout: () => didTimeout,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    },
    timeoutError: () => {
      const error = new Error(`请求超时（${Math.ceil(timeoutMs / 1000)} 秒）：${path}`);
      error.name = 'TimeoutError';
      return error;
    },
  };
}

type ResolvedBackend = { baseUrl: string; channel: BackendChannel };
let probeGeneration = 0;
let pendingProbe: { scope: string; promise: Promise<ResolvedBackend> } | null = null;

let cachedChannel: {
  scope: string;
  baseUrl: string;
  channel: BackendChannel;
  expiresAt: number;
} | null = null;

let statusSnapshot: BackendStatusSnapshot = {
  channel: 'same_origin',
  activeBaseUrl: '',
  lastLatencyMs: null,
  lastCheckedAt: null,
  offlineSnapshotFetchedAt: null,
  lastError: null,
  remoteBundleSha256: null,
};

const statusListeners = new Set<(snapshot: BackendStatusSnapshot) => void>();

function emitStatus(partial: Partial<BackendStatusSnapshot>): void {
  statusSnapshot = {
    ...statusSnapshot,
    ...partial,
  };
  statusListeners.forEach((listener) => {
    try {
      listener(statusSnapshot);
    } catch {
      // ignore subscriber errors
    }
  });
}

export function getBackendStatusSnapshot(): BackendStatusSnapshot {
  return statusSnapshot;
}

export function subscribeBackendStatus(
  listener: (snapshot: BackendStatusSnapshot) => void
): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function resetApiClientState(): void {
  cachedChannel = null;
  pendingProbe = null;
  probeGeneration += 1;
  statusSnapshot = {
    channel: 'same_origin',
    activeBaseUrl: '',
    lastLatencyMs: null,
    lastCheckedAt: null,
    offlineSnapshotFetchedAt: null,
    lastError: null,
    remoteBundleSha256: null,
  };
}

export function shouldUseRemoteDualChannel(): boolean {
  const cfg = getMobileConnectionConfig();
  return isNativeApp() || hasConfiguredRemoteBackend(cfg);
}

export function buildApiUrl(path: string, baseUrl: string): string {
  if (!baseUrl) return path;
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

export async function probeBackendHealth(
  baseUrl: string,
  timeoutMs: number
): Promise<ChannelProbeResult> {
  if (typeof fetch !== 'function') {
    return { reachable: false, latencyMs: null, health: null, error: 'fetch unavailable' };
  }
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const healthUrl = buildApiUrl('/api/health', cleanBase);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const startedAt = Date.now();
  try {
    const resp = await fetch(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (!resp.ok) {
      return {
        reachable: false,
        latencyMs,
        health: null,
        error: `HTTP ${resp.status}`,
      };
    }
    const data = (await resp.json()) as Record<string, unknown>;
    if (data?.status !== 'ok') {
      return {
        reachable: false,
        latencyMs,
        health: null,
        error: 'health payload not ok',
      };
    }
    return { reachable: true, latencyMs, health: data, error: null };
  } catch (err) {
    return {
      reachable: false,
      latencyMs: null,
      health: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One live probe per exact pairing scope. A new scope/reset supersedes old results. */
export async function resolveActiveBackendBase(forceRefresh = false): Promise<ResolvedBackend> {
  const cfg = getMobileConnectionConfig();
  const scope = getMobileCacheScope(cfg);
  if (!isNativeApp() && !hasConfiguredRemoteBackend(cfg)) {
    if (pendingProbe || cachedChannel) {
      probeGeneration += 1;
      pendingProbe = null;
      cachedChannel = null;
    }
    if (statusSnapshot.channel !== 'same_origin') {
      emitStatus({ channel: 'same_origin', activeBaseUrl: '', lastLatencyMs: null,
        lastCheckedAt: null, offlineSnapshotFetchedAt: null, lastError: null, remoteBundleSha256: null });
    }
    return { baseUrl: '', channel: 'same_origin' };
  }

  // A user-triggered reconnect shares a probe already in flight for this pairing,
  // rather than firing a duplicate that can overwrite a successful status.
  if (pendingProbe?.scope === scope) return pendingProbe.promise;
  if (!forceRefresh && cachedChannel?.scope === scope && Date.now() < cachedChannel.expiresAt) {
    return { baseUrl: cachedChannel.baseUrl, channel: cachedChannel.channel };
  }
  const generation = ++probeGeneration;
  const checkCurrent = () => {
    assertPairingScope(scope);
    if (generation !== probeGeneration) throw new PairingChangedError();
  };
  const run = async (): Promise<ResolvedBackend> => {
    for (const [baseUrl, channel, timeout] of [
      [cfg.lanUrl, 'lan', LAN_PROBE_TIMEOUT_MS],
      [cfg.remoteUrl, 'remote', REMOTE_PROBE_TIMEOUT_MS],
    ] as const) {
      if (!baseUrl) continue;
      const probe = await probeBackendHealth(baseUrl, timeout);
      checkCurrent();
      if (!probe.reachable) continue;
      cachedChannel = { scope, baseUrl, channel, expiresAt: Date.now() + CHANNEL_CACHE_TTL_MS };
      emitStatus({ channel, activeBaseUrl: baseUrl, lastLatencyMs: probe.latencyMs,
        lastCheckedAt: new Date().toISOString(), offlineSnapshotFetchedAt: null, lastError: null,
        remoteBundleSha256: typeof probe.health?.frontend_bundle_sha256 === 'string'
          ? probe.health.frontend_bundle_sha256 : null });
      return { baseUrl, channel };
    }
    checkCurrent();
    cachedChannel = { scope, baseUrl: '', channel: 'offline', expiresAt: Date.now() + 5000 };
    emitStatus({ channel: 'offline', activeBaseUrl: '', lastLatencyMs: null,
      lastCheckedAt: new Date().toISOString(), offlineSnapshotFetchedAt: getLatestOfflineSnapshotTime(scope),
      lastError: '电脑后端未连接（局域网与远程通道均不可达）', remoteBundleSha256: null });
    return { baseUrl: '', channel: 'offline' };
  };
  const pending = { scope, promise: run() };
  pendingProbe = pending;
  try {
    return await pending.promise;
  } finally {
    if (pendingProbe === pending) pendingProbe = null;
  }
}

function buildAuthHeaders(
  existingHeaders: HeadersInit | undefined,
  channel: BackendChannel,
  skipAuth?: boolean
): HeadersInit | undefined {
  if (channel === 'same_origin' || skipAuth) {
    return existingHeaders;
  }
  const token = getMobileConnectionConfig().deviceToken;
  if (!token) return existingHeaders;

  const headers = new Headers(existingHeaders ?? {});
  headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

export async function apiFetch(
  path: string,
  options?: RequestInit & { skipAuth?: boolean; forceProbe?: boolean; timeoutMs?: number }
): Promise<{ response: Response; baseUrl: string; channel: BackendChannel }> {
  const { skipAuth, forceProbe, timeoutMs = requestTimeoutForPath(path), ...fetchInit } = options ?? {};
  const scope = getMobileCacheScope();
  const { channel, baseUrl } = await resolveActiveBackendBase(Boolean(forceProbe));
  assertPairingScope(scope);
  if (channel === 'offline') {
    throw new Error('电脑后端未连接');
  }
  const url = buildApiUrl(path, baseUrl);
  const headers = buildAuthHeaders(fetchInit.headers, channel, skipAuth);
  const requestSignal = createRequestSignal(path, fetchInit.signal, timeoutMs);
  const finalInit: RequestInit = headers
    ? { ...fetchInit, headers, signal: requestSignal.signal }
    : { ...fetchInit, signal: requestSignal.signal };
  try {
    const response = await fetch(url, finalInit);
    assertPairingScope(scope);
    return { response, baseUrl, channel };
  } catch (error) {
    if (requestSignal.didTimeout()) throw requestSignal.timeoutError();
    throw error;
  } finally {
    requestSignal.dispose();
  }
}

export async function apiRequestJson<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST';
    signal?: AbortSignal;
    fallbackToCache?: boolean;
    body?: unknown;
    timeoutMs?: number;
    onCacheFallback?: () => void;
  }
): Promise<T> {
  const scope = getMobileCacheScope();
  const method = options?.method ?? 'GET';
  const allowCache = (options?.fallbackToCache ?? true) && method === 'GET' && isCacheableExpertEndpoint(path);
  const postHeaders =
    options?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined;

  const tryReadCache = (fallbackReason: string): T => {
    assertPairingScope(scope);
    if (allowCache) {
      const snap = readOfflineSnapshot<T>(path, scope);
      if (snap) {
        emitStatus({
          channel: 'offline',
          activeBaseUrl: '',
          offlineSnapshotFetchedAt: snap.fetched_at,
          lastError: fallbackReason,
        });
        options?.onCacheFallback?.();
        return snap.payload;
      }
      throw new Error('电脑后端离线，暂无该标的缓存研判（实时行情仍可正常查看）');
    }
    throw new Error(fallbackReason);
  };

  try {
    const { response, baseUrl, channel } = await apiFetch(path, {
      method,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
      headers: { Accept: 'application/json', ...(postHeaders ?? {}) },
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    assertPairingScope(scope);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        cachedChannel = null;
        clearOfflineSnapshots(scope);
        emitStatus({ lastError: `设备鉴权或访问受限（HTTP ${response.status}），已停用当前离线快照` });
      }
      const detail = await response.text().catch(() => '');
      throw new HttpStatusError(
        response.status,
        `HTTP ${response.status} (${path}): ${detail.slice(0, 160)}`,
        response.status === 401 || response.status === 403
      );
    }

    const payload = (await response.json()) as T;
    assertPairingScope(scope);
    if (channel !== 'offline' && statusSnapshot.channel === 'offline') {
      emitStatus({ channel, activeBaseUrl: baseUrl, offlineSnapshotFetchedAt: null, lastError: null });
    }
    if (allowCache && (isNativeApp() || hasConfiguredRemoteBackend())) {
      writeOfflineSnapshot(path, payload, { sourceUrl: buildApiUrl(path, baseUrl), scope });
    }
    return payload;
  } catch (err) {
    if (err instanceof HttpStatusError || err instanceof PairingChangedError) {
      throw err;
    }
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw err;
    }
    // 通道可能切换，清除内存通道缓存以便下次重探；仅真离线/网络不可达时才读取当前配对域快照
    if (shouldUseRemoteDualChannel()) {
      cachedChannel = null;
      return tryReadCache(err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

export async function apiRequestText(
  path: string,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<string> {
  const scope = getMobileCacheScope();
  const { response } = await apiFetch(path, {
    method: 'GET',
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} (${path}): ${detail.slice(0, 160)}`);
  }
  const result = await response.text();
  assertPairingScope(scope);
  return result;
}
