import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BrainCircuit,
  Grid3X3,
  LayoutDashboard,
  MoreHorizontal,
  Radar,
  Settings,
  Star,
  TrendingUp,
  Layers,
  X,
} from 'lucide-react';
import { registerModalCloser } from '@/platform/modalStack';
import styles from './MobileTabBar.module.css';

interface TabItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const primaryTabs: TabItem[] = [
  { path: '/expert', label: '专家', icon: <BrainCircuit size={20} /> },
  { path: '/expert-radar', label: '雷达', icon: <Radar size={20} /> },
  { path: '/', label: '总览', icon: <LayoutDashboard size={20} /> },
  { path: '/watchlist', label: '自选', icon: <Star size={20} /> },
];

const moreItems: TabItem[] = [
  { path: '/heatmap', label: '热力图', icon: <Grid3X3 size={18} /> },
  { path: '/rankings', label: '榜单', icon: <BarChart3 size={18} /> },
  { path: '/boards', label: '板块', icon: <Layers size={18} /> },
  { path: '/scanner', label: '扫描', icon: <TrendingUp size={18} /> },
  { path: '/eod-picker', label: '尾盘选股', icon: <TrendingUp size={18} /> },
  { path: '/settings', label: '设置与手机配对', icon: <Settings size={18} /> },
];

function isRouteMatch(pathname: string, targetPath: string): boolean {
  if (targetPath === '/') {
    return pathname === '/';
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
      {moreOpen && (
        <div
          className={styles.drawerBackdrop}
          role="presentation"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className={styles.drawerSheet}
            role="dialog"
            aria-label="更多功能导航"
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
                    onClick={() => {
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
          </div>
        </div>
      )}

      <nav className={styles.tabBar} aria-label="移动端主导航">
        {primaryTabs.map((tab) => {
          const active = isRouteMatch(location.pathname, tab.path);
          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={`${styles.tabItem} ${active ? styles.tabItemActive : ''}`}
              onClick={() => setMoreOpen(false)}
            >
              <span className={styles.tabIcon}>{tab.icon}</span>
              <span className={styles.tabLabel}>{tab.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          className={`${styles.tabItem} ${moreOpen || isMoreActive ? styles.tabItemActive : ''}`}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((prev) => !prev)}
        >
          <span className={styles.tabIcon}>
            <MoreHorizontal size={20} />
          </span>
          <span className={styles.tabLabel}>更多</span>
        </button>
      </nav>
    </>
  );
}
