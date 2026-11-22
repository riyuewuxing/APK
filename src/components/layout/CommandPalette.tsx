/**
 * 居中毛玻璃快捷指挥台（Ctrl+K / /；对标 cmdk + Linear 分组键盘导航）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  BrainCircuit,
  Globe,
  LayoutDashboard,
  Palette,
  Radar,
  ScanSearch,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  TrendingUp,
  X,
} from 'lucide-react';
import { resolveSearchRoute, search as searchApi, type AppSearchResult } from '@/services/sdk';
import { searchGlobalSymbols } from '@/services/globalMarketsApi';
import { useAppSettings } from '@/contexts';
import { useTheme } from '@/hooks';
import { registerModalCloser } from '@/platform/modalStack';
import { OUTER_MARKET_BADGE } from '@/pages/Watchlist/watchlistGlobalAdapter';
import type { DensityLevel } from '@/themes/presets';
import styles from './CommandPalette.module.css';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface CommandActionItem {
  id: string;
  group: string;
  label: string;
  hint: string;
  keywords: string;
  icon: React.ReactNode;
  run: (origin?: { x: number; y: number }) => void;
}

const ROUTE_ACTIONS = [
  { path: '/', label: '总览仪表盘', hint: '首页 6 指数与全球脉搏', icon: <LayoutDashboard size={15} /> },
  { path: '/markets', label: '全球市场枢纽', hint: 'A股/港/美/日/韩/欧 热力图与榜单', icon: <Globe size={15} /> },
  { path: '/watchlist', label: '自选实时盯盘', hint: '3s 跳价终端与分时K线联动', icon: <Star size={15} /> },
  { path: '/scanner', label: '信号扫描器', hint: '多策略并发技术雷达', icon: <ScanSearch size={15} /> },
  { path: '/eod-picker', label: '尾盘选股法', hint: '14:30 安检与尾盘池筛选', icon: <TrendingUp size={15} /> },
  { path: '/expert', label: '专家工作台', hint: '正交证据链、排雷与 X-Ray', icon: <BrainCircuit size={15} /> },
  { path: '/expert-radar', label: '多资产机会雷达', hint: '全市场基金/ETF/个股优先级', icon: <Radar size={15} /> },
  { path: '/settings', label: '设置与简报', hint: '6维主题、定时简报与手机直连', icon: <Settings size={15} /> },
];

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { settings, updateSettings } = useAppSettings();
  const { availablePresets, preset, density, setPreset, setDensity } = useTheme();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<AppSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    const unregister = registerModalCloser('command-palette', onClose);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      unregister();
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const kw = query.trim();
    if (!kw) {
      return undefined;
    }
    const seq = ++seqRef.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const [cnRes, outerRes] = await Promise.all([
          searchApi(kw).catch(() => [] as AppSearchResult[]),
          searchGlobalSymbols(kw).catch(() => ({ items: [] })),
        ]);
        if (seqRef.current !== seq) return;
        const outerMapped: AppSearchResult[] = outerRes.items.slice(0, 8).map((row) => ({
          code: row.symbol,
          name: `${row.name} (${OUTER_MARKET_BADGE[row.market]})`,
          market: row.market,
          type: `${OUTER_MARKET_BADGE[row.market]}股`,
          entityType: 'stock',
          category: 'stock',
          typeLabel: `${OUTER_MARKET_BADGE[row.market]}·${row.industry || row.sector || '外围'}`,
          route: `/s/${row.symbol}`,
          isSupported: true,
        }));
        setSearchResults([...outerMapped, ...cnRes.slice(0, 8)]);
      } finally {
        if (seqRef.current === seq) {
          setSearching(false);
        }
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [open, query]);

  const actions = useMemo<CommandActionItem[]>(() => {
    const list: CommandActionItem[] = [];
    const kw = query.trim().toLowerCase();

    if (kw) {
      for (const item of searchResults) {
        const route = resolveSearchRoute(item).route ?? `/expert?symbol=${encodeURIComponent(item.code)}`;
        list.push({
          id: `sym-${item.code}`,
          group: '搜索标的与板块',
          label: item.name,
          hint: `${item.code} · ${item.typeLabel}`,
          keywords: `${item.code} ${item.name}`,
          icon: <Search size={15} />,
          run: () => {
            onClose();
            navigate(route);
          },
        });
      }
    }

    for (const p of availablePresets) {
      list.push({
        id: `preset-${p.id}`,
        group: '主题皮肤切换',
        label: `切换主题：${p.name}`,
        hint: preset === p.id ? '当前启用' : p.scene,
        keywords: `theme preset 主题 ${p.name} ${p.englishName} ${p.id}`,
        icon: <Palette size={15} />,
        run: (origin) => {
          setPreset(p.id, origin);
          onClose();
        },
      });
    }

    const densityOpts: { id: DensityLevel; label: string; hint: string }[] = [
      { id: 'compact', label: '视觉密度：紧凑盯盘 (0.92×)', hint: density === 'compact' ? '当前' : '同屏多25%行情' },
      { id: 'comfortable', label: '视觉密度：标准均衡 (1.0×)', hint: density === 'comfortable' ? '当前' : '默认均衡间距' },
      { id: 'spacious', label: '视觉密度：舒朗研报 (1.06×)', hint: density === 'spacious' ? '当前' : '护眼大字排版' },
    ];
    for (const d of densityOpts) {
      list.push({
        id: `density-${d.id}`,
        group: '显示与涨跌偏好',
        label: d.label,
        hint: d.hint,
        keywords: `density 密度 紧凑 标准 舒适 ${d.id}`,
        icon: <SlidersHorizontal size={15} />,
        run: () => {
          setDensity(d.id);
          onClose();
        },
      });
    }

    list.push({
      id: 'toggle-color-mode',
      group: '显示与涨跌偏好',
      label: `切换涨跌色彩（当前：${settings.colorMode === 'red-rise' ? '红涨绿跌' : '绿涨红跌'}）`,
      hint: '一键切换',
      keywords: '红涨绿跌 绿涨红跌 色彩 colorMode',
      icon: <SlidersHorizontal size={15} />,
      run: () => {
        updateSettings({
          colorMode: settings.colorMode === 'red-rise' ? 'green-rise' : 'red-rise',
        });
        onClose();
      },
    });

    for (const rt of ROUTE_ACTIONS) {
      list.push({
        id: `route-${rt.path}`,
        group: '工作区直达',
        label: rt.label,
        hint: rt.hint,
        keywords: `goto 跳转 ${rt.label} ${rt.path}`,
        icon: rt.icon,
        run: () => {
          onClose();
          navigate(rt.path);
        },
      });
    }

    if (!kw) return list;
    return list.filter(
      (item) =>
        item.group === '搜索标的与板块' ||
        item.label.toLowerCase().includes(kw) ||
        item.keywords.toLowerCase().includes(kw)
    );
  }, [
    availablePresets,
    density,
    navigate,
    onClose,
    preset,
    query,
    searchResults,
    setDensity,
    setPreset,
    settings.colorMode,
    updateSettings,
  ]);

  const clampedIdx = actions.length > 0 ? Math.min(activeIndex, actions.length - 1) : 0;

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="终端全局命令面板"
        data-testid="command-palette-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.inputRow}>
          <Search size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder="输入股票代码/名称搜索，或输入「主题」「密度」「自选」执行快捷指令..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((prev) => (actions.length > 0 ? (prev + 1) % actions.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((prev) =>
                  actions.length > 0 ? (prev - 1 + actions.length) % actions.length : 0
                );
              } else if (e.key === 'Enter' && actions[clampedIdx]) {
                e.preventDefault();
                actions[clampedIdx].run({
                  x: window.innerWidth / 2,
                  y: window.innerHeight / 3,
                });
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          {searching && <span className={styles.loadingTag}>检索中</span>}
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="关闭命令面板"
          >
            <X size={15} />
          </button>
        </div>

        <div className={styles.list}>
          {actions.length === 0 ? (
            <div className={styles.empty}>未匹配到指令或标的，请更换关键词</div>
          ) : (
            actions.map((item, idx) => {
              const showGroupHeader = idx === 0 || actions[idx - 1].group !== item.group;
              return (
                <div key={item.id}>
                  {showGroupHeader && <div className={styles.groupTitle}>{item.group}</div>}
                  <button
                    type="button"
                    className={`${styles.item} ${idx === clampedIdx ? styles.itemActive : ''}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={(e) => item.run({ x: e.clientX, y: e.clientY })}
                  >
                    <span className={styles.itemIcon}>{item.icon}</span>
                    <span className={styles.itemLabel}>{item.label}</span>
                    <span className={styles.itemHint}>{item.hint}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.footer}>
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
