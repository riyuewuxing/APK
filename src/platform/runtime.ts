/**
 * 跨平台运行时与移动端连接配置层
 * 兼容桌面浏览器、PyWebView 桌面端与 Capacitor 8 安卓原生端。
 */

import { Capacitor } from '@capacitor/core';

export interface MobileConnectionConfig {
  lanUrl: string;
  remoteUrl: string;
  deviceToken: string;
  autoWebBundleSync: boolean;
  /** Random local namespace, rotated on every pairing identity change. */
  cacheScope?: string;
}

const CONNECTION_STORAGE_KEY = 'tz.mobile.connection.v1';
const LOCAL_BUNDLE_SHA_KEY = 'tz.mobile.local_bundle_sha256';
const SCOPE_PATTERN = /^host_v3_[0-9a-f]{32}$/;
let volatileIdentity = '';
let volatileScope = '';

function newScope(): string {
  // getRandomValues also works in a non-secure WebView context. No token-derived hash or fallback RNG.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return 'host_v3_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function pairingIdentity(cfg: MobileConnectionConfig): string {
  return JSON.stringify([cfg.lanUrl, cfg.remoteUrl, cfg.deviceToken]);
}
function transientScope(cfg: MobileConnectionConfig): string {
  const identity = pairingIdentity(cfg);
  if (identity !== volatileIdentity || !volatileScope) {
    volatileScope = newScope();
    volatileIdentity = identity;
  }
  return volatileScope;
}
function forgetOldCaches(storage: Storage): void {
  // Legacy SWR and offline caches may contain a previous account's data.
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith('tz.offline_snapshot.v1:') || key?.startsWith('tz.swr.v1.')) keys.push(key);
  }
  keys.forEach(key => storage.removeItem(key));
}

const DEFAULT_CONNECTION_CONFIG: MobileConnectionConfig = {
  lanUrl: '',
  remoteUrl: '',
  deviceToken: '',
  autoWebBundleSync: false,
};

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

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform() === true;
  } catch {
    return false;
  }
}

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 768;
}

export function normalizeBackendUrl(raw: string): string {
  const trimmed = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let url: URL;
  try { url = new URL(trimmed); }
  catch { throw new Error('无效的后端地址（须为 HTTP 或 HTTPS 主机）'); }
  if (!/^https?:\/\//i.test(trimmed) || /[\\\s]/.test(trimmed)
      || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('后端地址必须是 HTTP(S) origin，不可包含凭据、路径、查询或片段');
  }
  return url.origin;
}

export function getMobileConnectionConfig(): MobileConnectionConfig {
  const storage = getSafeStorage();
  if (!storage) return { ...DEFAULT_CONNECTION_CONFIG };
  try {
    const raw = storage.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONNECTION_CONFIG };
    const parsed = JSON.parse(raw) as Partial<MobileConnectionConfig>;
    const cfg: MobileConnectionConfig = {
      lanUrl: typeof parsed.lanUrl === 'string' ? normalizeBackendUrl(parsed.lanUrl) : '',
      remoteUrl: typeof parsed.remoteUrl === 'string' ? normalizeBackendUrl(parsed.remoteUrl) : '',
      deviceToken: typeof parsed.deviceToken === 'string' ? parsed.deviceToken : '',
      autoWebBundleSync: Boolean(parsed.autoWebBundleSync),
    };
    if (typeof parsed.cacheScope === 'string' && SCOPE_PATTERN.test(parsed.cacheScope)
        && cfg.lanUrl === parsed.lanUrl && cfg.remoteUrl === parsed.remoteUrl) {
      cfg.cacheScope = parsed.cacheScope;
    } else {
      // No trust in legacy short hashes. Create a fresh namespace on first read.
      cfg.cacheScope = transientScope(cfg);
      try {
        forgetOldCaches(storage);
        storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(cfg));
      } catch { /* inaccessible storage: scope remains process-local */ }
    }
    return cfg;
  } catch {
    return { ...DEFAULT_CONNECTION_CONFIG };
  }
}

export function saveMobileConnectionConfig(
  updates: Partial<MobileConnectionConfig>
): MobileConnectionConfig {
  const current = getMobileConnectionConfig();
  const next: MobileConnectionConfig = {
    lanUrl: updates.lanUrl !== undefined ? normalizeBackendUrl(updates.lanUrl) : current.lanUrl,
    remoteUrl:
      updates.remoteUrl !== undefined ? normalizeBackendUrl(updates.remoteUrl) : current.remoteUrl,
    deviceToken:
      updates.deviceToken !== undefined ? String(updates.deviceToken).trim() : current.deviceToken,
    autoWebBundleSync:
      updates.autoWebBundleSync !== undefined
        ? Boolean(updates.autoWebBundleSync)
        : current.autoWebBundleSync,
  };
  const changed = pairingIdentity(current) !== pairingIdentity(next);
  next.cacheScope = !changed && current.cacheScope && SCOPE_PATTERN.test(current.cacheScope)
    ? current.cacheScope : newScope();
  const storage = getSafeStorage();
  if (storage) {
    if (changed) forgetOldCaches(storage);
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(next));
  }
  if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event('tz-pairing-changed'));
  return next;
}

export function clearMobileConnectionConfig(): void {
  const storage = getSafeStorage();
  if (storage) {
    storage.removeItem(CONNECTION_STORAGE_KEY);
    forgetOldCaches(storage);
  }
  volatileIdentity = '';
  volatileScope = '';
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('tz-pairing-changed'));
}

export function hasConfiguredRemoteBackend(config?: MobileConnectionConfig): boolean {
  const cfg = config ?? getMobileConnectionConfig();
  return Boolean(cfg.lanUrl || cfg.remoteUrl);
}

/**
 * Derive a stable, non-secret cache namespace for the currently paired host + token.
 */
export function getMobileCacheScope(config?: MobileConnectionConfig): string {
  const cfg = config ?? getMobileConnectionConfig();
  if (!isNativeApp() && !hasConfiguredRemoteBackend(cfg)) {
    return 'local';
  }
  return cfg.cacheScope && SCOPE_PATTERN.test(cfg.cacheScope)
    ? cfg.cacheScope : transientScope(cfg);
}

function decodeBase64Utf8(raw: string): string {
  const normalized = raw.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

export function parsePairingCode(rawCode: string): {
  lanUrl: string;
  remoteUrl: string;
  deviceToken: string;
} {
  const clean = rawCode.trim();
  if (!clean) {
    throw new Error('配对码不能为空');
  }
  let parsed: Record<string, unknown>;
  try {
    const jsonText = clean.startsWith('{') ? clean : decodeBase64Utf8(clean);
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed.v !== undefined && parsed.v !== 1)) throw new Error('version');
  } catch {
    throw new Error('配对码格式无效，请从电脑端设置页重新复制');
  }

  const rawToken =
    typeof parsed.device_token === 'string'
      ? parsed.device_token
      : typeof parsed.deviceToken === 'string'
        ? parsed.deviceToken
        : '';
  const deviceToken = rawToken.trim();
  if (deviceToken.length < 16 || /[^\x21-\x7e]/.test(deviceToken)) {
    throw new Error('配对码缺少有效的设备配对令牌');
  }

  const rawLan =
    typeof parsed.lan_url === 'string'
      ? parsed.lan_url
      : typeof parsed.lanUrl === 'string'
        ? parsed.lanUrl
        : '';
  const rawRemote =
    typeof parsed.remote_url === 'string'
      ? parsed.remote_url
      : typeof parsed.remoteUrl === 'string'
        ? parsed.remoteUrl
        : '';

  const lanUrl = rawLan.trim() ? normalizeBackendUrl(rawLan) : '';
  const remoteUrl = rawRemote.trim() ? normalizeBackendUrl(rawRemote) : '';
  if (!lanUrl && !remoteUrl) throw new Error('配对码缺少主机地址');
  return { lanUrl, remoteUrl, deviceToken };
}

export function getLocalBundleSha256(): string | null {
  const storage = getSafeStorage();
  if (!storage) return null;
  const val = storage.getItem(LOCAL_BUNDLE_SHA_KEY);
  return val && val.trim() ? val.trim() : null;
}

export function setLocalBundleSha256(sha256: string): void {
  const storage = getSafeStorage();
  if (storage && sha256.trim()) {
    storage.setItem(LOCAL_BUNDLE_SHA_KEY, sha256.trim());
  }
}

/** React subscription; pairing changes invalidate the mounted private session tree. */
export function subscribeMobilePairingScope(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const storageListener = (event: StorageEvent) => { if (!event.key || event.key === CONNECTION_STORAGE_KEY) listener(); };
  window.addEventListener('storage', storageListener);
  window.addEventListener('tz-pairing-changed', listener);
  return () => { window.removeEventListener('storage', storageListener); window.removeEventListener('tz-pairing-changed', listener); };
}
