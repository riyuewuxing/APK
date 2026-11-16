import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { useToast } from '@/components/common';
import { fetchLatestAppRelease } from '@/services/expertApi';
import { getInstalledAppInfo } from './appUpdate';
import { hasConfiguredRemoteBackend, isNativeApp } from './runtime';
import { closeTopModal, isRootTabRoute } from './modalStack';

const EXIT_TOAST_MS = 2000;

/**
 * 原生安卓（iQOO 13 / OriginOS 7）运行桥接：
 * 1. 启动 3 秒内上报告知 CapacitorUpdater 当前前端包健康，避免回滚；
 * 2. 接管全面屏侧滑返回手势，按“弹层 -> 子页 -> 根 Tab 双滑最小化”分级响应。
 */
export function MobileNativeBridge() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [exitToastVisible, setExitToastVisible] = useState(false);

  const locationRef = useRef({ pathname: location.pathname, search: location.search });
  const lastRootBackRef = useRef<number>(0);
  const toastTimerRef = useRef<number | null>(null);
  const checkedUpdateRef = useRef(false);

  useEffect(() => {
    locationRef.current = { pathname: location.pathname, search: location.search };
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!isNativeApp()) {
      return undefined;
    }

    let disposed = false;
    let backHandle: { remove: () => Promise<void> } | null = null;

    CapacitorUpdater.notifyAppReady().catch((err) => {
      console.warn('[OTA] notifyAppReady 上报失败:', err);
    });

    if (!checkedUpdateRef.current && hasConfiguredRemoteBackend()) {
      checkedUpdateRef.current = true;
      void Promise.all([getInstalledAppInfo(), fetchLatestAppRelease()])
        .then(([installed, remote]) => {
          if (
            disposed ||
            !installed ||
            !remote?.available ||
            typeof remote.version_code !== 'number'
          ) {
            return;
          }
          if (remote.version_code > installed.versionCode) {
            toast.info(
              `发现原生新版 v${remote.version_name || remote.version_code}，可前往「设置」应用内一键更新`
            );
          }
        })
        .catch(() => {
          // 离线或尚未配对时不打扰启动使用
        });
    }

    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (disposed) {
        return;
      }

      if (closeTopModal()) {
        return;
      }

      const { pathname, search } = locationRef.current;
      if (!isRootTabRoute(pathname, search)) {
        if (canGoBack || window.history.length > 1) {
          navigate(-1);
          return;
        }
        navigate('/expert', { replace: true });
        return;
      }

      const now = Date.now();
      if (now - lastRootBackRef.current <= EXIT_TOAST_MS) {
        setExitToastVisible(false);
        if (toastTimerRef.current !== null) {
          window.clearTimeout(toastTimerRef.current);
          toastTimerRef.current = null;
        }
        lastRootBackRef.current = 0;
        void CapacitorApp.minimizeApp();
        return;
      }

      lastRootBackRef.current = now;
      setExitToastVisible(true);
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setExitToastVisible(false);
        toastTimerRef.current = null;
      }, EXIT_TOAST_MS);
    })
      .then((handle) => {
        if (disposed) {
          void handle.remove();
        } else {
          backHandle = handle;
        }
      })
      .catch((err) => {
        console.warn('[NativeBridge] 注册返回手势监听失败:', err);
      });

    return () => {
      disposed = true;
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      if (backHandle) {
        void backHandle.remove();
      }
    };
  }, [navigate, toast]);

  if (!exitToastVisible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        padding: '8px 16px',
        borderRadius: '999px',
        background: 'rgba(15, 23, 42, 0.92)',
        color: '#f8fafc',
        fontSize: '13px',
        fontWeight: 500,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      再滑一次退出投资专家
    </div>
  );
}
