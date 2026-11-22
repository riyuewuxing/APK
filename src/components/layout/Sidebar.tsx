/**
 * 侧边栏导航组件（3 分组 + 1 底部，共 8 项）
 */

import { useLayoutEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Globe,
  Star,
  Settings,
  TrendingUp,
  BrainCircuit,
  Radar,
  ScanSearch,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Logo, triggerClickRipple } from '@/components/common';
import { getSidebarCollapsed, saveSidebarCollapsed } from '@/services/storage';
import styles from './Sidebar.module.css';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

interface NavSection {
  id: string;
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    id: 'watch',
    title: '全球看盘',
    items: [
      { path: '/', label: '总览', icon: <LayoutDashboard size={18} /> },
      { path: '/markets', label: '全球市场', icon: <Globe size={18} /> },
      { path: '/watchlist', label: '自选盯盘', icon: <Star size={18} /> },
    ],
  },
  {
    id: 'strategy',
    title: '策略选股',
    items: [
      { path: '/scanner', label: '信号扫描', icon: <ScanSearch size={18} /> },
      { path: '/eod-picker', label: '尾盘选股', icon: <TrendingUp size={18} /> },
    ],
  },
  {
    id: 'expert',
    title: '专家研究',
    items: [
      { path: '/expert', label: '专家工作台', icon: <BrainCircuit size={18} /> },
      { path: '/expert-radar', label: '多资产雷达', icon: <Radar size={18} /> },
    ],
  },
];

const bottomItems: NavItem[] = [
  { path: '/settings', label: '设置与简报', icon: <Settings size={18} /> },
];

const MARKET_COMPAT_PREFIXES = ['/markets', '/heatmap', '/rankings', '/boards'];

function isNavItemActive(pathname: string, targetPath: string): boolean {
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

export function Sidebar() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(getSidebarCollapsed);

  useLayoutEffect(() => {
    document.documentElement.setAttribute(
      'data-sidebar-collapsed',
      collapsed ? 'true' : 'false'
    );
  }, [collapsed]);

  const handleToggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      saveSidebarCollapsed(next);
      return next;
    });
  };

  const renderNavItem = (item: NavItem) => {
    const isActive = isNavItemActive(location.pathname, item.path);

    return (
      <NavLink
        key={item.path}
        to={item.path}
        title={item.label}
        aria-label={item.label}
        className={`${styles.navItem} ${isActive ? styles.active : ''}`}
        onClick={(e) => triggerClickRipple(e, 'tick')}
      >
        {isActive && (
          <motion.span
            layoutId="sidebar-active-pill"
            className={styles.activeIndicator}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          />
        )}
        <span className={styles.icon}>{item.icon}</span>
        <span className={styles.label}>{item.label}</span>
      </NavLink>
    );
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <Logo size={collapsed ? 28 : 36} />
        <span className={styles.logoText}>全球投资终端</span>
      </div>

      <nav className={styles.nav} aria-label="主侧边栏导航">
        <div className={styles.navSections}>
          {navSections.map((section, idx) => (
            <div key={section.id} className={styles.navSection}>
              <div
                className={`${styles.sectionTitle} ${idx > 0 ? styles.sectionTitleSpaced : ''}`}
              >
                <span className={styles.sectionTitleText}>{section.title}</span>
                <span className={styles.sectionDivider} aria-hidden="true" />
              </div>
              <div className={styles.navGroup}>
                {section.items.map(renderNavItem)}
              </div>
            </div>
          ))}
        </div>

        <div className={styles.navGroup}>
          <div className={styles.bottomDivider} aria-hidden="true" />
          {bottomItems.map(renderNavItem)}
        </div>
      </nav>

      <div className={styles.collapseFooter}>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={handleToggleCollapse}
          data-testid="sidebar-collapse-btn"
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!collapsed}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          <span className={styles.icon}>
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </span>
          <span className={styles.collapseLabel}>收起侧栏</span>
        </button>
      </div>
    </aside>
  );
}
