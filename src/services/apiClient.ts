/**
 * 统一后端 API 客户端
 * - 桌面同源（!isNativeApp && 未配置远端地址）：保持零额外探测与原样相对路径 fetch，100% 兼容现有桌面终端与单测。
 * - 移动/远程双通道：自动按 lanUrl (1.2s) -> remoteUrl (2.5s) 探测并附加 Bearer Token，离线自动显式回退本地快照。
 */

import {
  getMobileConnectionConfig,
  hasConfiguredRemoteBackend,
  isNativeApp,
} from '@/platform/runtime';
import {
  getLatestOfflineSnapshotTime,
  isCacheableExpertEndpoint,
  readOfflineSnapshot,
  writeOfflineSnapshot,
} from './offlineCache';

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

const CHANNEL_CACHE_TTL_MS = 30_000;
const LAN_PROBE_TIMEOUT_MS = 1200;
const REMOTE_PROBE_TIMEOUT_MS = 2500;

let cachedChannel: {
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
    if (timer) clearTimeout(timer);
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
    if (timer) clearTimeout(timer);
    return {
      reachable: false,
      latencyMs: null,
      health: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function resolveActiveBackendBase(forceRefresh = false): Promise<{
  baseUrl: string;
  channel: BackendChannel;
}> {
  if (!shouldUseRemoteDualChannel()) {
    return { baseUrl: '', channel: 'same_origin' };
  }

  const now = Date.now();
  if (!forceRefresh && cachedChannel && now < cachedChannel.expiresAt) {
    return { baseUrl: cachedChannel.baseUrl, channel: cachedChannel.channel };
  }

  const cfg = getMobileConnectionConfig();
  const checkedAt = new Date().toISOString();

  if (cfg.lanUrl) {
    const lanProbe = await probeBackendHealth(cfg.lanUrl, LAN_PROBE_TIMEOUT_MS);
    if (lanProbe.reachable) {
      cachedChannel = {
        baseUrl: cfg.lanUrl,
        channel: 'lan',
        expiresAt: now + CHANNEL_CACHE_TTL_MS,
      };
      emitStatus({
        channel: 'lan',
        activeBaseUrl: cfg.lanUrl,
        lastLatencyMs: lanProbe.latencyMs,
        lastCheckedAt: checkedAt,
        offlineSnapshotFetchedAt: null,
        lastError: null,
        remoteBundleSha256:
          typeof lanProbe.health?.frontend_bundle_sha256 === 'string'
            ? lanProbe.health.frontend_bundle_sha256
            : null,
      });
      return { baseUrl: cfg.lanUrl, channel: 'lan' };
    }
  }

  if (cfg.remoteUrl) {
    const remoteProbe = await probeBackendHealth(cfg.remoteUrl, REMOTE_PROBE_TIMEOUT_MS);
    if (remoteProbe.reachable) {
      cachedChannel = {
        baseUrl: cfg.remoteUrl,
        channel: 'remote',
        expiresAt: now + CHANNEL_CACHE_TTL_MS,
      };
      emitStatus({
        channel: 'remote',
        activeBaseUrl: cfg.remoteUrl,
        lastLatencyMs: remoteProbe.latencyMs,
        lastCheckedAt: checkedAt,
        offlineSnapshotFetchedAt: null,
        lastError: null,
        remoteBundleSha256:
          typeof remoteProbe.health?.frontend_bundle_sha256 === 'string'
            ? remoteProbe.health.frontend_bundle_sha256
            : null,
      });
      return { baseUrl: cfg.remoteUrl, channel: 'remote' };
    }
  }

  cachedChannel = {
    baseUrl: '',
    channel: 'offline',
    expiresAt: now + 5000,
  };
  emitStatus({
    channel: 'offline',
    activeBaseUrl: '',
    lastLatencyMs: null,
    lastCheckedAt: checkedAt,
    offlineSnapshotFetchedAt: getLatestOfflineSnapshotTime(),
    lastError: '电脑后端未连接（局域网与远程通道均不可达）',
  });
  return { baseUrl: '', channel: 'offline' };
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
  options?: RequestInit & { skipAuth?: boolean; forceProbe?: boolean }
): Promise<{ response: Response; baseUrl: string; channel: BackendChannel }> {
  const { skipAuth, forceProbe, ...fetchInit } = options ?? {};
  const { channel, baseUrl } = await resolveActiveBackendBase(Boolean(forceProbe));
  if (channel === 'offline') {
    throw new Error('电脑后端未连接');
  }
  const url = buildApiUrl(path, baseUrl);
  const headers = buildAuthHeaders(fetchInit.headers, channel, skipAuth);
  const finalInit: RequestInit = headers ? { ...fetchInit, headers } : fetchInit;
  const response = await fetch(url, finalInit);
  return { response, baseUrl, channel };
}

export async function apiRequestJson<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST';
    signal?: AbortSignal;
    fallbackToCache?: boolean;
  }
): Promise<T> {
  const method = options?.method ?? 'GET';
  const allowCache = (options?.fallbackToCache ?? true) && method === 'GET' && isCacheableExpertEndpoint(path);

  const tryReadCache = (fallbackReason: string): T => {
    if (allowCache) {
      const snap = readOfflineSnapshot<T>(path);
      if (snap) {
        emitStatus({
          channel: 'offline',
          activeBaseUrl: '',
          offlineSnapshotFetchedAt: snap.fetched_at,
          lastError: fallbackReason,
        });
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
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 401) {
        emitStatus({ lastError: '设备配对令牌未通过鉴权（HTTP 401），请在设置页重新配对' });
      }
      const detail = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} (${path}): ${detail.slice(0, 160)}`);
    }

    const payload = (await response.json()) as T;
    if (channel !== 'offline' && statusSnapshot.channel === 'offline') {
      emitStatus({ channel, activeBaseUrl: baseUrl, offlineSnapshotFetchedAt: null, lastError: null });
    }
    if (allowCache && (isNativeApp() || hasConfiguredRemoteBackend())) {
      writeOfflineSnapshot(path, payload, { sourceUrl: buildApiUrl(path, baseUrl) });
    }
    return payload;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    // 通道可能切换，清除内存通道缓存以便下次重探；若可离线读快照则回退
    if (shouldUseRemoteDualChannel()) {
      cachedChannel = null;
      return tryReadCache(err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

export async function apiRequestText(
  path: string,
  options?: { signal?: AbortSignal }
): Promise<string> {
  const { response } = await apiFetch(path, {
    method: 'GET',
    signal: options?.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} (${path}): ${detail.slice(0, 160)}`);
  }
  return await response.text();
}
