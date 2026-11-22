/**
 * 自选实时盯盘终端（Plan A：桌面三区联动 + 移动端紧凑单列）
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Edit3,
  ArrowUp,
  ArrowDown,
  CheckSquare,
  Square,
  X,
  Download,
  Upload,
  GripVertical,
  Columns3,
  Bell,
  RefreshCw,
  ExternalLink,
  Check,
} from 'lucide-react';
import {
  AnimatedNumber,
  Button,
  Loading,
  Empty,
  MarketSelectorBar,
  triggerClickRipple,
  useToast,
} from '@/components/common';
import { usePolling, useWatchlistState } from '@/hooks';
import { useAppSettings } from '@/contexts';
import { getAllAShareQuotes, getAllQuotesByCodes } from '@/services/sdk';
import {
  GLOBAL_MARKET_LIST,
  fetchGlobalMarketOverview,
  fetchGlobalQuotes,
  type GlobalMarketId,
  type OuterMarketId,
} from '@/services/globalMarketsApi';
import {
  DEFAULT_PORTFOLIO_HOLDINGS,
  getTableColumns,
  getWatchlistLiveMode,
  saveTableColumns,
  saveWatchlistLiveMode,
  type WatchlistLiveMode,
} from '@/services/storage';
import { watchlistActions, watchlistStore } from '@/services/watchlistStore';
import {
  detectAssetMarket,
  formatPrice,
  formatPercent,
  formatChange,
  formatAmount,
  formatCurrencyPrice,
  formatMarketValueByCurrency,
  formatTurnover,
  formatVolumeRatio,
  formatRatio,
  formatMarketCap,
  getChangeColorClass,
  normalizeStockCode,
} from '@/utils/format';
import type { AlertRule, ColumnConfig } from '@/types';
import type { FullQuote } from 'stock-sdk';
import { WatchlistPreviewPane } from './WatchlistPreviewPane';
import { WatchlistResearchDock } from './WatchlistResearchDock';
import {
  OUTER_MARKET_BADGE,
  formatTerminalCodeLabel,
  globalRowToTerminalQuote,
  isSupportedWatchlistCode,
  type TerminalQuote,
} from './watchlistGlobalAdapter';
import {
  WATCHLIST_TERMINAL_COLUMNS_KEY,
  computeQuoteFlashMap,
  extractBareCode,
  mergeTerminalColumns,
  resolveWatchlistPollingPlan,
  sortWatchlistQuotes,
  updatePriceWindowAndComputeSpeed,
  type PriceSamplePoint,
  type SortOrder,
  type TickFlashDirection,
  type WatchlistSortField,
} from './watchlistTerminalHelpers';
import styles from './Watchlist.module.css';

interface ActiveSelection {
  code: string;
  name?: string;
  source: 'table' | 'dock';
}

interface FlashStateEntry {
  dir: TickFlashDirection;
  seq: number;
}

const SORTABLE_COLUMN_FIELDS: Partial<Record<string, WatchlistSortField>> = {
  code: 'code',
  changePercent: 'changePercent',
  price: 'price',
  change: 'change',
  speed: 'speed',
  volumeRatio: 'volumeRatio',
  amount: 'amount',
  turnoverRate: 'turnoverRate',
  amplitude: 'amplitude',
  peDynamic: 'peDynamic',
  totalMarketCap: 'totalMarketCap',
  circulatingMarketCap: 'circulatingMarketCap',
};

const HELD_PORTFOLIO_SET = new Set(
  DEFAULT_PORTFOLIO_HOLDINGS.map((c) => normalizeStockCode(c))
);

function useIsDesktopTerminal(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return true;
    }
    return window.matchMedia('(min-width: 1100px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(min-width: 1100px)');
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

function matchesAlertRule(rule: AlertRule, quote: FullQuote) {
  if (!quote.price) {
    return false;
  }
  switch (rule.type) {
    case 'price_gte':
      return quote.price >= rule.value;
    case 'price_lte':
      return quote.price <= rule.value;
    case 'change_percent_gte':
      return quote.changePercent >= rule.value;
    case 'change_percent_lte':
      return quote.changePercent <= rule.value;
    case 'amount_gte':
      return (quote.amount ?? 0) >= rule.value;
    case 'near_limit_up':
      return quote.limitUp !== null && quote.price >= quote.limitUp * (1 - rule.value / 100);
    case 'near_limit_down':
      return quote.limitDown !== null && quote.price <= quote.limitDown * (1 + rule.value / 100);
    default:
      return false;
  }
}

function formatAlertRule(rule: AlertRule) {
  switch (rule.type) {
    case 'price_gte':
      return `价格 >= ${rule.value}`;
    case 'price_lte':
      return `价格 <= ${rule.value}`;
    case 'change_percent_gte':
      return `涨幅 >= ${rule.value}%`;
    case 'change_percent_lte':
      return `涨幅 <= ${rule.value}%`;
    case 'amount_gte':
      return `成交额 >= ${rule.value}`;
    case 'near_limit_up':
      return `接近涨停 ${rule.value}%`;
    case 'near_limit_down':
      return `接近跌停 ${rule.value}%`;
    default:
      return rule.type;
  }
}

export function Watchlist() {
  const navigate = useNavigate();
  const toast = useToast();
  const { getRefreshInterval } = useAppSettings();
  const isDesktopTerminal = useIsDesktopTerminal();

  const { groups, alerts } = useWatchlistState();

  const [marketTab, setMarketTab] = useState<'watchlist' | GlobalMarketId>('watchlist');
  const [marketRows, setMarketRows] = useState<TerminalQuote[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(() => groups[0]?.id ?? 'default');
  const [quotes, setQuotes] = useState<Map<string, TerminalQuote>>(new Map());
  const [quotesError, setQuotesError] = useState(false);

  const [liveMode, setLiveMode] = useState<WatchlistLiveMode>(getWatchlistLiveMode);
  const [sessionNowMs, setSessionNowMs] = useState<number>(() => Date.now());

  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [showAddGroupInput, setShowAddGroupInput] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const [sortField, setSortField] = useState<WatchlistSortField>('default');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const [selectedStocks, setSelectedStocks] = useState<Set<string>>(new Set());
  const [showSelectMode, setShowSelectMode] = useState(false);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [columns, setColumns] = useState<ColumnConfig[]>(() =>
    mergeTerminalColumns(getTableColumns(WATCHLIST_TERMINAL_COLUMNS_KEY))
  );
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [showAlertPanel, setShowAlertPanel] = useState(false);

  const [draggedCode, setDraggedCode] = useState<string | null>(null);
  const [dragPreviewCodes, setDragPreviewCodes] = useState<string[] | null>(null);

  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);
  const [speedMap, setSpeedMap] = useState<Map<string, number | null>>(new Map());
  const [flashMap, setFlashMap] = useState<Map<string, FlashStateEntry>>(new Map());

  const prevQuotesRef = useRef<Map<string, FullQuote>>(new Map());
  const priceWindowRef = useRef<Map<string, PriceSamplePoint[]>>(new Map());
  const quoteFetchSeqRef = useRef(0);
  const lastLoadedCodesKeyRef = useRef('');
  const flashSeqRef = useRef(0);
  const flashClearTimerRef = useRef<number | null>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  const activeGroup =
    groups.find((g) => g.id === selectedGroupId) ??
    groups.find((g) => g.id === 'default') ??
    groups[0];
  const activeGroupId = activeGroup?.id ?? 'default';
  const activeCodes = useMemo(() => activeGroup?.codes || [], [activeGroup?.codes]);

  const visibleColumnKeys = useMemo(
    () => new Set(columns.filter((column) => column.visible).map((column) => column.key)),
    [columns]
  );

  const normalizedActiveCodes = useMemo(() => {
    const codes = new Set<string>();
    activeCodes.forEach((code) => {
      const normalized = normalizeStockCode(code);
      if (normalized) {
        codes.add(normalized);
      }
    });
    return Array.from(codes);
  }, [activeCodes]);

  const groupAlerts = useMemo(
    () =>
      alerts.filter((rule) =>
        normalizedActiveCodes.includes(normalizeStockCode(rule.code))
      ),
    [alerts, normalizedActiveCodes]
  );

  const isEmptyGroup = !activeGroup || activeGroup.codes.length === 0;

  // 每 30s 刷新时段时钟，盘中/午休/收盘切换自动生效
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSessionNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      quoteFetchSeqRef.current += 1;
      if (flashClearTimerRef.current !== null) {
        window.clearTimeout(flashClearTimerRef.current);
      }
    };
  }, []);

  const pollingPlan = useMemo(
    () => resolveWatchlistPollingPlan(liveMode, getRefreshInterval('list'), new Date(sessionNowMs)),
    [liveMode, getRefreshInterval, sessionNowMs]
  );

  const allWatchSet = useMemo(
    () => new Set(groups.flatMap((g) => g.codes.map((c) => normalizeStockCode(c)))),
    [groups]
  );

  const activeCodesKey = useMemo(
    () => (marketTab === 'watchlist' ? normalizedActiveCodes.join(',') : `market::${marketTab}`),
    [marketTab, normalizedActiveCodes]
  );

  const fetchQuotes = useCallback(async () => {
    if (marketTab === 'watchlist' && normalizedActiveCodes.length === 0) {
      return;
    }

    const seq = ++quoteFetchSeqRef.current;
    try {
      let data: TerminalQuote[] = [];
      if (marketTab === 'watchlist') {
        const cnCodes: string[] = [];
        const outerCodes: string[] = [];
        normalizedActiveCodes.forEach((c) => {
          if (detectAssetMarket(c) === 'cn') cnCodes.push(c);
          else outerCodes.push(c);
        });
        const [cnData, outerRes] = await Promise.all([
          cnCodes.length > 0 ? getAllQuotesByCodes(cnCodes) : Promise.resolve([]),
          outerCodes.length > 0
            ? fetchGlobalQuotes(outerCodes).catch(() => ({ items: [] }))
            : Promise.resolve({ items: [] }),
        ]);
        data = [
          ...cnData,
          ...outerRes.items.map(globalRowToTerminalQuote),
        ];
      } else if (marketTab === 'cn') {
        const allCn = await getAllAShareQuotes();
        data = [...allCn]
          .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
          .slice(0, 80);
      } else {
        const ov = await fetchGlobalMarketOverview(
          marketTab as OuterMarketId,
          'market_cap',
          120
        );
        data = ov.stocks.map(globalRowToTerminalQuote);
      }

      if (quoteFetchSeqRef.current !== seq) {
        return;
      }
      if (marketTab !== 'watchlist') {
        setMarketRows(data);
      }
      const map = new Map<string, TerminalQuote>();
      const nextNormalizedQuotes = new Map<string, TerminalQuote>();

      data.forEach((q) => {
        if (q && q.code) {
          const normalized = normalizeStockCode(q.code);
          map.set(normalized, q);
          map.set(q.code, q);
          map.set(q.code.toLowerCase(), q);
          nextNormalizedQuotes.set(normalized, q);
        }
      });

      const now = Date.now();
      lastLoadedCodesKeyRef.current = activeCodesKey;

      // 跳价微闪判定
      const rawFlashes = computeQuoteFlashMap(prevQuotesRef.current, nextNormalizedQuotes);
      prevQuotesRef.current = nextNormalizedQuotes;

      if (rawFlashes.size > 0) {
        const seq = ++flashSeqRef.current;
        const nextFlashMap = new Map<string, FlashStateEntry>();
        rawFlashes.forEach((dir, code) => {
          nextFlashMap.set(code, { dir, seq });
        });
        setFlashMap(nextFlashMap);
        if (flashClearTimerRef.current !== null) {
          window.clearTimeout(flashClearTimerRef.current);
        }
        flashClearTimerRef.current = window.setTimeout(() => {
          setFlashMap(new Map());
        }, 650);
      }

      // 更新 6 分钟滑动窗口与涨速
      const nextSpeedMap = new Map<string, number | null>();
      nextNormalizedQuotes.forEach((quote, normCode) => {
        const prevSamples = priceWindowRef.current.get(normCode) ?? [];
        const updated = updatePriceWindowAndComputeSpeed(prevSamples, quote.price, now);
        priceWindowRef.current.set(normCode, updated.samples);
        nextSpeedMap.set(normCode, updated.speedPercent);
      });
      setSpeedMap(nextSpeedMap);

      setQuotes(map);
      setQuotesError(false);

      // 本地告警检查
      const triggered: AlertRule[] = [];
      watchlistStore
        .getSnapshot()
        .alerts.filter((rule) => rule.enabled)
        .forEach((rule) => {
          const normalized = normalizeStockCode(rule.code);
          const currentQuote = map.get(normalized);
          if (!currentQuote) return;
          if (now - rule.lastTriggeredAt < rule.cooldownSec * 1000) return;
          if (!matchesAlertRule(rule, currentQuote)) return;
          triggered.push(rule);
        });

      if (triggered.length > 0) {
        watchlistActions.markAlertsTriggered(
          triggered.map((rule) => rule.id),
          now
        );
      }

      const MAX_ALERT_TOASTS = 2;
      triggered.slice(0, MAX_ALERT_TOASTS).forEach((rule) => {
        toast.info(`${rule.name} 触发告警: ${formatAlertRule(rule)}`);
      });
      if (triggered.length > MAX_ALERT_TOASTS) {
        toast.info(`另有 ${triggered.length - MAX_ALERT_TOASTS} 条告警触发，详见告警面板`);
      }
    } catch (error) {
      if (quoteFetchSeqRef.current !== seq) {
        return;
      }
      console.error('Fetch quotes error:', error);
      setQuotesError(true);
    }
  }, [marketTab, activeCodesKey, normalizedActiveCodes, toast]);

  useEffect(() => {
    watchlistActions.seedPortfolioHoldings();
  }, []);

  const handleSyncPortfolio = useCallback(() => {
    const result = watchlistActions.syncPortfolioHoldings();
    if (result.added > 0) {
      toast.success(`已同步 ${result.added} 只实证账户持仓股到自选列表`);
    } else {
      toast.info('实证账户 5 只持仓已全部在默认自选组中');
    }
  }, [toast]);

  const hasTargets = marketTab !== 'watchlist' || normalizedActiveCodes.length > 0;

  const { isLoading: isPollingLoading, refresh: refreshNow } = usePolling(fetchQuotes, {
    interval: pollingPlan.quoteIntervalMs,
    enabled: pollingPlan.enabled && hasTargets,
    immediate: true,
    refreshKey: activeCodesKey,
  });

  // 暂停模式下首次进入页面或切换新分组时仍执行单次首屏拉取，避免永久卡在加载态
  useEffect(() => {
    if (
      pollingPlan.enabled ||
      !hasTargets ||
      lastLoadedCodesKeyRef.current === activeCodesKey
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void fetchQuotes();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pollingPlan.enabled, hasTargets, activeCodesKey, fetchQuotes]);

  const handleLiveModeChange = useCallback((mode: WatchlistLiveMode) => {
    setLiveMode(mode);
    saveWatchlistLiveMode(mode);
  }, []);

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) return;
    const newGroup = watchlistActions.createGroup(newGroupName.trim());
    setSelectedGroupId(newGroup.id);
    setActiveSelection(null);
    setNewGroupName('');
    setShowAddGroupInput(false);
  };

  const handleDeleteGroup = (groupId: string) => {
    if (groupId === 'default') return;
    if (confirm('确定删除该分组？分组内的股票将被移除。')) {
      watchlistActions.deleteGroup(groupId);
      if (activeGroupId === groupId) {
        setSelectedGroupId('default');
        setActiveSelection(null);
      }
    }
  };

  const handleRenameGroup = (groupId: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      watchlistActions.renameGroup(groupId, trimmed);
    }
    setEditingGroup(null);
  };

  const handleRemoveStock = (code: string) => {
    watchlistActions.remove(code, activeGroupId);
  };

  const handleSortFieldToggle = useCallback(
    (field: WatchlistSortField) => {
      if (field === 'default') {
        setSortField('default');
        return;
      }
      if (sortField === field) {
        setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
      } else {
        setSortField(field);
        setSortOrder(field === 'code' ? 'asc' : 'desc');
      }
    },
    [sortField]
  );

  const handleToggleSelect = useCallback((code: string) => {
    setSelectedStocks((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedStocks.size === normalizedActiveCodes.length) {
      setSelectedStocks(new Set());
    } else {
      setSelectedStocks(new Set(normalizedActiveCodes));
    }
  }, [selectedStocks.size, normalizedActiveCodes]);

  const handleBatchDelete = useCallback(() => {
    if (selectedStocks.size === 0) return;
    watchlistActions.batchRemove(Array.from(selectedStocks), activeGroupId);
    toast.success(`已删除 ${selectedStocks.size} 只股票`);
    setSelectedStocks(new Set());
    setShowSelectMode(false);
  }, [selectedStocks, activeGroupId, toast]);

  const handleExport = useCallback(() => {
    const codes = normalizedActiveCodes.join('\n');
    navigator.clipboard
      .writeText(codes)
      .then(() => {
        toast.success(`已复制 ${normalizedActiveCodes.length} 只股票代码到剪贴板`);
      })
      .catch(() => {
        const blob = new Blob([codes], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `watchlist_${activeGroup?.name || 'default'}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('已导出股票代码');
      });
  }, [normalizedActiveCodes, activeGroup?.name, toast]);

  const handleImport = useCallback(() => {
    if (!importText.trim()) {
      toast.info('请输入股票代码');
      return;
    }
    const codes = importText
      .split(/[\s,;，；\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (codes.length === 0) {
      toast.info('未识别到有效的股票代码');
      return;
    }

    const validCodes = new Set<string>();
    const invalidCodes = new Set<string>();

    codes.forEach((code) => {
      const normalized = normalizeStockCode(code);
      if (isSupportedWatchlistCode(normalized)) {
        validCodes.add(normalized);
      } else {
        invalidCodes.add(code);
      }
    });

    if (validCodes.size === 0) {
      toast.warning('未识别到有效的 A 股或外围市场代码（如 hk00700 / usNVDA / kr005930）');
      return;
    }

    const addedCount = watchlistActions.batchAdd(Array.from(validCodes), activeGroupId);
    setImportText('');
    setShowImportModal(false);

    if (addedCount > 0) {
      const suffix = invalidCodes.size > 0 ? `，已跳过 ${invalidCodes.size} 个无效代码` : '';
      toast.success(`已导入 ${addedCount} 只股票${suffix}`);
    } else if (invalidCodes.size > 0) {
      toast.warning(`未导入新股票，且跳过了 ${invalidCodes.size} 个无效代码`);
    } else {
      toast.info('所有股票已在自选中');
    }
  }, [importText, activeGroupId, toast]);

  const handleDragStart = useCallback(
    (code: string) => {
      setDraggedCode(code);
      setDragPreviewCodes(normalizedActiveCodes);
    },
    [normalizedActiveCodes]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, targetCode: string) => {
      e.preventDefault();
      if (!draggedCode || draggedCode === targetCode) return;

      setDragPreviewCodes((prev) => {
        const currentCodes = [...(prev ?? normalizedActiveCodes)];
        const dragIndex = currentCodes.indexOf(draggedCode);
        const targetIndex = currentCodes.indexOf(targetCode);
        if (dragIndex === -1 || targetIndex === -1) return prev;

        currentCodes.splice(dragIndex, 1);
        currentCodes.splice(targetIndex, 0, draggedCode);
        return currentCodes;
      });
    },
    [draggedCode, normalizedActiveCodes]
  );

  const handleDrop = useCallback(() => {
    const draggedIndex =
      draggedCode && dragPreviewCodes ? dragPreviewCodes.indexOf(draggedCode) : -1;
    if (draggedCode && dragPreviewCodes && draggedIndex !== -1) {
      watchlistActions.move(
        activeGroupId,
        draggedCode,
        dragPreviewCodes[draggedIndex + 1] ?? null
      );
    }
    setDraggedCode(null);
    setDragPreviewCodes(null);
  }, [draggedCode, dragPreviewCodes, activeGroupId]);

  const handleDragEnd = useCallback(() => {
    setDraggedCode(null);
    setDragPreviewCodes(null);
  }, []);

  const handleToggleColumn = useCallback((columnKey: string) => {
    setColumns((prev) => {
      const next = prev.map((column) =>
        column.key === columnKey ? { ...column, visible: !column.visible } : column
      );
      saveTableColumns(WATCHLIST_TERMINAL_COLUMNS_KEY, next);
      return next;
    });
  }, []);

  const sortedStocks = useMemo(() => {
    if (marketTab !== 'watchlist') {
      return sortWatchlistQuotes(marketRows, sortField, sortOrder, speedMap) as TerminalQuote[];
    }
    const orderedCodes = dragPreviewCodes ?? normalizedActiveCodes;
    const stockList = orderedCodes
      .map((code) => quotes.get(code) || quotes.get(code.toLowerCase()))
      .filter((q): q is TerminalQuote => Boolean(q));

    return sortWatchlistQuotes(stockList, sortField, sortOrder, speedMap) as TerminalQuote[];
  }, [marketTab, marketRows, dragPreviewCodes, normalizedActiveCodes, quotes, sortField, sortOrder, speedMap]);

  // 当前有效选中标的：Dock 选择允许不在当前分组；列表内若当前未选中或被移除则自动选中第 1 只
  const effectiveActiveCode = useMemo(() => {
    if (activeSelection) {
      if (activeSelection.source === 'dock') {
        return activeSelection.code;
      }
      const existsInTable =
        sortedStocks.some((q) => normalizeStockCode(q.code) === activeSelection.code) ||
        normalizedActiveCodes.includes(activeSelection.code);
      if (existsInTable) {
        return activeSelection.code;
      }
    }
    const first = sortedStocks[0];
    if (first) return normalizeStockCode(first.code);
    return normalizedActiveCodes[0] ?? null;
  }, [activeSelection, sortedStocks, normalizedActiveCodes]);

  const effectiveActiveQuote = useMemo(() => {
    if (!effectiveActiveCode) return undefined;
    return quotes.get(effectiveActiveCode) || quotes.get(effectiveActiveCode.toLowerCase());
  }, [effectiveActiveCode, quotes]);

  // 键盘 ↑ / ↓ 切换标的、Enter 进完整详情（严格避开输入框与弹窗）
  useEffect(() => {
    if (!isDesktopTerminal || showImportModal) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const activeEl = document.activeElement as HTMLElement | null;
      const isEditingEl = (el: HTMLElement | null) =>
        Boolean(
          el &&
          (el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'SELECT' ||
            el.isContentEditable)
        );
      if (isEditingEl(target) || isEditingEl(activeEl)) {
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (sortedStocks.length === 0) return;
        e.preventDefault();
        const curIdx = sortedStocks.findIndex(
          (q) => normalizeStockCode(q.code) === effectiveActiveCode
        );
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const nextIdx =
          curIdx === -1
            ? 0
            : (curIdx + delta + sortedStocks.length) % sortedStocks.length;
        const nextQuote = sortedStocks[nextIdx];
        if (!nextQuote) return;
        const nextCode = normalizeStockCode(nextQuote.code);
        setActiveSelection({ code: nextCode, name: nextQuote.name, source: 'table' });
        rowRefs.current.get(nextCode)?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && effectiveActiveCode) {
        if (
          activeEl &&
          (activeEl.tagName === 'BUTTON' || activeEl.tagName === 'A')
        ) {
          return;
        }
        e.preventDefault();
        navigate(`/s/${effectiveActiveCode}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isDesktopTerminal,
    showImportModal,
    sortedStocks,
    effectiveActiveCode,
    navigate,
  ]);

  const handleAddFromDock = useCallback(
    (normCode: string, name?: string) => {
      watchlistActions.add(normCode, activeGroupId);
      toast.success(`已将 ${name || extractBareCode(normCode)} 加入当前自选分组`);
    },
    [activeGroupId, toast]
  );

  const handleSelectFromDock = useCallback((normCode: string, name?: string) => {
    setActiveSelection({ code: normCode, name, source: 'dock' });
  }, []);

  const renderSortIcon = (colKey: string) => {
    const mapped = SORTABLE_COLUMN_FIELDS[colKey];
    if (!mapped || sortField !== mapped) return null;
    return sortOrder === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />;
  };

  const renderHeaderCell = (col: ColumnConfig, alignRight: boolean) => {
    const mappedField = SORTABLE_COLUMN_FIELDS[col.key];
    const isSorted = Boolean(mappedField && sortField === mappedField);
    return (
      <th
        key={col.key}
        className={`${styles.th} ${alignRight ? styles.alignRight : styles.alignLeft} ${mappedField ? styles.sortableTh : ''
          } ${isSorted ? styles.sortedTh : ''}`}
        onClick={() => mappedField && handleSortFieldToggle(mappedField)}
      >
        <span className={styles.thInner}>
          <span>{col.label}</span>
          {renderSortIcon(col.key)}
        </span>
      </th>
    );
  };

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.visible),
    [columns]
  );

  return (
    <div className={styles.terminalPage}>
      <div className={styles.marketBarRow}>
        <MarketSelectorBar
          value={marketTab}
          onChange={(next) => {
            setMarketTab(next as 'watchlist' | GlobalMarketId);
            setMarketRows([]);
            setQuotesError(false);
            setActiveSelection(null);
            setShowSelectMode(false);
          }}
          showWatchlistTab
          testIdPrefix="watchlist-market"
        />
      </div>

      {/* 移动端分组切换芯片条（< 1100px 显示） */}
      {marketTab === 'watchlist' && (
        <div className={styles.mobileGroupBar} aria-label="自选股分组切换">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`${styles.mobileGroupChip} ${activeGroupId === group.id ? styles.mobileGroupChipActive : ''
                }`}
              onClick={() => {
                setSelectedGroupId(group.id);
                setActiveSelection(null);
              }}
            >
              <span>{group.name}</span>
              <span>({group.codes.length})</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.terminalGrid}>
        {/* 左主区：顶条 + 高密度行情表 + 底部研究 Dock */}
        <div className={styles.leftZone}>
          {/* 顶栏：桌面水平分组条 + 3s 盯盘控制 + 工具栏 */}
          <div className={styles.topToolbar}>
            <div className={styles.topToolbarLeft}>
              <span className={styles.terminalBrand}>
                {marketTab === 'watchlist'
                  ? '自选盯盘'
                  : `${GLOBAL_MARKET_LIST.find((m) => m.id === marketTab)?.label ?? ''}实时行列表`}
              </span>

              {marketTab === 'watchlist' && (
                <div className={styles.desktopGroupTabs} role="tablist" aria-label="自选分组">
                  {groups.map((group) => {
                    const isActive = activeGroupId === group.id;
                    return (
                      <div
                        key={group.id}
                        className={`${styles.groupTabWrap} ${isActive ? styles.groupTabWrapActive : ''
                          }`}
                      >
                        {editingGroup === group.id ? (
                          <input
                            type="text"
                            className={styles.groupRenameInput}
                            defaultValue={group.name}
                            autoFocus
                            onBlur={(e) => handleRenameGroup(group.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleRenameGroup(group.id, e.currentTarget.value);
                              }
                              if (e.key === 'Escape') {
                                setEditingGroup(null);
                              }
                            }}
                          />
                        ) : (
                          <>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={isActive}
                              className={styles.groupTabBtn}
                              onClick={() => {
                                setSelectedGroupId(group.id);
                                setActiveSelection(null);
                              }}
                              onDoubleClick={() => {
                                if (group.id !== 'default') {
                                  setEditingGroup(group.id);
                                }
                              }}
                            >
                              <span>{group.name}</span>
                              <span className={styles.groupTabCount}>({group.codes.length})</span>
                            </button>
                            {group.id !== 'default' && (
                              <span className={styles.groupTabActions}>
                                <button
                                  type="button"
                                  className={styles.groupMiniBtn}
                                  onClick={() => setEditingGroup(group.id)}
                                  title="重命名分组"
                                >
                                  <Edit3 size={11} />
                                </button>
                                <button
                                  type="button"
                                  className={styles.groupMiniBtn}
                                  onClick={() => handleDeleteGroup(group.id)}
                                  title="删除分组"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {showAddGroupInput ? (
                    <div className={styles.newGroupInline}>
                      <input
                        type="text"
                        className={styles.newGroupInput}
                        placeholder="分组名..."
                        value={newGroupName}
                        autoFocus
                        onChange={(e) => setNewGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateGroup();
                          if (e.key === 'Escape') {
                            setShowAddGroupInput(false);
                            setNewGroupName('');
                          }
                        }}
                      />
                      <button
                        type="button"
                        className={styles.groupConfirmBtn}
                        onClick={handleCreateGroup}
                        title="确认新建"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        type="button"
                        className={styles.groupMiniBtn}
                        onClick={() => {
                          setShowAddGroupInput(false);
                          setNewGroupName('');
                        }}
                        title="取消"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.addGroupTabBtn}
                      onClick={() => setShowAddGroupInput(true)}
                    >
                      <Plus size={12} />
                      <span>新建</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className={styles.topToolbarRight}>
              {/* 盯盘模式切换（实时 3s / 标准 / 暂停） */}
              <div className={styles.liveModeGroup} role="group" aria-label="盯盘轮询模式">
                {(
                  [
                    { key: 'live3s', label: '实时 3s' },
                    { key: 'standard', label: '标准' },
                    { key: 'paused', label: '暂停' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`${styles.liveModeBtn} ${liveMode === item.key ? styles.liveModeBtnActive : ''
                      }`}
                    onClick={() => handleLiveModeChange(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <span
                className={`${styles.sessionBadge} ${!pollingPlan.enabled
                    ? styles.sessionPaused
                    : pollingPlan.isTrading
                      ? styles.sessionLive
                      : styles.sessionIdle
                  }`}
              >
                {pollingPlan.statusLabel}
              </span>

              <button
                type="button"
                className={styles.toolBtn}
                onClick={() => void refreshNow()}
                title="立即刷新行情"
                aria-label="立即刷新行情"
              >
                <RefreshCw size={13} className={isPollingLoading ? styles.spinIcon : ''} />
              </button>

              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw size={12} />}
                onClick={handleSyncPortfolio}
              >
                同步实证账户持仓
              </Button>

              <button
                type="button"
                className={styles.toolBtn}
                onClick={() => setShowImportModal(true)}
                title="导入股票"
              >
                <Upload size={13} />
              </button>

              {activeCodes.length > 0 && (
                <>
                  <button
                    type="button"
                    className={styles.toolBtn}
                    onClick={handleExport}
                    title="导出代码"
                  >
                    <Download size={13} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.toolBtn} ${showSelectMode ? styles.active : ''}`}
                    onClick={() => {
                      setShowSelectMode((prev) => !prev);
                      if (showSelectMode) {
                        setSelectedStocks(new Set());
                      }
                    }}
                    title={showSelectMode ? '取消批量选择' : '批量选择'}
                  >
                    {showSelectMode ? <X size={13} /> : <CheckSquare size={13} />}
                  </button>
                  <button
                    type="button"
                    className={`${styles.toolBtn} ${styles.desktopOnlyToolBtn} ${showColumnPanel ? styles.active : ''}`}
                    onClick={() => setShowColumnPanel((prev) => !prev)}
                    title="列设置"
                  >
                    <Columns3 size={13} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.toolBtn} ${showAlertPanel ? styles.active : ''}`}
                    onClick={() => setShowAlertPanel((prev) => !prev)}
                    title="告警中心"
                  >
                    <Bell size={13} />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 主行情表卡片 */}
          <div className={styles.tableCard}>
            {showColumnPanel && (
              <div className={styles.columnPanel}>
                {columns.map((column) => (
                  <label key={column.key} className={styles.columnOption}>
                    <input
                      type="checkbox"
                      checked={column.visible}
                      onChange={() => handleToggleColumn(column.key)}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
              </div>
            )}

            {showAlertPanel && (
              <div className={styles.alertPanel}>
                {groupAlerts.length === 0 ? (
                  <span className={styles.alertEmpty}>当前分组暂无本地告警</span>
                ) : (
                  groupAlerts.map((rule) => (
                    <div key={rule.id} className={styles.alertRow}>
                      <div className={styles.alertInfo}>
                        <span className={styles.alertName}>{rule.name}</span>
                        <span className={styles.alertDesc}>{formatAlertRule(rule)}</span>
                      </div>
                      <button
                        type="button"
                        className={styles.alertRemoveBtn}
                        onClick={() => watchlistActions.deleteAlert(rule.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {showSelectMode && activeCodes.length > 0 && (
              <div className={styles.batchBar}>
                <span className={styles.stockCount}>
                  已选 {selectedStocks.size} / {normalizedActiveCodes.length} 只
                </span>
                <div className={styles.batchSection}>
                  <button
                    type="button"
                    className={styles.selectAllBtn}
                    onClick={handleSelectAll}
                  >
                    {selectedStocks.size === normalizedActiveCodes.length ? '取消全选' : '全选'}
                  </button>
                  <button
                    type="button"
                    className={styles.batchDeleteBtn}
                    onClick={handleBatchDelete}
                    disabled={selectedStocks.size === 0}
                  >
                    <Trash2 size={13} />
                    删除 ({selectedStocks.size})
                  </button>
                </div>
              </div>
            )}

            {((marketTab === 'watchlist' && !isEmptyGroup) || marketTab !== 'watchlist') &&
              sortedStocks.length === 0 ? (
              quotesError ? (
                <Empty title="行情加载失败" description="网络异常，将按刷新间隔自动重试" />
              ) : (
                <Loading text="加载实时行情..." />
              )
            ) : marketTab === 'watchlist' && activeCodes.length === 0 ? (
              <Empty
                title="暂无自选股"
                description="搜索添加股票到当前分组，或一键恢复实证持仓"
                action={
                  <div className={styles.emptyActions}>
                    <Button size="sm" onClick={() => setShowImportModal(true)}>
                      <Upload size={14} />
                      导入股票
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<RefreshCw size={14} />}
                      onClick={handleSyncPortfolio}
                    >
                      同步实证账户持仓
                    </Button>
                  </div>
                }
              />
            ) : isDesktopTerminal ? (
              <>
                <div className={styles.tableMetaBar}>
                  <span className={styles.stockCount}>
                    {marketTab === 'watchlist'
                      ? `${activeGroup?.name} · 共 ${sortedStocks.length} 只`
                      : `${GLOBAL_MARKET_LIST.find((m) => m.id === marketTab)?.label ?? ''} · 共 ${sortedStocks.length} 只`}
                  </span>
                  {sortField !== 'default' && (
                    <button
                      type="button"
                      className={styles.resetSortBtn}
                      onClick={() => setSortField('default')}
                    >
                      恢复默认排序
                    </button>
                  )}
                  <span className={styles.kbdHint}>单击联动右图 · ↑↓ 切换 · 双击/Enter 详情</span>
                </div>

                <div className={styles.tableScrollWrap}>
                  <table className={styles.terminalTable}>
                    <thead>
                      <tr>
                        {showSelectMode && <th className={styles.thSelect}></th>}
                        {visibleColumns.map((col) => {
                          const alignRight =
                            col.key !== 'index' && col.key !== 'code' && col.key !== 'name';
                          return renderHeaderCell(col, alignRight);
                        })}
                        <th className={`${styles.th} ${styles.thAction}`}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedStocks.map((quote, idx) => {
                        const rowCode = normalizeStockCode(quote.code);
                        const quoteMarket = detectAssetMarket(rowCode);
                        const isOuterRow = quoteMarket !== 'cn';
                        const rowCurrency = quote.__currency || 'CNY';
                        const isInWatch = allWatchSet.has(rowCode);
                        const isSelected = selectedStocks.has(rowCode);
                        const isActiveRow =
                          effectiveActiveCode === rowCode &&
                          activeSelection?.source !== 'dock';
                        const isHeld = HELD_PORTFOLIO_SET.has(rowCode);
                        const speedVal = speedMap.get(rowCode) ?? null;
                        const flash = flashMap.get(rowCode);
                        const flashClass = flash
                          ? flash.dir === 'up'
                            ? flash.seq % 2 === 0
                              ? styles.flashRiseA
                              : styles.flashRiseB
                            : flash.seq % 2 === 0
                              ? styles.flashFallA
                              : styles.flashFallB
                          : '';
                        const colorClass = getChangeColorClass(quote.changePercent);

                        return (
                          <tr
                            key={rowCode}
                            ref={(el) => {
                              if (el) {
                                rowRefs.current.set(rowCode, el);
                              } else {
                                rowRefs.current.delete(rowCode);
                              }
                            }}
                            data-code={rowCode}
                            aria-selected={isActiveRow}
                            className={`${styles.tr} ${isActiveRow ? styles.activeRow : ''} ${isSelected ? styles.selectedRow : ''
                              } ${draggedCode === rowCode ? styles.draggingRow : ''}`}
                            onClick={(e) => {
                              triggerClickRipple(e);
                              if (showSelectMode) {
                                handleToggleSelect(rowCode);
                              } else {
                                setActiveSelection({
                                  code: rowCode,
                                  name: quote.name,
                                  source: 'table',
                                });
                              }
                            }}
                            onDoubleClick={() => {
                              if (!showSelectMode) {
                                navigate(`/s/${rowCode}`);
                              }
                            }}
                            draggable={sortField === 'default' && !showSelectMode}
                            onDragStart={() => handleDragStart(rowCode)}
                            onDragOver={(e) => handleDragOver(e, rowCode)}
                            onDrop={handleDrop}
                            onDragEnd={handleDragEnd}
                          >
                            {showSelectMode && (
                              <td className={styles.tdSelect}>
                                {isActiveRow && (
                                  <motion.span
                                    layoutId="watchlist-selected-bar"
                                    className={styles.selectedSideBar}
                                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                                  />
                                )}
                                <button
                                  type="button"
                                  className={styles.selectBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleSelect(rowCode);
                                  }}
                                >
                                  {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                                </button>
                              </td>
                            )}

                            {visibleColumnKeys.has('index') && (
                              <td className={`${styles.td} ${styles.tdIndex}`}>
                                {!showSelectMode && isActiveRow && (
                                  <motion.span
                                    layoutId="watchlist-selected-bar"
                                    className={styles.selectedSideBar}
                                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                                  />
                                )}
                                {sortField === 'default' && !showSelectMode ? (
                                  <span className={styles.indexWithDrag}>
                                    <GripVertical size={12} className={styles.dragHandle} />
                                    <span className={styles.indexNum}>{idx + 1}</span>
                                  </span>
                                ) : (
                                  idx + 1
                                )}
                              </td>
                            )}

                            {visibleColumnKeys.has('code') && (
                              <td className={`${styles.td} ${styles.tdMonoLeft}`}>
                                {!showSelectMode && !visibleColumnKeys.has('index') && isActiveRow && (
                                  <motion.span
                                    layoutId="watchlist-selected-bar"
                                    className={styles.selectedSideBar}
                                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                                  />
                                )}
                                {formatTerminalCodeLabel(quote.code)}
                              </td>
                            )}

                            {visibleColumnKeys.has('name') && (
                              <td className={`${styles.td} ${styles.tdName}`}>
                                {!showSelectMode &&
                                  !visibleColumnKeys.has('index') &&
                                  !visibleColumnKeys.has('code') &&
                                  isActiveRow && (
                                    <motion.span
                                      layoutId="watchlist-selected-bar"
                                      className={styles.selectedSideBar}
                                      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                                    />
                                  )}
                                <span className={styles.nameWrap}>
                                  <span className={styles.stockNameText} title={quote.name}>
                                    {quote.name}
                                  </span>
                                  {isOuterRow && (
                                    <span className={styles.heldTag} title={rowCurrency}>
                                      {OUTER_MARKET_BADGE[quoteMarket]}
                                    </span>
                                  )}
                                  {isHeld && (
                                    <span className={styles.heldTag} title="STK-ALIPAY-001 实证持仓">
                                      持
                                    </span>
                                  )}
                                </span>
                              </td>
                            )}

                            {visibleColumnKeys.has('changePercent') && (
                              <td
                                className={`${styles.td} ${styles.tdNum} ${styles.pctBarCell} ${colorClass} ${flashClass}`}
                                style={{
                                  '--pct-fill': `${Math.min(100, (Math.abs(quote.changePercent ?? 0) / 10) * 100).toFixed(1)}%`,
                                  '--pct-color': (quote.changePercent ?? 0) >= 0 ? 'var(--color-rise)' : 'var(--color-fall)',
                                } as React.CSSProperties}
                              >
                                <span className={styles.pctBarText}>
                                  {formatPercent(quote.changePercent)}
                                </span>
                              </td>
                            )}

                            {visibleColumnKeys.has('price') && (
                              <td
                                className={`${styles.td} ${styles.tdNum} ${colorClass} ${flashClass}`}
                              >
                                {quote.price != null && Number.isFinite(quote.price) ? (
                                  <AnimatedNumber
                                    value={quote.price}
                                    format={(val) =>
                                      isOuterRow
                                        ? formatCurrencyPrice(val, rowCurrency)
                                        : formatPrice(val)
                                    }
                                    flashOnChange
                                  />
                                ) : isOuterRow ? (
                                  formatCurrencyPrice(quote.price, rowCurrency)
                                ) : (
                                  formatPrice(quote.price)
                                )}
                              </td>
                            )}

                            {visibleColumnKeys.has('change') && (
                              <td className={`${styles.td} ${styles.tdNum} ${colorClass}`}>
                                {formatChange(quote.change)}
                              </td>
                            )}

                            {visibleColumnKeys.has('speed') && (
                              <td
                                className={`${styles.td} ${styles.tdNum} ${getChangeColorClass(
                                  speedVal
                                )}`}
                              >
                                {speedVal !== null ? formatPercent(speedVal) : '--'}
                              </td>
                            )}

                            {visibleColumnKeys.has('volumeRatio') && (
                              <td className={`${styles.td} ${styles.tdNum}`}>
                                {formatVolumeRatio(quote.volumeRatio)}
                              </td>
                            )}

                            {visibleColumnKeys.has('amount') && (
                              <td className={`${styles.td} ${styles.tdNum}`}>
                                {isOuterRow
                                  ? formatMarketValueByCurrency(quote.amount, rowCurrency)
                                  : formatAmount(quote.amount)}
                              </td>
                            )}

                            {visibleColumnKeys.has('turnoverRate') && (
                              <td className={`${styles.td} ${styles.tdNum}`}>
                                {formatTurnover(quote.turnoverRate)}
                              </td>
                            )}

                            {visibleColumnKeys.has('amplitude') && (
                              <td className={`${styles.td} ${styles.tdNum}`}>
                                {formatTurnover(quote.amplitude)}
                              </td>
                            )}

                            {visibleColumnKeys.has('peDynamic') && (
                              <td className={`${styles.td} ${styles.tdNum}`}>
                                {formatRatio(quote.peDynamic ?? quote.pe)}
                              </td>
                            )}

                            {visibleColumnKeys.has('totalMarketCap') && (
                              <td className={`${styles.td} ${styles.tdNum}`}>
                                {isOuterRow
                                  ? formatMarketValueByCurrency(quote.totalMarketCap, rowCurrency)
                                  : formatMarketCap(quote.totalMarketCap)}
                              </td>
                            )}

                            {visibleColumnKeys.has('circulatingMarketCap') && (
                              <td className={`${styles.td} ${styles.tdNum}`}>
                                {isOuterRow
                                  ? formatMarketValueByCurrency(
                                    quote.circulatingMarketCap,
                                    rowCurrency
                                  )
                                  : formatMarketCap(quote.circulatingMarketCap)}
                              </td>
                            )}

                            {visibleColumnKeys.has('highLow') && (
                              <td className={`${styles.td} ${styles.tdNum}`}>
                                {isOuterRow
                                  ? '-- / --'
                                  : `${formatPrice(quote.high)} / ${formatPrice(quote.low)}`}
                              </td>
                            )}

                            <td className={`${styles.td} ${styles.tdAction}`}>
                              <div className={styles.rowActionBtns}>
                                <button
                                  type="button"
                                  className={styles.rowIconBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/s/${rowCode}`);
                                  }}
                                  title="打开完整详情"
                                >
                                  <ExternalLink size={12} />
                                </button>
                                {marketTab === 'watchlist' ? (
                                  <button
                                    type="button"
                                    className={`${styles.rowIconBtn} ${styles.rowDeleteBtn}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveStock(quote.code);
                                    }}
                                    title="从分组移除"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className={styles.rowIconBtn}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isInWatch) {
                                        watchlistActions.remove(rowCode);
                                        toast.info(`已移出自选：${quote.name}`);
                                      } else {
                                        watchlistActions.add(rowCode, activeGroupId);
                                        toast.success(`已加入自选：${quote.name}`);
                                      }
                                    }}
                                    title={isInWatch ? '移出自选' : '加入自选'}
                                  >
                                    {isInWatch ? <Check size={12} /> : <Plus size={12} />}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              /* 移动端 / 平板（< 1100px）：保留紧凑单列列表，点击直达个股详情 */
              <div className={styles.mobileList}>
                {sortedStocks.map((quote) => {
                  const rowCode = normalizeStockCode(quote.code);
                  const quoteMarket = detectAssetMarket(rowCode);
                  const isOuterRow = quoteMarket !== 'cn';
                  const rowCurrency = quote.__currency || 'CNY';
                  const isInWatch = allWatchSet.has(rowCode);
                  const isSelected = selectedStocks.has(rowCode);
                  const isHeld = HELD_PORTFOLIO_SET.has(rowCode);
                  return (
                    <div
                      key={rowCode}
                      className={`${styles.mobileRow} ${isSelected ? styles.selectedRow : ''}`}
                      onClick={(e) => {
                        triggerClickRipple(e);
                        if (showSelectMode) {
                          handleToggleSelect(rowCode);
                        } else {
                          navigate(`/s/${rowCode}`);
                        }
                      }}
                    >
                      {showSelectMode && (
                        <button
                          type="button"
                          className={styles.selectBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSelect(rowCode);
                          }}
                        >
                          {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                      )}
                      <div className={styles.mobileNameCol}>
                        <span className={styles.stockNameText}>
                          {quote.name}
                          {isOuterRow && (
                            <span className={styles.heldTag}>{OUTER_MARKET_BADGE[quoteMarket]}</span>
                          )}
                          {isHeld && <span className={styles.heldTag}>持</span>}
                        </span>
                        <span className={styles.mobileSubCode}>{formatTerminalCodeLabel(quote.code)}</span>
                      </div>
                      <span className={`${styles.mobilePriceCol} ${getChangeColorClass(quote.changePercent)}`}>
                        {isOuterRow ? formatCurrencyPrice(quote.price, rowCurrency) : formatPrice(quote.price)}
                      </span>
                      <span
                        className={`${styles.mobilePctCol} ${getChangeColorClass(quote.changePercent)}`}
                        style={{
                          '--pct-fill': `${Math.min(100, (Math.abs(quote.changePercent ?? 0) / 10) * 100).toFixed(1)}%`,
                          '--pct-color': (quote.changePercent ?? 0) >= 0 ? 'var(--color-rise)' : 'var(--color-fall)',
                        } as React.CSSProperties}
                      >
                        {formatPercent(quote.changePercent)}
                      </span>
                      {marketTab === 'watchlist' ? (
                        <button
                          type="button"
                          className={styles.rowDeleteBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveStock(quote.code);
                          }}
                          title="移除"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.rowIconBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isInWatch) {
                              watchlistActions.remove(rowCode);
                              toast.info(`已移出自选：${quote.name}`);
                            } else {
                              watchlistActions.add(rowCode, activeGroupId);
                              toast.success(`已加入自选：${quote.name}`);
                            }
                          }}
                          title={isInWatch ? '移出自选' : '加入自选'}
                        >
                          {isInWatch ? <Check size={14} /> : <Plus size={14} />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部可折叠研究机会与持仓 Dock（仅桌面 >= 1100px 渲染） */}
          {isDesktopTerminal && (
            <WatchlistResearchDock
              activeWatchlistCodes={normalizedActiveCodes}
              onAddWatchlist={handleAddFromDock}
              onSelectSymbol={handleSelectFromDock}
            />
          )}
        </div>

        {/* 右分屏：当日分时 + K 线联动预览面板（仅桌面 >= 1100px 渲染） */}
        {isDesktopTerminal && (
          <div className={styles.rightZone}>
            <WatchlistPreviewPane
              code={effectiveActiveCode}
              fallbackName={
                activeSelection?.code === effectiveActiveCode ? activeSelection.name : undefined
              }
              quote={effectiveActiveQuote}
              timelineIntervalMs={pollingPlan.timelineIntervalMs}
              pollingEnabled={pollingPlan.enabled}
            />
          </div>
        )}
      </div>

      {/* 导入弹窗 */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {showImportModal && (
              <motion.div
                className={styles.modalOverlay}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowImportModal(false)}
              >
                <motion.div
                  className={styles.modal}
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className={styles.modalHeader}>
                    <h3>导入股票</h3>
                    <button
                      type="button"
                      className={styles.modalClose}
                      onClick={() => setShowImportModal(false)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className={styles.modalBody}>
                    <p className={styles.modalHint}>
                      输入股票代码，支持以下格式：
                      <br />
                      • 纯代码：000001, 600000
                      <br />
                      • 带市场：sh600000, sz000001
                      <br />
                      • 多个代码用逗号、空格或换行分隔
                    </p>
                    <textarea
                      className={styles.importTextarea}
                      placeholder="请输入股票代码..."
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      rows={6}
                    />
                  </div>
                  <div className={styles.modalFooter}>
                    <Button variant="ghost" onClick={() => setShowImportModal(false)}>
                      取消
                    </Button>
                    <Button variant="primary" onClick={handleImport}>
                      导入
                    </Button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
