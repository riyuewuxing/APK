import { useCallback, useEffect, useState } from 'react';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { Check, Copy, DownloadCloud, Link2, RefreshCw, ShieldAlert, Smartphone, Trash2, Wifi } from 'lucide-react';
import { Button, Card, useToast } from '@/components/common';
import {
  downloadAndInstallApk,
  getInstalledAppInfo,
  openInstallPermissionSettings,
  subscribeApkDownloadProgress,
  type InstalledAppInfo,
} from '@/platform/appUpdate';
import {
  clearMobileConnectionConfig,
  getLocalBundleSha256,
  getMobileConnectionConfig,
  hasConfiguredRemoteBackend,
  isNativeApp,
  parsePairingCode,
  saveMobileConnectionConfig,
  setLocalBundleSha256,
} from '@/platform/runtime';
import {
  getBackendStatusSnapshot,
  probeBackendHealth,
  resolveActiveBackendBase,
  subscribeBackendStatus,
  type BackendStatusSnapshot,
} from '@/services/apiClient';
import {
  fetchLatestAppRelease,
  fetchMobilePairing,
  fetchWebBundleManifest,
  type AppReleaseInfo,
  type MobilePairingInfo,
  type WebBundleManifest,
} from '@/services/expertApi';
import styles from './Settings.module.css';

function formatApkMb(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return '-';
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function maskToken(token: string): string {
  const clean = token.trim();
  if (!clean) return '未配置';
  if (clean.length <= 10) return '••••••';
  return `${clean.slice(0, 6)}••••••${clean.slice(-4)}`;
}

function formatChannelBadge(status: BackendStatusSnapshot): {
  label: string;
  tone: 'ok' | 'warn' | 'muted';
} {
  const ms = status.lastLatencyMs;
  if (status.channel === 'lan') {
    return {
      label: `局域网直连已通${typeof ms === 'number' ? ` (${ms} ms)` : ''}`,
      tone: 'ok',
    };
  }
  if (status.channel === 'remote') {
    return {
      label: `Tailscale 私网已通${typeof ms === 'number' ? ` (${ms} ms)` : ''}`,
      tone: 'ok',
    };
  }
  if (status.channel === 'offline') {
    return {
      label: '离线快照模式（桌面主机未在线，实时行情仍可用）',
      tone: 'warn',
    };
  }
  return {
    label: isNativeApp() ? '未配置桌面主机，当前仅可使用离线缓存与实时行情' : '桌面同源直连模式',
    tone: 'muted',
  };
}

export function MobileSyncCard() {
  const toast = useToast();
  const native = isNativeApp();

  const initialConfig = getMobileConnectionConfig();
  const [lanUrl, setLanUrl] = useState(initialConfig.lanUrl);
  const [remoteUrl, setRemoteUrl] = useState(initialConfig.remoteUrl);
  const [deviceToken, setDeviceToken] = useState(initialConfig.deviceToken);
  const [showToken, setShowToken] = useState(false);
  const [pairingInput, setPairingInput] = useState('');
  const [desktopPairing, setDesktopPairing] = useState<MobilePairingInfo | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const [backendStatus, setBackendStatus] = useState<BackendStatusSnapshot>(() =>
    getBackendStatusSnapshot()
  );
  const [testingConn, setTestingConn] = useState(false);
  const [localBundleSha, setLocalBundleSha] = useState<string>(
    () => getLocalBundleSha256() ?? ''
  );
  const [nativeBundleVersion, setNativeBundleVersion] = useState<string>('builtin');
  const [remoteManifest, setRemoteManifest] = useState<WebBundleManifest | null>(null);
  const [checkingBundle, setCheckingBundle] = useState(false);
  const [syncingBundle, setSyncingBundle] = useState(false);

  const [installedApp, setInstalledApp] = useState<InstalledAppInfo | null>(null);
  const [remoteAppRelease, setRemoteAppRelease] = useState<AppReleaseInfo | null>(null);
  const [checkingAppRelease, setCheckingAppRelease] = useState(false);
  const [updatingApk, setUpdatingApk] = useState(false);
  const [apkDownloadPercent, setApkDownloadPercent] = useState<number | null>(null);
  const [needsInstallPerm, setNeedsInstallPerm] = useState(false);

  useEffect(() => subscribeBackendStatus(setBackendStatus), []);

  useEffect(() => {
    if (!native) {
      return;
    }
    CapacitorUpdater.current()
      .then((res) => {
        const ver = res?.bundle?.version || res?.native || 'builtin';
        setNativeBundleVersion(ver);
      })
      .catch(() => {
        setNativeBundleVersion('builtin');
      });
    getInstalledAppInfo()
      .then((info) => {
        if (info) {
          setInstalledApp(info);
          setNeedsInstallPerm(!info.canRequestPackageInstalls);
        }
      })
      .catch(() => {
        // 兼容非标准外壳测试环境
      });
  }, [native]);

  useEffect(() => {
    if (native) {
      return;
    }
    const controller = new AbortController();
    fetchMobilePairing(8502, controller.signal)
      .then((info) => {
        setDesktopPairing(info);
      })
      .catch(() => {
        // 非本机回环或未启动移动网关时不阻塞设置页
      });
    return () => controller.abort();
  }, [native]);

  const handleCheckManifest = useCallback(
    async (silent = false) => {
      setCheckingBundle(true);
      try {
        const manifest = await fetchWebBundleManifest();
        setRemoteManifest(manifest);
        if (!silent) {
          toast.success(`已获取主机最新前端版本 ${manifest.bundle_version}`);
        }
      } catch (err) {
        if (!silent) {
          const msg = err instanceof Error ? err.message : '无法读取主机前端版本';
          toast.error(msg);
        }
      } finally {
        setCheckingBundle(false);
      }
    },
    [toast]
  );

  const handleCheckAppRelease = useCallback(
    async (silent = false) => {
      setCheckingAppRelease(true);
      try {
        const info = await fetchLatestAppRelease();
        setRemoteAppRelease(info);
        if (!silent) {
          if (!info.available) {
            toast.info('桌面端暂未发现已编译的 APK 安装包');
          } else {
            toast.success(
              `已获取主机原生 APK: v${info.version_name ?? '-'} (code ${info.version_code ?? '-'})`
            );
          }
        }
      } catch (err) {
        if (!silent) {
          const msg = err instanceof Error ? err.message : '无法读取主机 APK 发布信息';
          toast.error(msg);
        }
      } finally {
        setCheckingAppRelease(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (!native || !hasConfiguredRemoteBackend(getMobileConnectionConfig())) {
      return;
    }
    let cancelled = false;
    resolveActiveBackendBase()
      .then((resolved) => {
        if (cancelled || resolved.channel === 'offline') return;
        void handleCheckManifest(true);
        void handleCheckAppRelease(true);
      })
      .catch(() => {
        // 连通失败已由 resolveActiveBackendBase 统一降级为离线状态
      });
    return () => {
      cancelled = true;
    };
  }, [native, handleCheckAppRelease, handleCheckManifest]);

  const handleSaveAndTest = useCallback(
    async (nextOverride?: { lanUrl: string; remoteUrl: string; deviceToken: string }) => {
      const saved = saveMobileConnectionConfig(
        nextOverride ?? { lanUrl, remoteUrl, deviceToken }
      );
      setLanUrl(saved.lanUrl);
      setRemoteUrl(saved.remoteUrl);
      setDeviceToken(saved.deviceToken);
      setTestingConn(true);
      try {
        const [lanProbe, remoteProbe] = await Promise.all([
          saved.lanUrl ? probeBackendHealth(saved.lanUrl, 1200) : Promise.resolve(null),
          saved.remoteUrl ? probeBackendHealth(saved.remoteUrl, 2500) : Promise.resolve(null),
        ]);
        const resolved = await resolveActiveBackendBase(true);
        if (resolved.channel !== 'offline') {
          const picked = lanProbe?.reachable
            ? `局域网直连已通 (${lanProbe.latencyMs ?? '-'}ms)`
            : remoteProbe?.reachable
              ? `Tailscale 私网已通 (${remoteProbe.latencyMs ?? '-'}ms)`
              : '主机连通正常';
          toast.success(picked);
          void handleCheckManifest(true);
          void handleCheckAppRelease(true);
        } else if (hasConfiguredRemoteBackend(saved)) {
          toast.info('当前未能连通电脑主机，将自动展示本地离线快照');
        } else {
          toast.info('配置已保存');
        }
      } finally {
        setTestingConn(false);
      }
    },
    [deviceToken, handleCheckAppRelease, handleCheckManifest, lanUrl, remoteUrl, toast]
  );

  const handleParsePairing = () => {
    try {
      const parsed = parsePairingCode(pairingInput);
      setPairingInput('');
      void handleSaveAndTest(parsed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '配对码格式无效');
    }
  };

  const handleClearConfig = () => {
    clearMobileConnectionConfig();
    setLanUrl('');
    setRemoteUrl('');
    setDeviceToken('');
    void resolveActiveBackendBase(true);
    toast.info('已清空手机端连接配对配置');
  };

  const handleCopyDesktopPairing = async () => {
    if (!desktopPairing?.pairing_code) return;
    try {
      await navigator.clipboard.writeText(desktopPairing.pairing_code);
      setCopiedCode(true);
      toast.success('已复制手机配对码');
      window.setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      toast.error('浏览器未授予剪贴板权限，请手动全选复制');
    }
  };

  const handleOneClickOtaSync = async () => {
    if (!native) {
      await handleCheckManifest(false);
      toast.info('当前为桌面/浏览器预览；在手机 APK 中点击此处可 1 秒热更新界面');
      return;
    }
    setSyncingBundle(true);
    try {
      const resolved = await resolveActiveBackendBase(true);
      if (resolved.channel === 'offline' || !resolved.baseUrl) {
        toast.error('未连通桌面主机，无法下载最新前端资源包');
        return;
      }
      const manifest = await fetchWebBundleManifest();
      setRemoteManifest(manifest);
      const localKnownSha = getLocalBundleSha256();
      if (localKnownSha && localKnownSha === manifest.bundle_sha256) {
        toast.success(`当前已经是最新版本 (${manifest.bundle_version})`);
        return;
      }
      const relativeUrl = manifest.download_url || '/api/mobile/web-bundle/download';
      const downloadUrl = `${resolved.baseUrl}${relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`}`;
      if (!manifest.zip_sha256) {
        toast.error('主机版本清单缺少 zip_sha256，请重启电脑端最新终端服务后重试');
        return;
      }
      const bundle = await CapacitorUpdater.download({
        url: downloadUrl,
        version: manifest.bundle_version || manifest.bundle_sha256.slice(0, 12),
        checksum: manifest.zip_sha256,
      });
      setLocalBundleSha256(manifest.bundle_sha256);
      setLocalBundleSha(manifest.bundle_sha256);
      toast.success(`已下载 ${manifest.bundle_version}，正在瞬间热切换界面...`);
      await CapacitorUpdater.set({ id: bundle.id });
    } catch (err) {
      const errObj = err as { message?: string; code?: string } | null;
      const msg =
        err instanceof Error
          ? err.message
          : typeof errObj?.message === 'string' && errObj.message
            ? errObj.message
            : '热更新失败';
      toast.error(`热更新失败: ${msg}`);
    } finally {
      setSyncingBundle(false);
    }
  };

  const handleInAppApkUpgrade = async () => {
    if (!native) {
      await handleCheckAppRelease(false);
      toast.info('当前为桌面/浏览器预览；在手机 APK 中点击此处可直接在应用内下载更新并调起系统安装');
      return;
    }

    setUpdatingApk(true);
    setApkDownloadPercent(0);
    let removeProgress: (() => void) | null = null;
    try {
      const resolved = await resolveActiveBackendBase(true);
      if (resolved.channel === 'offline' || !resolved.baseUrl) {
        toast.error('未连通电脑主机，无法检查或下载原生 APK');
        return;
      }

      const latestInfo = await fetchLatestAppRelease();
      setRemoteAppRelease(latestInfo);
      if (!latestInfo.available || !latestInfo.download_url || !latestInfo.apk_sha256) {
        toast.error('电脑端尚未发现可用的新版 APK 安装包');
        return;
      }

      const freshInstalled = (await getInstalledAppInfo().catch(() => null)) ?? installedApp;
      if (freshInstalled) {
        setInstalledApp(freshInstalled);
      }
      if (
        freshInstalled?.signingSha256 &&
        latestInfo.signing_sha256 &&
        freshInstalled.signingSha256 !== latestInfo.signing_sha256
      ) {
        toast.error('当前手机旧包与固定发布签名不一致，请先卸载旧包手动装一次固定签名版，之后即可应用内升级');
        return;
      }

      removeProgress = await subscribeApkDownloadProgress((evt) => {
        setApkDownloadPercent(evt.percent);
      });

      const relUrl = latestInfo.download_url;
      const downloadUrl = `${resolved.baseUrl}${relUrl.startsWith('/') ? relUrl : `/${relUrl}`}`;
      const res = await downloadAndInstallApk({
        url: downloadUrl,
        expectedSha256: latestInfo.apk_sha256,
      });
      if (res.status === 'NEEDS_PERMISSION') {
        setNeedsInstallPerm(true);
        toast.warning('新版 APK 已校验下载完成，请点击「授予安装权限」开启允许安装未知应用后再点立即更新');
        return;
      }
      setNeedsInstallPerm(false);
      toast.success('已完成 SHA-256 校验，正在调起系统安装器覆盖升级...');
    } catch (err) {
      const errObj = err as { message?: string } | null;
      const msg =
        err instanceof Error
          ? err.message
          : typeof errObj?.message === 'string' && errObj.message
            ? errObj.message
            : '应用内 APK 更新失败';
      toast.error(`APK 更新失败: ${msg}`);
    } finally {
      if (removeProgress) {
        removeProgress();
      }
      setUpdatingApk(false);
      setApkDownloadPercent(null);
    }
  };

  const handleOpenInstallPermission = async () => {
    try {
      await openInstallPermissionSettings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法打开安装权限设置页');
    }
  };

  const badge = formatChannelBadge(backendStatus);
  const upToDate =
    Boolean(localBundleSha && remoteManifest?.bundle_sha256) &&
    localBundleSha === remoteManifest?.bundle_sha256;
  const apkUpgradeAvailable = Boolean(
    remoteAppRelease?.available &&
    typeof remoteAppRelease.version_code === 'number' &&
    (!installedApp || remoteAppRelease.version_code > installedApp.versionCode)
  );
  const signingMismatch = Boolean(
    installedApp?.signingSha256 &&
    remoteAppRelease?.signing_sha256 &&
    installedApp.signingSha256 !== remoteAppRelease.signing_sha256
  );

  return (
    <Card>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Smartphone size={18} className={styles.sectionIcon} />
          <h3>{native ? '移动端连接与界面热更新' : '手机端配对凭证（桌面端）'}</h3>
        </div>
        <div className={styles.sectionContent}>
          <div className={styles.mobileStatusRow}>
            <span
              className={`${styles.mobileStatusBadge} ${badge.tone === 'ok'
                ? styles.mobileStatusOk
                : badge.tone === 'warn'
                  ? styles.mobileStatusWarn
                  : styles.mobileStatusMuted
                }`}
            >
              <Wifi size={14} />
              {badge.label}
            </span>
          </div>

          {!native && !desktopPairing && (
            <span className={styles.settingDesc}>
              未检测到本机 <code>:8502</code> 移动网关。通过桌面客户端启动移动网关后，此处会自动生成手机端配对码；粘贴导入、双通道地址配置、1 秒热更新及 APK 应用内升级仅在手机 App 内展示。
            </span>
          )}

          {!native && desktopPairing && (
            <div className={styles.pairingBox}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>电脑端配对凭证（局域网 / Tailscale）</span>
                <span className={styles.settingDesc}>
                  在 iQOO 13 App「设置 → 配对码」粘贴下方字符即可免手输连入 :8502 移动网关
                </span>
              </div>
              <div className={styles.pairingMetaGrid}>
                <div>
                  <span className={styles.pairingMetaLabel}>局域网直连</span>
                  <code>{desktopPairing.lan_url || '未检测到内网 IP'}</code>
                </div>
                <div>
                  <span className={styles.pairingMetaLabel}>远程私网</span>
                  <code>{desktopPairing.remote_url || '未开启 Tailscale'}</code>
                </div>
                <div>
                  <span className={styles.pairingMetaLabel}>设备令牌</span>
                  <code>{maskToken(desktopPairing.device_token)}</code>
                </div>
              </div>
              <div className={styles.pairingCodeRow}>
                <input
                  readOnly
                  aria-label="桌面配对码"
                  className={styles.mobileFullInput}
                  value={desktopPairing.pairing_code}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={copiedCode ? <Check size={14} /> : <Copy size={14} />}
                  onClick={() => {
                    void handleCopyDesktopPairing();
                  }}
                >
                  {copiedCode ? '已复制' : '复制配对码'}
                </Button>
              </div>
            </div>
          )}

          {native && (
            <>
              <div className={styles.mobileFieldGroup}>
                <label className={styles.settingLabel} htmlFor="mobile-pairing-input">
                  粘贴配对码一键导入
                </label>
                <div className={styles.pairingCodeRow}>
                  <textarea
                    id="mobile-pairing-input"
                    rows={2}
                    className={styles.mobileTextarea}
                    placeholder="粘贴电脑端生成的 Base64 配对码..."
                    value={pairingInput}
                    onChange={(e) => setPairingInput(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Link2 size={14} />}
                    onClick={handleParsePairing}
                  >
                    导入并连接
                  </Button>
                </div>
              </div>

              <div className={styles.mobileFormGrid}>
                <div className={styles.mobileFieldGroup}>
                  <label className={styles.settingLabel} htmlFor="mobile-lan-url">
                    局域网直连地址 (:8502)
                  </label>
                  <input
                    id="mobile-lan-url"
                    className={styles.mobileFullInput}
                    placeholder="例如 http://192.168.1.8:8502"
                    value={lanUrl}
                    onChange={(e) => setLanUrl(e.target.value)}
                  />
                </div>
                <div className={styles.mobileFieldGroup}>
                  <label className={styles.settingLabel} htmlFor="mobile-remote-url">
                    Tailscale 远程地址
                  </label>
                  <input
                    id="mobile-remote-url"
                    className={styles.mobileFullInput}
                    placeholder="例如 https://pc.tailnet.ts.net"
                    value={remoteUrl}
                    onChange={(e) => setRemoteUrl(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.mobileFieldGroup}>
                <label className={styles.settingLabel} htmlFor="mobile-device-token">
                  设备 Bearer 令牌
                </label>
                <div className={styles.pairingCodeRow}>
                  <input
                    id="mobile-device-token"
                    type={showToken ? 'text' : 'password'}
                    className={styles.mobileFullInput}
                    placeholder="自动由配对码填入或手动输入"
                    value={deviceToken}
                    onChange={(e) => setDeviceToken(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowToken((prev) => !prev)}
                  >
                    {showToken ? '隐藏' : '显示'}
                  </Button>
                </div>
              </div>

              <div className={styles.mobileActionRow}>
                <Button
                  size="md"
                  variant="primary"
                  icon={<RefreshCw size={15} />}
                  disabled={testingConn}
                  onClick={() => {
                    void handleSaveAndTest();
                  }}
                >
                  {testingConn ? '正在测速双通道...' : '保存并重测双通道'}
                </Button>
                <Button
                  size="md"
                  variant="secondary"
                  icon={<Trash2 size={15} />}
                  onClick={handleClearConfig}
                >
                  清空手机配对
                </Button>
              </div>

              <div className={styles.otaBox}>
                <div className={styles.settingInfo}>
                  <span className={styles.settingLabel}>前端界面 1 秒 OTA 热更新（免重装 APK）</span>
                  <span className={styles.settingDesc}>
                    原生包状态: <code>{nativeBundleVersion}</code> · 本地 SHA:{' '}
                    <code>{localBundleSha ? localBundleSha.slice(0, 12) : '随 APK 内置'}</code> ·
                    主机最新:{' '}
                    <code>{remoteManifest ? remoteManifest.bundle_version : '未检查'}</code>
                    {remoteManifest ? ` (${remoteManifest.file_count} 文件)` : ''}
                  </span>
                </div>
                <div className={styles.mobileActionRow}>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<RefreshCw size={14} />}
                    disabled={checkingBundle}
                    onClick={() => {
                      void handleCheckManifest(false);
                    }}
                  >
                    {checkingBundle ? '检查中...' : '检查前端版本'}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<DownloadCloud size={14} />}
                    disabled={syncingBundle}
                    onClick={() => {
                      void handleOneClickOtaSync();
                    }}
                  >
                    {syncingBundle
                      ? '同步界面中...'
                      : upToDate
                        ? '已是最新界面'
                        : '1 秒同步最新界面'}
                  </Button>
                </div>
              </div>

              <div className={styles.otaBox}>
                <div className={styles.settingInfo}>
                  <span className={styles.settingLabel}>应用内原生 APK 版本升级（改原生插件/权限时使用）</span>
                  <span className={styles.settingDesc}>
                    当前安装:{' '}
                    <code>
                      {installedApp
                        ? `v${installedApp.versionName} (code ${installedApp.versionCode})`
                        : native
                          ? '读取中...'
                          : '桌面浏览器预览'}
                    </code>
                    {installedApp?.signingSha256
                      ? ` · 签名 ${installedApp.signingSha256.slice(0, 8)}`
                      : ''}
                    {' · '}
                    主机最新:{' '}
                    <code>
                      {remoteAppRelease?.available
                        ? `v${remoteAppRelease.version_name ?? '-'} (code ${remoteAppRelease.version_code ?? '-'}, ${formatApkMb(remoteAppRelease.apk_bytes)})`
                        : remoteAppRelease
                          ? '暂无新 APK'
                          : '未检查'}
                    </code>
                  </span>
                </div>

                {signingMismatch && (
                  <div className={styles.signingWarnText}>
                    当前旧包使用临时签名（{installedApp?.signingSha256.slice(0, 8)}），与固定发布证书（
                    {remoteAppRelease?.signing_sha256?.slice(0, 8)}）不一致；需先卸载旧包手动装一次新版，后续升级均可在应用内直接完成。
                  </div>
                )}

                {updatingApk && (
                  <div className={styles.updateProgressWrap}>
                    <span className={styles.settingDesc}>
                      {apkDownloadPercent !== null && apkDownloadPercent >= 0
                        ? `正在校验下载 APK (${apkDownloadPercent}%)...`
                        : '正在下载并校验 APK...'}
                    </span>
                    <div className={styles.updateProgressTrack}>
                      <div
                        className={styles.updateProgressFill}
                        style={{
                          width: `${apkDownloadPercent !== null && apkDownloadPercent >= 0 ? apkDownloadPercent : 35}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className={styles.mobileActionRow}>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<RefreshCw size={14} />}
                    disabled={checkingAppRelease}
                    onClick={() => {
                      void handleCheckAppRelease(false);
                    }}
                  >
                    {checkingAppRelease ? '检查 APK...' : '检查原生更新'}
                  </Button>
                  {native && needsInstallPerm && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<ShieldAlert size={14} />}
                      onClick={() => {
                        void handleOpenInstallPermission();
                      }}
                    >
                      授予安装权限
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<DownloadCloud size={14} />}
                    disabled={updatingApk || signingMismatch}
                    onClick={() => {
                      void handleInAppApkUpgrade();
                    }}
                  >
                    {updatingApk
                      ? '下载校验中...'
                      : apkUpgradeAvailable
                        ? '应用内下载并更新 APK'
                        : installedApp && remoteAppRelease?.available
                          ? '重下并覆盖当前 APK'
                          : '应用内更新 APK'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
