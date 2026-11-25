/**
 * 移动端离线快照缓存层
 * 电脑后端开机连接成功时自动持久化专家工作台/雷达/深研卡/审计快照；
 * 电脑关机或不可达时显式返回带 fetched_at 时间戳的只读缓存快照（绝不伪造实时数据）。
 */

import { getMobileCacheScope } from '@/platform/runtime';

export interface OfflineSnapshotEntry<T = unknown> {
  key: string;
  scope?: string;
  payload: T;
  fetched_at: string;
  backend_commit: string | null;
  source_url: string;
}

const SNAPSHOT_PREFIX = 'tz.offline_snapshot.v1:';
const CACHEABLE_EXPERT_PREFIXES = [
  '/api/workbench',
  '/api/radar',
  '/api/research/',
  '/api/v1/research/',
  '/api/audit',
  '/api/quantstats/tearsheet',
  '/api/market/global-pulse',
];

function getSafeStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function isCacheableExpertEndpoint(path: string): boolean {
  const clean = path.split('?')[0] ?? path;
  if (clean === '/api/quantstats/tearsheet' && path.includes('format=html')) {
    return false;
  }
  return CACHEABLE_EXPERT_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(prefix)
  );
}

function scopedSnapshotStorageKey(key: string, scope = getMobileCacheScope()): string {
  return `${SNAPSHOT_PREFIX}${scope}:${key}`;
}

export function writeOfflineSnapshot<T>(
  key: string,
  payload: T,
  meta: {
    sourceUrl: string;
    backendCommit?: string | null;
    fetchedAt?: string;
    scope?: string;
  }
): OfflineSnapshotEntry<T> {
  const scope = meta.scope ?? getMobileCacheScope();
  const entry: OfflineSnapshotEntry<T> = {
    key,
    scope,
    payload,
    fetched_at: meta.fetchedAt ?? new Date().toISOString(),
    backend_commit: meta.backendCommit ?? null,
    source_url: meta.sourceUrl,
  };
  const storage = getSafeStorage();
  if (storage) {
    try {
      storage.setItem(scopedSnapshotStorageKey(key, scope), JSON.stringify(entry));
    } catch {
      // 容量不足时仅忽略写入，不阻塞正常业务
    }
  }
  return entry;
}

export function readOfflineSnapshot<T>(
  key: string,
  scope = getMobileCacheScope()
): OfflineSnapshotEntry<T> | null {
  const storage = getSafeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(scopedSnapshotStorageKey(key, scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineSnapshotEntry<T>>;
    if (!parsed || typeof parsed.fetched_at !== 'string' || !('payload' in parsed)) {
      return null;
    }
    if (parsed.scope && parsed.scope !== scope) {
      return null;
    }
    return {
      key: typeof parsed.key === 'string' ? parsed.key : key,
      scope: parsed.scope ?? scope,
      payload: parsed.payload as T,
      fetched_at: parsed.fetched_at,
      backend_commit: typeof parsed.backend_commit === 'string' ? parsed.backend_commit : null,
      source_url: typeof parsed.source_url === 'string' ? parsed.source_url : '',
    };
  } catch {
    return null;
  }
}

export function getLatestOfflineSnapshotTime(scope = getMobileCacheScope()): string | null {
  const storage = getSafeStorage();
  if (!storage) return null;
  const prefix = `${SNAPSHOT_PREFIX}${scope}:`;
  let latest: string | null = null;
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (!k || !k.startsWith(prefix)) continue;
    try {
      const parsed = JSON.parse(storage.getItem(k) ?? '') as { fetched_at?: unknown };
      if (typeof parsed.fetched_at === 'string') {
        if (!latest || parsed.fetched_at > latest) {
          latest = parsed.fetched_at;
        }
      }
    } catch {
      // ignore corrupted entry
    }
  }
  return latest;
}

export function clearOfflineSnapshots(scope?: string): void {
  const storage = getSafeStorage();
  if (!storage) return;
  const prefix = scope ? `${SNAPSHOT_PREFIX}${scope}:` : SNAPSHOT_PREFIX;
  const keysToDelete: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k && k.startsWith(prefix)) {
      keysToDelete.push(k);
    }
  }
  keysToDelete.forEach((k) => storage.removeItem(k));
}
