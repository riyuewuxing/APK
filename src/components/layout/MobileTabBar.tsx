import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BrainCircuit,
  Globe,
  LayoutDashboard,
  MoreHorizontal,
  Radar,
  ScanSearch,
  Settings,
  Star,
  TrendingUp,
  X,
} from 'lucide-react';
import { triggerClickRipple } from '@/components/common';
import { registerModalCloser } from '@/platform/modalStack';
import styles from './MobileTabBar.module.css';

interface TabItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const primaryTabs: TabItem[] = [
  { path: '/', label: '总览', icon: <LayoutDashboard size={20} /> },
  { path: '/markets', label: '市场', icon: <Globe size={20} /> },
  { path: '/watchlist', label: '自选', icon: <Star size={20} /> },
  { path: '/expert', label: '专家', icon: <BrainCircuit size={20} /> },
];

const moreItems: TabItem[] = [
  { path: '/expert-radar', label: '多资产雷达', icon: <Radar size={18} /> },
  { path: '/scanner', label: '信号扫描', icon: <ScanSearch size={18} /> },
  { path: '/eod-picker', label: '尾盘选股', icon: <TrendingUp size={18} /> },
  { path: '/settings', label: '设置与简报', icon: <Settings size={18} /> },
];

const MARKET_COMPAT_PREFIXES = ['/markets', '/heatmap', '/rankings', '/boards'];

function isRouteMatch(pathname: string, targetPath: string): boolean {
  if (targetPath === '/') {
    return pathname === '/';
  }
  if (targetPath === '/markets') {
    return MARKET_COMPAT_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`)
    );
  }
  return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
}

export function MobileTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive = moreItems.some((item) => isRouteMatch(location.pathname, item.path));

  useEffect(() => {
    if (!moreOpen) {
      return undefined;
    }
    return registerModalCloser('mobile-more-drawer', () => setMoreOpen(false));
  }, [moreOpen]);

  return (
    <>
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            className={styles.drawerBackdrop}
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setMoreOpen(false)}
          >
            <motion.div
              className={styles.drawerSheet}
              role="dialog"
              aria-label="更多功能导航"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.drawerHeader}>
                <span className={styles.drawerTitle}>更多工作区</span>
                <button
                  type="button"
                  className={styles.drawerClose}
                  aria-label="关闭更多导航"
                  onClick={() => setMoreOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className={styles.drawerGrid}>
                {moreItems.map((item) => {
                  const active = isRouteMatch(location.pathname, item.path);
                  return (
                    <button
                      key={item.path}
                      type="button"
                      className={`${styles.drawerItem} ${active ? styles.drawerItemActive : ''}`}
                      onClick={(e) => {
                        triggerClickRipple(e);
                        setMoreOpen(false);
                        navigate(item.path);
                      }}
                    >
                      <span className={styles.drawerIcon}>{item.icon}</span>
                      <span className={styles.drawerLabel}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className={styles.tabBar} aria-label="移动端主导航">
        {primaryTabs.map((tab) => {
          const active = isRouteMatch(location.pathname, tab.path);
          const tabActive = active && !moreOpen;
          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={`${styles.tabItem} ${tabActive ? styles.tabItemActive : ''}`}
              onClick={(e) => {
                triggerClickRipple(e);
                setMoreOpen(false);
              }}
            >
              {tabActive && (
                <motion.span
                  layoutId="mobile-tab-pill"
                  className={styles.tabActiveBar}
                  transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                />
              )}
              <motion.span
                className={styles.tabIcon}
                whileTap={{ scale: 0.85 }}
                transition={{ type: 'spring', stiffness: 520, damping: 24 }}
              >
                {tab.icon}
              </motion.span>
              <span className={styles.tabLabel}>{tab.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          className={`${styles.tabItem} ${moreOpen || isMoreActive ? styles.tabItemActive : ''}`}
          aria-expanded={moreOpen}
          onClick={(e) => {
            triggerClickRipple(e);
            setMoreOpen((prev) => !prev);
          }}
        >
          {(moreOpen || isMoreActive) && (
            <motion.span
              layoutId="mobile-tab-pill"
              className={styles.tabActiveBar}
              transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            />
          )}
          <motion.span
            className={styles.tabIcon}
            whileTap={{ scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 520, damping: 24 }}
          >
            <MoreHorizontal size={20} />
          </motion.span>
          <span className={styles.tabLabel}>更多</span>
        </button>
      </nav>
    </>
  );
}
