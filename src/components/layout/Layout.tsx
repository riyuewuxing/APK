/**
 * 应用主布局
 */

import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileTabBar } from './MobileTabBar';
import { ErrorBoundary, ThemeBackdrop } from '@/components/common';
import { fetchHealth } from '@/services/expertApi';
import {
  getBackendStatusSnapshot,
  resolveActiveBackendBase,
  subscribeBackendStatus,
  type BackendStatusSnapshot,
} from '@/services/apiClient';
import { MobileNativeBridge } from '@/platform/nativeBridge';
import { useTheme } from '@/hooks';
import { getThemePresetSpec } from '@/themes/presets';
import styles from './Layout.module.css';

function formatSnapshotTime(iso?: string): string {
  if (!iso) {
    return '暂无本地快照时间';
  }
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { preset } = useTheme();
  const activePreset = getThemePresetSpec(preset);
  const [governanceLock, setGovernanceLock] = useState<string>(
    'RESEARCH_ONLY=TRUE | AUTO_EXECUTION=FORBIDDEN'
  );
  const [backendStatus, setBackendStatus] = useState<BackendStatusSnapshot>(() =>
    getBackendStatusSnapshot()
  );
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => subscribeBackendStatus(setBackendStatus), []);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((res) => {
        if (res.execution_lock_label) {
          setGovernanceLock(res.execution_lock_label);
        } else if (res.research_only && !res.execution_allowed) {
          setGovernanceLock('RESEARCH_ONLY=TRUE | AUTO_EXECUTION=FORBIDDEN');
        }
      })
      .catch(() => {
        // 离线回退仅作安全标识展示，不放行执行
      });
    return () => controller.abort();
  }, []);

  return (
    <div className={styles.layout}>
      <ThemeBackdrop />
      <MobileNativeBridge />
      <Sidebar />
      <Header />
      <main className={styles.main}>
        <div className={styles.content}>
          {backendStatus.channel === 'offline' && (
            <div className={styles.offlineBanner} role="status">
              <div className={styles.offlineBannerText}>
                <span>
                  桌面主机未在线（当前展示离线缓存快照 ·{' '}
                  {formatSnapshotTime(backendStatus.offlineSnapshotFetchedAt ?? undefined)} ·
                  实时行情照常刷新）
                </span>
              </div>
              <div className={styles.offlineBannerActions}>
                <button
                  type="button"
                  className={styles.offlineBannerBtn}
                  disabled={reconnecting}
                  onClick={() => {
                    setReconnecting(true);
                    void resolveActiveBackendBase(true).finally(() => {
                      setReconnecting(false);
                    });
                  }}
                >
                  {reconnecting ? '探测中...' : '重连主机'}
                </button>
                <button
                  type="button"
                  className={styles.offlineBannerBtn}
                  onClick={() => navigate('/settings')}
                >
                  配对设置
                </button>
              </div>
            </div>
          )}
          {/* key 按路径复位：某页渲染崩溃后导航到其他页可自动恢复；轻量淡入微位移不驻留 transform */}
          <div key={location.pathname} className={styles.pageTransition}>
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </div>
        <footer className={styles.footer}>
          <span className={styles.statusLive}>
            <span className={styles.statusDot} />
            <span>{governanceLock}</span>
          </span>
          <span className={styles.divider}>|</span>
          <span className={styles.presetChip}>{activePreset.name}</span>
          <span className={styles.divider}>|</span>
          <span>数据来源：</span>
          <a
            href="https://stock-sdk.linkdiary.cn/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Stock SDK
          </a>
          <span>&amp; 本地 PIT 账本</span>
          <span className={styles.divider}>|</span>
          <span>仅供学习研究决策支持，严禁实盘自动下单</span>
        </footer>
      </main>
      <MobileTabBar />
    </div>
  );
}
