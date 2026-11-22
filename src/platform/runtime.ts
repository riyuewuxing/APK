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
}

const CONNECTION_STORAGE_KEY = 'tz.mobile.connection.v1';
const LOCAL_BUNDLE_SHA_KEY = 'tz.mobile.local_bundle_sha256';

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
  if (!/^https?:\/\/.+/i.test(trimmed)) {
    throw new Error(`无效的后端地址（须以 http:// 或 https:// 开头）: ${trimmed}`);
  }
  return trimmed;
}

export function getMobileConnectionConfig(): MobileConnectionConfig {
  const storage = getSafeStorage();
  if (!storage) return { ...DEFAULT_CONNECTION_CONFIG };
  try {
    const raw = storage.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONNECTION_CONFIG };
    const parsed = JSON.parse(raw) as Partial<MobileConnectionConfig>;
    return {
      lanUrl: typeof parsed.lanUrl === 'string' ? parsed.lanUrl : '',
      remoteUrl: typeof parsed.remoteUrl === 'string' ? parsed.remoteUrl : '',
      deviceToken: typeof parsed.deviceToken === 'string' ? parsed.deviceToken : '',
      autoWebBundleSync: Boolean(parsed.autoWebBundleSync),
    };
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
  const storage = getSafeStorage();
  if (storage) {
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function clearMobileConnectionConfig(): void {
  const storage = getSafeStorage();
  if (storage) {
    storage.removeItem(CONNECTION_STORAGE_KEY);
  }
}

export function hasConfiguredRemoteBackend(config?: MobileConnectionConfig): boolean {
  const cfg = config ?? getMobileConnectionConfig();
  return Boolean(cfg.lanUrl || cfg.remoteUrl);
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
  if (deviceToken.length < 16) {
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

  return {
    lanUrl: rawLan.trim() ? normalizeBackendUrl(rawLan) : '',
    remoteUrl: rawRemote.trim() ? normalizeBackendUrl(rawRemote) : '',
    deviceToken,
  };
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
