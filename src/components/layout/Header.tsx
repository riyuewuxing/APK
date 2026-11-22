/**
 * 顶部导航栏组件
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Search,
  X,
  Clock,
  TrendingUp,
  Building2,
  Lightbulb,
  RefreshCw,
  Star,
  Check,
  Sun,
  Moon,
  Database,
  Sparkles,
  Globe,
} from 'lucide-react';
import { search as searchApi, resolveSearchRoute } from '@/services/sdk';
import { searchGlobalSymbols } from '@/services/globalMarketsApi';
import { OUTER_MARKET_BADGE } from '@/pages/Watchlist/watchlistGlobalAdapter';
import {
  getSearchHistory,
  addSearchHistory,
  clearSearchHistory,
} from '@/services/storage';
import { watchlistActions } from '@/services/watchlistStore';
import { ThemeSwitcher, useToast } from '@/components/common';
import { CommandPalette } from './CommandPalette';
import { useIsInWatchlist, useTheme } from '@/hooks';
import type { SearchHistoryItem } from '@/types';
import type { AppSearchResult } from '@/services/sdk';
import styles from './Header.module.css';

function extractResearchSymbol(raw: string): string | null {
  const clean = raw.trim();
  const prefixMatch = clean.match(/^(sh|sz|bj)\.?(\d{6})$/i);
  if (prefixMatch) {
    return `${prefixMatch[1].toLowerCase()}${prefixMatch[2]}`;
  }
  const suffixMatch = clean.match(/^(\d{6})\.(sh|sz|bj)$/i);
  if (suffixMatch) {
    return `${suffixMatch[2].toLowerCase()}${suffixMatch[1]}`;
  }
  const numMatch = clean.match(/^(\d{6})$/);
  return numMatch ? numMatch[1] : null;
}

function resolveExpertRouteFromItem(
  code: string,
  meta?: Pick<AppSearchResult, 'code' | 'name' | 'market' | 'type' | 'category'>
): string {
  const clean = extractResearchSymbol(code) ?? code.trim();
  const isFund =
    meta?.category === 'fund' ||
    Boolean(meta?.type && meta.type.includes('基金'));
  if (isFund) {
    const digits = clean.replace(/^(sh|sz|bj)/i, '');
    return `/expert?symbol=${encodeURIComponent(digits)}&asset_type=fund`;
  }
  const market = meta?.market?.toLowerCase();
  if (
    market &&
    ['sh', 'sz', 'bj'].includes(market) &&
    /^\d{6}$/.test(clean)
  ) {
    return `/expert?symbol=${encodeURIComponent(`${market}${clean}`)}`;
  }
  return `/expert?symbol=${encodeURIComponent(clean)}`;
}

function getHistoryRoute(item: SearchHistoryItem): string | null {
  return resolveSearchRoute(item).route;
}

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { theme, toggleTheme } = useTheme();
  const [keyword, setKeyword] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<AppSearchResult[]>([]);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  // 请求序号：旧关键词的慢响应后到会覆盖新结果，回车就会跳错股票
  const searchSeqRef = useRef(0);

  const cancelPendingSearch = useCallback(() => {
    searchSeqRef.current += 1;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleGlobalShortcut = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        Boolean(target) &&
        (target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.tagName === 'SELECT' ||
          target?.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen(false);
        setPaletteOpen((prev) => !prev);
      } else if (e.key === '/' && !inEditable) {
        e.preventDefault();
        setIsOpen(false);
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalShortcut);
    return () => window.removeEventListener('keydown', handleGlobalShortcut);
  }, []);

  useEffect(() => cancelPendingSearch, [cancelPendingSearch]);

  // 快速加自选
  const handleQuickAdd = (e: React.MouseEvent, item: AppSearchResult) => {
    e.stopPropagation();
    if (!item.isSupported || item.entityType !== 'stock') {
      toast.info('当前结果暂不支持加入自选');
      return;
    }
    if (checkIsInWatchlist(item.code)) {
      toast.info('已在自选中');
      return;
    }
    watchlistActions.add(item.code);
    toast.success(`已将 ${item.name} 加入自选`);
  };

  // 检查是否已在自选
  const checkIsInWatchlist = useIsInWatchlist();

  // 加载搜索历史
  useEffect(() => {
    setHistory(getSearchHistory());
  }, []);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const doSearch = useCallback(async (kw: string) => {
    if (!kw.trim()) {
      setResults([]);
      return;
    }

    const seq = ++searchSeqRef.current;
    setIsLoading(true);
    try {
      const [cnRes, globalRes] = await Promise.all([
        searchApi(kw).catch(() => [] as AppSearchResult[]),
        searchGlobalSymbols(kw, 8).catch(() => ({ items: [] })),
      ]);
      if (searchSeqRef.current !== seq) return;
      const globalMapped: AppSearchResult[] = globalRes.items.map((g) => ({
        code: g.symbol,
        name: g.name,
        market: g.market,
        type: 'stock',
        category: 'stock',
        entityType: 'stock',
        isSupported: true,
        route: `/s/${g.symbol}`,
        typeLabel: OUTER_MARKET_BADGE[g.market] ?? g.market.toUpperCase(),
      }));
      const seen = new Set<string>();
      const merged: AppSearchResult[] = [];
      for (const item of [...cnRes, ...globalMapped]) {
        const key = item.code.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
      setResults(merged.slice(0, 15));
    } catch (error) {
      if (searchSeqRef.current !== seq) return;
      console.error('Search error:', error);
      setResults([]);
    } finally {
      if (searchSeqRef.current === seq) {
        setIsLoading(false);
      }
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setKeyword(value);
    setActiveIndex(-1);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      doSearch(value);
    }, 300);
  };

  const isOnExpertPage = location.pathname.startsWith('/expert');
  const directSixDigit = extractResearchSymbol(keyword);

  const navigateExpertSymbol = (
    code: string,
    meta?: Pick<AppSearchResult, 'code' | 'name' | 'market' | 'type' | 'category'>
  ) => {
    const route = resolveExpertRouteFromItem(code, meta);
    if (meta) {
      addSearchHistory({
        code: meta.code,
        name: meta.name,
        market: meta.market,
        type: meta.type,
      });
      setHistory(getSearchHistory());
    }
    cancelPendingSearch();
    setKeyword('');
    setIsOpen(false);
    setResults([]);
    navigate(route);
  };

  // 选择结果
  const handleSelect = (item: AppSearchResult) => {
    const targetCode = extractResearchSymbol(item.code);
    if (isOnExpertPage && targetCode) {
      navigateExpertSymbol(item.code, item);
      return;
    }

    if (!item.isSupported || !item.route) {
      if (targetCode) {
        navigateExpertSymbol(item.code, item);
        return;
      }
      toast.info(`${item.name} 暂未接入当前看板详情页`);
      return;
    }

    addSearchHistory({
      code: item.code,
      name: item.name,
      market: item.market,
      type: item.type,
    });
    setHistory(getSearchHistory());
    cancelPendingSearch();
    setKeyword('');
    setIsOpen(false);
    setResults([]);
    navigate(item.route);
  };

  const handleQuickResearch = (e: React.MouseEvent, item: AppSearchResult) => {
    e.stopPropagation();
    navigateExpertSymbol(item.code, item);
  };

  // 选择历史
  const handleSelectHistory = (item: SearchHistoryItem) => {
    const targetCode = extractResearchSymbol(item.code);
    if (isOnExpertPage && targetCode) {
      navigateExpertSymbol(item.code, item);
      return;
    }
    const route = getHistoryRoute(item);
    if (!route) {
      if (targetCode) {
        navigateExpertSymbol(item.code, item);
        return;
      }
      toast.info(`${item.name} 暂未接入当前看板详情页`);
      return;
    }

    setKeyword('');
    setIsOpen(false);
    setResults([]);
    navigate(route);
  };

  // 清除历史
  const handleClearHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearSearchHistory();
    setHistory([]);
  };

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const maxIndex = keyword
      ? results.length - (directSixDigit ? 0 : 1)
      : history.length - 1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (maxIndex >= 0) {
        setActiveIndex((prev) => (prev < maxIndex ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (maxIndex >= 0) {
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : maxIndex));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (keyword) {
        if (activeIndex >= 0 && activeIndex < results.length && results[activeIndex]) {
          handleSelect(results[activeIndex]);
        } else if (activeIndex === results.length && directSixDigit) {
          navigateExpertSymbol(directSixDigit);
        } else if (results.length > 0) {
          handleSelect(results[0]);
        } else if (directSixDigit) {
          navigateExpertSymbol(directSixDigit);
        }
      } else if (activeIndex >= 0 && history[activeIndex]) {
        handleSelectHistory(history[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  // 获取图标
  const getTypeIcon = (type: string) => {
    switch (type) {
      case '行业板块':
        return <Building2 size={14} />;
      case '概念板块':
        return <Lightbulb size={14} />;
      default:
        return <TrendingUp size={14} />;
    }
  };

  const showDropdown = isOpen && (keyword ? results.length > 0 : history.length > 0);
  const [dropdownRendered, setDropdownRendered] = useState(showDropdown);
  if (showDropdown && !dropdownRendered) {
    setDropdownRendered(true);
  }
  const dropdownClosing = dropdownRendered && !showDropdown;

  return (
    <header className={styles.header}>
      <div className={styles.searchContainer} ref={containerRef}>
        <div className={styles.searchInputWrapper}>
          <Search size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            placeholder="搜索代码、名称或板块... (Ctrl+K)"
            value={keyword}
            onChange={handleInputChange}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
          />
          {!keyword && !isLoading && (
            <button
              type="button"
              className={styles.kbdHint}
              data-testid="header-command-trigger"
              onClick={() => setPaletteOpen(true)}
              title="打开全局指挥台 (Ctrl+K)"
            >
              Ctrl K
            </button>
          )}
          {keyword && (
            <button
              className={styles.clearBtn}
              onClick={() => {
                cancelPendingSearch();
                setKeyword('');
                setResults([]);
                inputRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
          {isLoading && <RefreshCw size={14} className={styles.loadingIcon} />}
        </div>

        {dropdownRendered && (
          <div
            className={`${styles.dropdown} ${dropdownClosing ? styles.dropdownLeaving : ''}`}
            onAnimationEnd={(event) => {
              if (dropdownClosing && event.target === event.currentTarget) {
                setDropdownRendered(false);
              }
            }}
          >
            {keyword ? (
              // 搜索结果
              <div className={styles.resultList}>
                {results.map((item, index) => {
                  const targetCode = extractResearchSymbol(item.code);
                  return (
                    <div
                      key={item.code}
                      className={`${styles.resultItem} ${!item.isSupported && !targetCode ? styles.unsupported : ''
                        } ${index === activeIndex ? styles.active : ''
                        }`}
                      onClick={() => handleSelect(item)}
                    >
                      <span className={styles.typeIcon}>
                        {getTypeIcon(item.type)}
                      </span>
                      <span className={styles.itemName}>{item.name}</span>
                      <span className={styles.itemCode}>{item.code}</span>
                      <span className={styles.itemType}>
                        {item.isSupported ? item.typeLabel : (targetCode ? item.type : '暂不支持')}
                      </span>
                      <div className={styles.itemActions}>
                        {targetCode && (
                          <button
                            type="button"
                            className={styles.quickResearchBtn}
                            onClick={(e) => handleQuickResearch(e, item)}
                            title="直达专家工作台深研"
                          >
                            <Sparkles size={12} />
                            深研
                          </button>
                        )}
                        {/* 股票类型显示快速加自选按钮 */}
                        {item.entityType === 'stock' && item.isSupported && (
                          <button
                            type="button"
                            className={`${styles.quickAddBtn} ${checkIsInWatchlist(item.code) ? styles.added : ''}`}
                            onClick={(e) => handleQuickAdd(e, item)}
                            title={checkIsInWatchlist(item.code) ? '已在自选' : '加入自选'}
                          >
                            {checkIsInWatchlist(item.code) ? <Check size={14} /> : <Star size={14} />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {directSixDigit && (
                  <div
                    className={`${styles.resultItem} ${styles.fallbackItem} ${activeIndex === results.length ? styles.active : ''
                      }`}
                    onClick={() => navigateExpertSymbol(directSixDigit)}
                  >
                    <span className={styles.typeIcon}>
                      <Sparkles size={14} />
                    </span>
                    <span className={styles.itemName}>按代码直达专家深研</span>
                    <span className={styles.itemCode}>{directSixDigit}</span>
                    <span className={styles.quickResearchBtn}>直达深研</span>
                  </div>
                )}
              </div>
            ) : (
              // 搜索历史
              <div className={styles.historyList}>
                <div className={styles.historyHeader}>
                  <span className={styles.historyTitle}>
                    <Clock size={12} />
                    最近搜索
                  </span>
                  <button
                    className={styles.clearHistoryBtn}
                    onClick={handleClearHistory}
                  >
                    清除
                  </button>
                </div>
                {history.map((item, index) => (
                  <div
                    key={item.code}
                    className={`${styles.resultItem} ${index === activeIndex ? styles.active : ''
                      }`}
                    onClick={() => handleSelectHistory(item)}
                  >
                    <span className={styles.typeIcon}>
                      {getTypeIcon(item.type)}
                    </span>
                    <span className={styles.itemName}>{item.name}</span>
                    <span className={styles.itemCode}>{item.code}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className={styles.statusTicker}
        onClick={() => navigate('/markets')}
        title="进入全球市场枢纽"
      >
        <span className={styles.tickerDot} />
        <Globe size={13} className={styles.tickerIcon} />
        <span>A股 · 港股 · 美股 · 日韩欧 全球终端</span>
      </button>

      <div className={styles.right}>
        <ThemeSwitcher />
        <button
          type="button"
          className={styles.themeBtn}
          onClick={(e) => toggleTheme({ x: e.clientX, y: e.clientY })}
          title={theme === 'dark' ? '一键切换浅色主题' : '一键切换深色主题'}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <a
          href="https://stock-sdk.linkdiary.cn/"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.sdkLink}
          title="Stock SDK"
        >
          <Database size={17} />
        </a>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </header>
  );
}
