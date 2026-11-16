import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativeApp } from './runtime';

export interface InstalledAppInfo {
  packageName: string;
  versionCode: number;
  versionName: string;
  canRequestPackageInstalls: boolean;
  signingSha256: string;
}

export interface ApkDownloadProgressEvent {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface DownloadAndInstallResult {
  status: 'INSTALLER_LAUNCHED' | 'NEEDS_PERMISSION';
  sha256: string;
  bytes: number;
  apkReady?: boolean;
}

interface NativeAppUpdatePlugin {
  getInstalledInfo(): Promise<InstalledAppInfo>;
  openInstallPermissionSettings(): Promise<{ opened: boolean }>;
  downloadAndInstall(options: {
    url: string;
    expectedSha256: string;
    authToken?: string;
  }): Promise<DownloadAndInstallResult>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: ApkDownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>;
}

const NativeAppUpdate = registerPlugin<NativeAppUpdatePlugin>('AppUpdate');

export async function getInstalledAppInfo(): Promise<InstalledAppInfo | null> {
  if (!isNativeApp()) {
    return null;
  }
  return NativeAppUpdate.getInstalledInfo();
}

export async function openInstallPermissionSettings(): Promise<boolean> {
  if (!isNativeApp()) {
    return false;
  }
  const res = await NativeAppUpdate.openInstallPermissionSettings();
  return Boolean(res?.opened);
}

export async function downloadAndInstallApk(options: {
  url: string;
  expectedSha256: string;
  authToken?: string;
}): Promise<DownloadAndInstallResult> {
  if (!isNativeApp()) {
    throw new Error('当前非原生安卓环境，无法调用应用内 APK 安装器');
  }
  return NativeAppUpdate.downloadAndInstall(options);
}

export async function subscribeApkDownloadProgress(
  listener: (event: ApkDownloadProgressEvent) => void
): Promise<(() => void) | null> {
  if (!isNativeApp()) {
    return null;
  }
  const handle = await NativeAppUpdate.addListener('downloadProgress', listener);
  return () => {
    void handle.remove();
  };
}
