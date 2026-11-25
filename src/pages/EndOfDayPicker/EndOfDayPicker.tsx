/**
 * 尾盘选股法（一日持股法）页面
 * 参考 __refer__ 目录逻辑实现
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  Target,
  ChevronLeft,
  SearchX,
  SlidersHorizontal,
  Check,
  ToggleLeft,
  ToggleRight,
  RotateCcw,
  Zap,
  Plus,
  Save,
  FolderOpen,
  Trash2,
  Clock,
  CircleStop,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckSquare,
  Square,
  X,
} from 'lucide-react';
import { NumberField, useToast } from '@/components/common';
import {
  analyzeEndOfDayStocks,
  type AnalysisProgress,
  type EndOfDayFilters,
  type EndOfDayStock,
  isAnalysisAborted,
  applyBackendVettingFilter,
  type TimelinePoint,
} from '@/services/analysis';
import { getEodPickerState, saveEodPickerState } from '@/services/storage';
import { watchlistActions } from '@/services/watchlistStore';
import { useIsInWatchlist } from '@/hooks';
import { formatAmount, getChangeColorClass } from '@/utils/format';
import {
  fetchGlobalPulse,
  formatPulseChangePct,
  formatPulsePrice,
  type GlobalPulsePayload,
} from '@/services/globalPulseApi';
import {
  fetchEodRegime,
  fetchEodJournal,
  postEodAnalyzeVetting,
  postEodJournalRecord,
  postEodJournalSettle,
  type EodRegimeSnapshot,
  type EodJournalResponse,
  type EodAnalyzeItem,
  type EodWinRateStats,
} from '@/services/eodApi';
import styles from './EndOfDayPicker.module.css';

// ========== 类型定义 ==========

interface SavedScheme {
  id: string;
  name: string;
  filters: EndOfDayFilters;
  createdAt: number;
}

interface RecentUsage {
  filters: EndOfDayFilters;
  usedAt: number;
}

type SortField = 'changePercent' | 'timelineAboveAvgRatio' | 'turnoverRate' | 'circulatingMarketCap' | 'volumeRatio';
type SortOrder = 'asc' | 'desc';
type EodTab = 'screen' | 'history';

function rawReferencePct(stats: EodWinRateStats, value: number | null, digits: number): string {
  return stats.statistics_basis === 'RAW_REFERENCE_GROSS_NOT_TRADE_WIN_RATE'
    && value != null && Number.isFinite(value) ? value.toFixed(digits) + '%' : 'N/A';
}

// ========== 常量 ==========

const MAX_RECENT_USAGE = 5;
const EOD_VETTING_BATCH_LIMIT = 30;

const DEFAULT_FILTERS: EndOfDayFilters = {
  marketCapMin: 50,
  marketCapMax: 200,
  volumeRatioMin: 1.2,
  changePercentMin: 3,
  changePercentMax: 5,
  turnoverRateMin: 5,
  turnoverRateMax: 10,
  excludeST: true,
  timelineAboveAvgRatio: 80,
  tail30mSlopeMin: null,
  tail30mAmountShareMin: null,
  intradayDrawbackMax: 3.0,
  requireMainInflow: false,
};

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'changePercent', label: '涨幅' },
  { field: 'timelineAboveAvgRatio', label: '分时强度' },
  { field: 'turnoverRate', label: '换手率' },
  { field: 'circulatingMarketCap', label: '流通市值' },
  { field: 'volumeRatio', label: '量比' },
];

// ========== 工具函数 ==========

// 自愈旧版 bug 持久化的 max=0（清空输入被存成 0，导致过滤条件全灭）
const healFilters = (filters: EndOfDayFilters): EndOfDayFilters => {
  const healed = { ...filters };
  for (const key of ['marketCapMax', 'changePercentMax', 'turnoverRateMax'] as const) {
    if (healed[key] === 0) healed[key] = null;
  }
  return healed;
};

const loadFiltersFromStorage = (): EndOfDayFilters => {
  const stored = getEodPickerState<Partial<EndOfDayFilters>>('filters', {});
  return healFilters({ ...DEFAULT_FILTERS, ...stored });
};

const saveFiltersToStorage = (filters: EndOfDayFilters): void => {
  saveEodPickerState('filters', filters);
};

const loadSchemesFromStorage = (): SavedScheme[] =>
  getEodPickerState<SavedScheme[]>('schemes', []);

const saveSchemesToStorage = (schemes: SavedScheme[]): void => {
  saveEodPickerState('schemes', schemes);
};

const loadRecentUsageFromStorage = (): RecentUsage[] =>
  getEodPickerState<RecentUsage[]>('recent', []);

const saveRecentUsageToStorage = (recentUsage: RecentUsage[]): void => {
  saveEodPickerState('recent', recentUsage);
};

const addRecentUsage = (filters: EndOfDayFilters): void => {
  const recent = loadRecentUsageFromStorage();
  const newEntry: RecentUsage = { filters, usedAt: Date.now() };
  // 检查是否已存在相同配置
  const isDuplicate = recent.some(
    (r) => JSON.stringify(r.filters) === JSON.stringify(filters)
  );
  if (!isDuplicate) {
    const updated = [newEntry, ...recent].slice(0, MAX_RECENT_USAGE);
    saveRecentUsageToStorage(updated);
  }
};

const formatNumber = (num: number | null, decimals = 2): string => {
  if (num === null || num === undefined) return '-';
  return num.toFixed(decimals);
};

const REGIME_LABEL: Record<string, { text: string; tone: string }> = {
  GREEN: { text: '绿灯 · 可操作', tone: 'green' },
  YELLOW: { text: '黄灯 · 分化收缩', tone: 'yellow' },
  RED: { text: '红灯 · 退潮预警', tone: 'red' },
  UNKNOWN: { text: '未知 · 谨慎核对', tone: 'unknown' },
};

const VETTING_LABEL: Record<string, string> = {
  CLEAN: '安检通过',
  WARNING: '需留意',
  TRAP_FLAGGED: '风险标记',
  UNKNOWN: '数据不足',
};

// ========== 子组件 ==========

// 分时图组件
function TimelineChart({ data, prevClose }: { data: TimelinePoint[]; prevClose: number }) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return null;

    const width = 320;
    const height = 100;
    const padding = { top: 6, right: 6, bottom: 6, left: 6 };

    const prices = data.map((d) => d.price);
    const avgPrices = data.map((d) => d.avgPrice);
    const allValues = [...prices, ...avgPrices, prevClose];

    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);
    const range = maxValue - minValue || 1;

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // 单点分时（开盘首分钟）分母为 0 会产生 NaN 路径
    const getX = (index: number) =>
      padding.left + (index / Math.max(data.length - 1, 1)) * chartWidth;
    const getY = (value: number) => padding.top + ((maxValue - value) / range) * chartHeight;

    const pricePath = data
      .map((d, i) => {
        const x = getX(i);
        const y = getY(d.price);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
      })
      .join(' ');

    const avgPath = data
      .map((d, i) => {
        const x = getX(i);
        const y = getY(d.avgPrice);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
      })
      .join(' ');

    const fillPath =
      pricePath +
      ` L ${getX(data.length - 1)} ${height - padding.bottom}` +
      ` L ${padding.left} ${height - padding.bottom} Z`;

    const prevCloseY = getY(prevClose);
    const lastPoint = data[data.length - 1];
    const lastX = getX(data.length - 1);
    const lastY = getY(lastPoint.price);

    return {
      width,
      height,
      pricePath,
      avgPath,
      fillPath,
      prevCloseY,
      lastX,
      lastY,
      isPositive: lastPoint.price >= prevClose,
    };
  }, [data, prevClose]);

  if (!chartData) {
    return <div className={styles.chartEmpty}>暂无分时数据</div>;
  }

  return (
    <div className={styles.timelineChart}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${chartData.width} ${chartData.height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="priceGradientEOD" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop
              offset="0%"
              stopColor={chartData.isPositive ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}
            />
            <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
          </linearGradient>
        </defs>

        <path d={chartData.fillPath} fill="url(#priceGradientEOD)" />

        <line
          x1={5}
          y1={chartData.prevCloseY}
          x2={chartData.width - 5}
          y2={chartData.prevCloseY}
          stroke="var(--text-tertiary)"
          strokeWidth={1}
          strokeDasharray="4 2"
          opacity={0.5}
        />

        <path
          d={chartData.avgPath}
          fill="none"
          stroke="var(--color-warning)"
          strokeWidth={1.5}
          opacity={0.8}
        />

        <path
          d={chartData.pricePath}
          fill="none"
          stroke={chartData.isPositive ? 'var(--color-rise)' : 'var(--color-fall)'}
          strokeWidth={1.5}
        />

        <circle
          cx={chartData.lastX}
          cy={chartData.lastY}
          r={3}
          fill={chartData.isPositive ? 'var(--color-rise)' : 'var(--color-fall)'}
        />
      </svg>
      <div className={styles.chartLegend}>
        <span className={styles.legendItem}>
          <span
            className={styles.legendLine}
            style={{
              background: chartData.isPositive ? 'var(--color-rise)' : 'var(--color-fall)',
            }}
          />
          价格
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendLine} style={{ background: 'var(--color-warning)' }} />
          均价
        </span>
      </div>
    </div>
  );
}

// 股票卡片组件
function StockCard({
  stock,
  index,
  inWatchlist,
  onAddWatchlist,
  isSelected,
  onToggleSelect,
  showSelect,
}: {
  stock: EndOfDayStock;
  index: number;
  inWatchlist: boolean;
  onAddWatchlist: (routeCode: string, name: string) => void;
  isSelected?: boolean;
  onToggleSelect?: (code: string) => void;
  showSelect?: boolean;
}) {
  const navigate = useNavigate();
  const isPositive = stock.changePercent >= 0;

  const handleCardClick = () => {
    navigate(`/s/${stock.routeCode}`);
  };

  const handleSelectClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelect?.(stock.code);
  };

  return (
    <motion.div
      className={`${styles.stockCard} ${isPositive ? styles.positive : styles.negative} ${isSelected ? styles.selected : ''}`}
      initial={{ opacity: 0, y: 30, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.4,
        delay: Math.min(index, 12) * 0.05,
        ease: 'easeOut',
      }}
      whileHover={{
        scale: 1.02,
        y: -3,
        transition: { duration: 0.2 },
      }}
      onClick={handleCardClick}
    >
      <div className={styles.stockHeader}>
        <div className={styles.stockInfo}>
          <div className={styles.stockNameRow}>
            {showSelect && (
              <button className={styles.selectBtn} onClick={handleSelectClick}>
                {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
              </button>
            )}
            <h3 className={styles.stockName}>{stock.name}</h3>
          </div>
          <span className={styles.stockCode}>{stock.code}</span>
        </div>
        <motion.div
          className={styles.changeBadge}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: Math.min(index, 12) * 0.05 + 0.2, type: 'spring' }}
        >
          <span className={styles.changeIcon}>{isPositive ? '▲' : '▼'}</span>
          <span className={styles.changePercent}>{formatNumber(stock.changePercent)}%</span>
        </motion.div>
      </div>

      <div className={styles.priceSection}>
        <div className={styles.currentPrice}>
          <span className={styles.priceLabel}>现价</span>
          <span className={styles.priceValue}>{formatNumber(stock.price)}</span>
        </div>
        <div className={styles.priceChange}>
          <span className={styles.changeValue}>
            {isPositive ? '+' : ''}
            {formatNumber(stock.change)}
          </span>
          {stock.timelineAboveAvgRatio !== undefined && (
            <span className={styles.timelineRatio} title={stock.timelineAverageBasis === 'CUMULATIVE_AMOUNT_PER_SHARE'
              ? '实际累计额 / 累计量'
              : '分时均价可能为分钟收盘价量加权近似或口径未声明，不是逐笔 VWAP'}>
              强度 {stock.timelineAboveAvgRatio.toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      {stock.timeline && stock.timeline.length > 0 && (
        <div className={styles.timelineSection}>
          <TimelineChart data={stock.timeline} prevClose={stock.prevClose} />
        </div>
      )}

      <div className={styles.dataGrid}>
        <div className={styles.dataItem}>
          <span className={styles.dataLabel}>流通市值</span>
          <span className={styles.dataValue}>{formatNumber(stock.circulatingMarketCap)}亿</span>
        </div>
        <div className={styles.dataItem}>
          <span className={styles.dataLabel}>量比</span>
          <span className={styles.dataValue}>{formatNumber(stock.volumeRatio)}</span>
        </div>
        <div className={styles.dataItem}>
          <span className={styles.dataLabel}>换手率</span>
          <span className={styles.dataValue}>{formatNumber(stock.turnoverRate)}%</span>
        </div>
        <div className={styles.dataItem}>
          <span className={styles.dataLabel}>成交额</span>
          <span className={styles.dataValue}>{formatAmount(stock.amount)}</span>
        </div>
      </div>

      {/* M1 尾盘 2.0 结构角标（后端校验后回填） */}
      {(stock.tail30mReturnPct !== undefined ||
        stock.tail30mAmountSharePct !== undefined ||
        stock.vettingStatus) && (
        <div className={styles.eodBadges}>
          {stock.tail30mReturnPct !== undefined && stock.tail30mReturnPct !== null && (
            <span className={styles.eodBadge} title="14:30 至收盘涨跌幅">
              尾盘斜率 {stock.tail30mReturnPct >= 0 ? '+' : ''}{stock.tail30mReturnPct.toFixed(2)}%
            </span>
          )}
          {stock.tail30mAmountSharePct !== undefined && stock.tail30mAmountSharePct !== null && (
            <span className={styles.eodBadge} title="尾盘成交额占全天比例">
              尾盘额占比 {stock.tail30mAmountSharePct.toFixed(1)}%
            </span>
          )}
          {stock.chipEstimateBasis === 'PRICE_BINNED_DAILY_TURNOVER_APPROX'
            && stock.chipProfitRatioApprox != null && stock.chipKnownCoveragePct != null && (
            <span className={styles.eodBadge} title="前收盘存量的日线价格分箱模型；未知初始存量不计入获利或套牢，非 Level-2">
              已建模获利 {stock.chipProfitRatioApprox.toFixed(1)}% · 覆盖 {stock.chipKnownCoveragePct.toFixed(1)}%
            </span>
          )}
          {stock.vettingStatus && (
            <span
              className={`${styles.vettingBadge} ${
                stock.vettingStatus === 'CLEAN'
                  ? styles.vetClean
                  : stock.vettingStatus === 'TRAP_FLAGGED'
                    ? styles.vetTrap
                    : styles.vetWarn
              }`}
              title={stock.vettingFlags?.join('、') || 'CANDIDATE_VETTING_ONLY'}
            >
              {VETTING_LABEL[stock.vettingStatus] ?? stock.vettingStatus}
            </span>
          )}
        </div>
      )}

      <div className={styles.cardActions}>
        <button
          className={`${styles.addWatchlistBtn} ${inWatchlist ? styles.added : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!inWatchlist) {
              onAddWatchlist(stock.routeCode, stock.name);
            }
          }}
          disabled={inWatchlist}
        >
          {inWatchlist ? <Check size={14} /> : <Plus size={14} />}
          {inWatchlist ? '已自选' : '加自选'}
        </button>
        <button
          className={styles.cardDeepResearchBtn}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/expert?subject=${stock.routeCode}`);
          }}
          title="进入深研工作台"
        >
          深研
        </button>
      </div>
    </motion.div>
  );
}

// 加载遮罩组件
function LoadingOverlay({
  progress,
  onCancel,
}: {
  progress: AnalysisProgress;
  onCancel: () => void;
}) {
  const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <motion.div
      className={styles.loadingOverlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className={styles.loadingContent}>
        <div className={styles.loadingSpinner}>
          <motion.div
            className={styles.spinnerRing}
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          />
          <div className={styles.spinnerCenter}>
            <motion.span
              className={styles.loadingPercentage}
              key={percentage}
              initial={{ scale: 1.2, opacity: 0.5 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              {percentage}%
            </motion.span>
          </div>
        </div>

        <div className={styles.loadingProgress}>
          <motion.div
            className={styles.loadingProgressFill}
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>

        <div className={styles.loadingStatus}>
          <p className={styles.loadingText}>{progress.stage || '正在扫描全市场股票数据...'}</p>
          <p className={styles.loadingDetail}>
            {progress.total > 0
              ? `已处理 ${progress.completed} / ${progress.total}`
              : '正在初始化连接...'}
          </p>
        </div>

        <button className={styles.cancelAnalysisBtn} onClick={onCancel}>
          <CircleStop size={16} />
          取消分析
        </button>
      </div>
    </motion.div>
  );
}

// ========== 主组件 ==========

export function EndOfDayPicker() {
  const toast = useToast();
  const [filters, setFilters] = useState<EndOfDayFilters>(loadFiltersFromStorage);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<AnalysisProgress>({
    completed: 0,
    total: 0,
    stage: '',
  });
  const [stocks, setStocks] = useState<EndOfDayStock[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // 离开页面即中止分析：全市场扫描请求量大，不中止会在后台跑完
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // M1：进入页面即拉取当日情绪红绿灯与亚太同频外围定价锚（离线时优雅降级，不阻断主流程）
  useEffect(() => {
    let cancelled = false;
    setRegimeLoading(true);
    fetchEodRegime()
      .then((data) => { if (!cancelled) setRegime(data); })
      .catch(() => { if (!cancelled) setRegime(null); })
      .finally(() => { if (!cancelled) setRegimeLoading(false); });
    fetchGlobalPulse()
      .then((data) => { if (!cancelled) setApacPulse(data); })
      .catch(() => { if (!cancelled) setApacPulseFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const loadJournal = useCallback(async () => {
    setJournalBusy(true);
    try {
      setJournal(await fetchEodJournal());
    } catch (error) {
      console.error('加载尾盘账本失败:', error);
    } finally {
      setJournalBusy(false);
    }
  }, []);

  // 方案管理
  const [savedSchemes, setSavedSchemes] = useState<SavedScheme[]>(loadSchemesFromStorage);
  const [recentUsage, setRecentUsage] = useState<RecentUsage[]>(loadRecentUsageFromStorage);
  const [showSchemePanel, setShowSchemePanel] = useState(false);
  const [showRecentPanel, setShowRecentPanel] = useState(false);
  const [newSchemeName, setNewSchemeName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  // 当前生效方案名（加载/保存方案后记录快照须沿用此名，而非回落默认值）
  const [activeSchemeName, setActiveSchemeName] = useState<string>('默认尾盘方案');

  // 排序
  const [sortField, setSortField] = useState<SortField>('timelineAboveAvgRatio');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // 批量选择
  const [selectedStocks, setSelectedStocks] = useState<Set<string>>(new Set());
  const [showSelectMode, setShowSelectMode] = useState(false);

  // M1 尾盘 2.0 状态
  const [activeTab, setActiveTab] = useState<EodTab>('screen');
  const [regime, setRegime] = useState<EodRegimeSnapshot | null>(null);
  const [regimeLoading, setRegimeLoading] = useState(false);
  const [apacPulse, setApacPulse] = useState<GlobalPulsePayload | null>(null);
  const [apacPulseFailed, setApacPulseFailed] = useState(false);
  const [vettingBusy, setVettingBusy] = useState(false);
  const [journal, setJournal] = useState<EodJournalResponse | null>(null);
  const [journalBusy, setJournalBusy] = useState(false);

  // 保存筛选条件（debounce：filters 随交互高频变化，不必每次都同步写盘）
  useEffect(() => {
    const timer = window.setTimeout(() => saveFiltersToStorage(filters), 500);
    return () => clearTimeout(timer);
  }, [filters]);

  // 恢复默认设置
  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  // 开始分析
  const handleStartAnalysis = useCallback(async () => {
    setIsLoading(true);
    setLoadingProgress({ completed: 0, total: 0, stage: '获取行情数据' });
    setStocks([]);
    const controller = new AbortController();
    abortRef.current = controller;

    // 记录最近使用
    addRecentUsage(filters);
    setRecentUsage(loadRecentUsageFromStorage());

    try {
      const finalStocks = await analyzeEndOfDayStocks(filters, {
        signal: controller.signal,
        onProgress: setLoadingProgress,
      });

      if (finalStocks.length === 0) {
        toast.info('没有符合基础条件的股票，请尝试调整筛选条件');
        setHasAnalyzed(true);
        return;
      }

      if (!controller.signal.aborted) {
        setStocks(finalStocks);
      }
      setHasAnalyzed(true);
    } catch (error) {
      if (isAnalysisAborted(error)) {
        toast.info('已取消分析');
      } else {
        console.error('获取股票数据失败:', error);
        toast.error('获取股票数据失败，请重试');
      }
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  }, [filters, toast]);

  const handleCancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // 加入自选
  const handleAddWatchlist = useCallback(
    (routeCode: string, name: string) => {
      watchlistActions.add(routeCode);
      toast.success(`已将 ${name} 加入自选`);
    },
    [toast]
  );

  // 更新筛选条件
  const handleFilterChange = (
    key: keyof EndOfDayFilters,
    value: number | boolean | null
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  // 保存方案
  const handleSaveScheme = useCallback(() => {
    if (!newSchemeName.trim()) {
      toast.warning('请输入方案名称');
      return;
    }
    const newScheme: SavedScheme = {
      id: Date.now().toString(),
      name: newSchemeName.trim(),
      filters: { ...filters },
      createdAt: Date.now(),
    };
    const updated = [...savedSchemes, newScheme];
    setSavedSchemes(updated);
    saveSchemesToStorage(updated);
    setNewSchemeName('');
    setShowSaveInput(false);
    setActiveSchemeName(newScheme.name);
    toast.success(`方案「${newScheme.name}」已保存`);
  }, [newSchemeName, filters, savedSchemes, toast]);

  // 加载方案
  const handleLoadScheme = useCallback((scheme: SavedScheme) => {
    setFilters(healFilters(scheme.filters));
    setActiveSchemeName(scheme.name);
    setShowSchemePanel(false);
    toast.success(`已加载方案「${scheme.name}」`);
  }, [toast]);

  // 删除方案
  const handleDeleteScheme = useCallback((schemeId: string) => {
    const updated = savedSchemes.filter((s) => s.id !== schemeId);
    setSavedSchemes(updated);
    saveSchemesToStorage(updated);
    toast.success('方案已删除');
  }, [savedSchemes, toast]);

  // 加载最近使用
  const handleLoadRecent = useCallback((recent: RecentUsage) => {
    setFilters(healFilters(recent.filters));
    setActiveSchemeName('默认尾盘方案');
    setShowRecentPanel(false);
    toast.success('已加载历史配置');
  }, [toast]);

  // 排序股票
  const sortedStocks = useMemo(() => {
    return [...stocks].sort((a, b) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      return sortOrder === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
    });
  }, [stocks, sortField, sortOrder]);

  // 切换排序
  const handleSortChange = useCallback((field: SortField) => {
    if (field === sortField) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  }, [sortField]);

  // 切换选择
  const handleToggleSelect = useCallback((code: string) => {
    setSelectedStocks((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(code)) {
        newSet.delete(code);
      } else {
        newSet.add(code);
      }
      return newSet;
    });
  }, []);

  // 全选/取消全选
  const handleSelectAll = useCallback(() => {
    if (selectedStocks.size === sortedStocks.length) {
      setSelectedStocks(new Set());
    } else {
      setSelectedStocks(new Set(sortedStocks.map((s) => s.code)));
    }
  }, [selectedStocks.size, sortedStocks]);

  const isInWatchlist = useIsInWatchlist();

  // 批量加入自选
  const handleBatchAddWatchlist = useCallback(() => {
    const routeCodes = stocks
      .filter((stock) => selectedStocks.has(stock.code) && !isInWatchlist(stock.routeCode))
      .map((stock) => stock.routeCode);
    const addedCount = routeCodes.length > 0 ? watchlistActions.batchAdd(routeCodes) : 0;
    if (addedCount > 0) {
      toast.success(`已将 ${addedCount} 只股票加入自选`);
    } else {
      toast.info('所选股票已在自选中');
    }
    setSelectedStocks(new Set());
    setShowSelectMode(false);
  }, [isInWatchlist, selectedStocks, stocks, toast]);

  // M1：调用后端对候选池做权威结构校验 + 批量排雷（上限 30 只）
  const handleRunVetting = useCallback(async () => {
    const targets = stocks.length > EOD_VETTING_BATCH_LIMIT ? stocks.slice(0, EOD_VETTING_BATCH_LIMIT) : stocks;
    if (targets.length === 0) {
      toast.warning('请先筛选出候选股票');
      return;
    }
    setVettingBusy(true);
    try {
      const tradeDate = regime?.trade_date ?? new Date().toISOString().slice(0, 10);
      const result = await postEodAnalyzeVetting(
        targets.map((s) => ({
          code: s.routeCode,
          name: s.name,
          pick_price: s.price,
          change_percent: s.changePercent,
          timeline: s.timeline?.map(p => ({...p, time: s.timelineTradeDate ? s.timelineTradeDate + ' ' + p.time : p.time})),
          tail_30m_return_pct: s.tail30mReturnPct ?? null,
          tail_30m_amount_share_pct: s.tail30mAmountSharePct ?? null,
        })),
        tradeDate
      );
      const byCode = new Map<string, EodAnalyzeItem>(result.items.map((it) => [it.code.replace(/^(sh|sz|bj)/, ''), it]));
      setStocks((prev) =>
        prev
          .map((s) => {
            const hit = byCode.get(s.code) ?? byCode.get(s.routeCode.replace(/^(sh|sz|bj)/, ''));
            if (!hit) return s;
            return {
              ...s,
              tail30mReturnPct: hit.structure_factors.tail_30m_return_pct,
              tail30mAmountSharePct: hit.structure_factors.tail_30m_amount_share_pct,
              chipProfitRatioApprox: hit.structure_factors.chip_profit_ratio_approx,
              chipEstimateBasis: hit.structure_factors.chip_estimate_basis,
              chipKnownCoveragePct: hit.structure_factors.chip_known_coverage_pct,
              mainNetInflow10k: hit.structure_factors.main_net_inflow_10k,
              vettingStatus: hit.vetting.vetting_status,
              vettingFlags: hit.vetting.flags,
            };
          })
          // 后结构校验联动：requireMainInflow 开启时剔除主力净流入非正/缺失者
          .filter((s) => applyBackendVettingFilter(s, filters))
      );
      if (stocks.length > EOD_VETTING_BATCH_LIMIT) {
        toast.info(`候选超过 ${EOD_VETTING_BATCH_LIMIT} 只，仅校验前 ${EOD_VETTING_BATCH_LIMIT} 只`);
      } else {
        toast.success('结构校验与批量排雷完成（仅风险安检，非买入建议）');
      }
    } catch (error) {
      console.error('尾盘结构校验失败:', error);
      toast.error('结构校验失败，请检查后端连接');
    } finally {
      setVettingBusy(false);
    }
  }, [stocks, regime, filters, toast]);

  // M1：记录当前候选快照至仓外胜率账本
  const handleRecordSnapshot = useCallback(async () => {
    if (stocks.length === 0) {
      toast.warning('请先筛选出候选股票');
      return;
    }
    const tradeDate = regime?.trade_date;
    if (!tradeDate) {
      toast.warning("缺少明确交易日，不能记录候选快照");
      return;
    }
    const schemeName = activeSchemeName.trim() || '默认尾盘方案';
    const stamp = Date.now();
    try {
      const written = await postEodJournalRecord({
        journal_version: 2,
        snapshot_id: `${tradeDate}_${stamp}`,
        trade_date: tradeDate,
        created_at: new Date().toISOString(),
        scheme_name: schemeName,
        filters: filters as unknown as Record<string, unknown>,
        market_regime: regime?.regime ?? 'UNKNOWN',
        candidates: stocks.slice(0, EOD_VETTING_BATCH_LIMIT).map((s) => ({
          code: s.code,
          name: s.name,
          pick_price: s.price,
          change_percent: s.changePercent,
          tail_30m_return_pct: s.tail30mReturnPct ?? null,
          tail_30m_amount_share_pct: s.tail30mAmountSharePct ?? null,
          vetting_status: (s.vettingStatus as EodJournalResponse['snapshots'][number]['candidates'][number]['vetting_status']) ?? null,
          settlement: {
            t1_date: null, t1_open_premium_pct: null, t1_high_return_pct: null,
            t1_close_return_pct: null, t3_date: null, t3_close_return_pct: null, status: 'PENDING',
          },
        })),
        research_only: true,
        execution_allowed: false,
      });
      if (written.written) {
        toast.success(`已记录参考快照「${schemeName}」（非正式预测）`);
      } else {
        toast.info('该快照已存在，未重复写入');
      }
    } catch (error) {
      console.error('记录快照失败:', error);
      toast.error('记录失败，请检查后端连接');
    }
  }, [stocks, regime, filters, activeSchemeName, toast]);

  // M1：一键结算历史待验证样本
  const handleSettleJournal = useCallback(async () => {
    setJournalBusy(true);
    try {
      const result = await postEodJournalSettle();
      toast.success(result.changed > 0 ? `已结算 ${result.changed} 处待验证样本` : '暂无可结算的新样本');
      await loadJournal();
    } catch (error) {
      console.error('结算账本失败:', error);
      toast.error('结算失败，请检查后端连接');
    } finally {
      setJournalBusy(false);
    }
  }, [loadJournal, toast]);

  const handleTabChange = useCallback((tab: EodTab) => {
    setActiveTab(tab);
    if (tab === 'history' && !journal) {
      void loadJournal();
    }
  }, [journal, loadJournal]);

  return (
    <div className={styles.container}>
      {/* 页面头部 */}
      <motion.header
        className={styles.header}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className={styles.titleSection}>
          <h1 className={styles.title}>
            <TrendingUp size={24} />
            尾盘选股法
          </h1>
          <p className={styles.subtitle}>
            一日持股法分析工具 · 筛选分时强势股票
          </p>
        </div>
      </motion.header>

      <main className={styles.main}>
        {/* M1 情绪门控条 */}
        {regime && (
          <div className={`${styles.regimeBar} ${styles[`regime_${REGIME_LABEL[regime.regime]?.tone ?? 'unknown'}`] ?? ''}`}>
            <div className={styles.regimeMain}>
              <span className={styles.regimeDot} />
              <span className={styles.regimeLabel}>
                {regimeLoading ? '刷新中…' : REGIME_LABEL[regime.regime]?.text ?? regime.regime}
              </span>
            </div>
            <div className={styles.regimeMetrics}>
              <span>上涨占比 {formatNumber(regime.advance_ratio_pct, 1)}%</span>
              <span>炸板率 {formatNumber(regime.broken_board_rate_pct, 1)}%</span>
              <span>涨停 {regime.limit_up_count ?? '-'}</span>
              <span>跌停 {regime.limit_down_count ?? '-'}</span>
              {regime.max_streak_height !== null && <span>最高连板 {regime.max_streak_height}</span>}
            </div>
          </div>
        )}
        {regime?.regime === 'RED' && (
          <div className={styles.regimeWarning}>
            情绪处于红灯退潮区间，本工具仅作候选风险安检与研究观察，请注意控制风险、谨慎人工核对。
          </div>
        )}
        {regime && !regime.data_available && (
          <div className={styles.regimeWarning}>{regime.note || '情绪数据暂不可用，请谨慎人工核对'}</div>
        )}

        <div className={styles.apacPulseBar} data-testid="eod-apac-pulse">
          <span className={styles.apacPulseTitle}>亚太同频外围参考</span>
          <div className={styles.apacPulseList}>
            {apacPulseFailed && !apacPulse ? (
              <span className={styles.apacPulseEmpty}>外围参考暂不可用（不阻断尾盘筛选）</span>
            ) : !apacPulse ? (
              <span className={styles.apacPulseEmpty}>正在同步亚太及离岸汇率...</span>
            ) : (
              apacPulse.items
                .filter((it) => ['HSI', 'HSTECH', 'N225', 'KS11', 'USDCNH'].includes(it.code))
                .map((item) => {
                  const colorCls =
                    item.status !== 'UNAVAILABLE' && item.change_pct !== null
                      ? getChangeColorClass(item.change_pct)
                      : styles.apacPulseMuted;
                  return (
                    <span
                      key={item.code}
                      className={styles.apacPulseChip}
                      title={`${item.name} · ${item.session_label}`}
                    >
                      <span className={styles.apacPulseName}>{item.short_name}</span>
                      <span className={styles.apacPulsePrice}>{formatPulsePrice(item)}</span>
                      <span className={`${styles.apacPulsePct} ${colorCls}`}>
                        {formatPulseChangePct(item)}
                      </span>
                    </span>
                  );
                })
            )}
          </div>
          <span className={styles.apacPulseNote}>研究对照 · 非交易指令</span>
        </div>

        {/* M1 双 Tab 切换 */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'screen' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('screen')}
          >
            尾盘筛选与安检
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'history' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('history')}
          >
            历史参考价验证
          </button>
        </div>

        {activeTab === 'history' ? (
          /* ============ Tab 2：历史验证与方案胜率 ============ */
          <div className={styles.historyPanel}>
            <div className={styles.historyHeader}>
              <div>
                <h2 className={styles.historyTitle}>方案参考价观察</h2>
                <p className={styles.historyHint}>
                  仅比较筛选参考价与 T+1/T+3 已完成日线的未复权价格。未计成本及公司行为，不代表真实成交、投资收益或前瞻预测准确率；旧口径数据不混算。
                </p>
              </div>
              <button
                className={styles.settleBtn}
                onClick={handleSettleJournal}
                disabled={journalBusy}
              >
                <RotateCcw size={14} />
                {journalBusy ? '结算中…' : '一键结算待验证样本'}
              </button>
            </div>

            {journalBusy && !journal ? (
              <p className={styles.emptyHint}>加载账本中…</p>
            ) : !journal || journal.stats.schemes.length === 0 ? (
              <div className={styles.noResults}>
                <FolderOpen size={48} strokeWidth={1} />
                <p className={styles.noResultsTitle}>暂无历史快照</p>
                <p className={styles.noResultsHint}>在「尾盘筛选与安检」页记录快照后，待 T+1 / T+3 完整日线到位即可查看参考价观察。</p>
              </div>
            ) : (
              <>
                <div className={styles.statsOverview}>
                  <div className={styles.statCard}><span>快照数</span><strong>{journal.stats.snapshot_count}</strong></div>
                  <div className={styles.statCard}><span>候选样本</span><strong>{journal.stats.candidate_count}</strong></div>
                  <div className={styles.statCard}><span>方案数</span><strong>{journal.stats.schemes.length}</strong></div>
                </div>
                <div className={styles.schemeStatsList}>
                  {journal.stats.schemes.map((scheme) => (
                    <div key={scheme.scheme_name} className={styles.schemeStatCard}>
                      <h3 className={styles.schemeStatName}>{scheme.scheme_name}</h3>
                      <p className={styles.historyHint}>旧口径排除：{scheme.overall.legacy_excluded_count ?? "未核实"}；未观察样本不按零计。</p>
                      <div className={styles.winRateGrid}>
                        <div className={styles.winRateItem}>
                          <span>T+1 开盘上涨占比</span>
                          <strong>{rawReferencePct(scheme.overall, scheme.overall.t1_open_win_rate_pct, 1)}</strong>
                          <small>观察 {scheme.overall.t1_open_observation_count ?? 0}/{scheme.overall.sample_count}</small>
                        </div>
                        <div className={styles.winRateItem}>
                          <span>T+1 收盘上涨占比</span>
                          <strong>{rawReferencePct(scheme.overall, scheme.overall.t1_close_win_rate_pct, 1)}</strong>
                          <small>观察 {scheme.overall.t1_close_observation_count ?? 0}/{scheme.overall.sample_count}</small>
                        </div>
                        <div className={styles.winRateItem}>
                          <span>T+3 收盘上涨占比</span>
                          <strong>{rawReferencePct(scheme.overall, scheme.overall.t3_close_win_rate_pct, 1)}</strong>
                          <small>观察 {scheme.overall.t3_close_observation_count ?? 0}/{scheme.overall.sample_count}</small>
                        </div>
                        <div className={styles.winRateItem}>
                          <span>平均开盘溢价</span>
                          <strong>{rawReferencePct(scheme.overall, scheme.overall.avg_open_premium_pct, 2)}</strong>
                        </div>
                      </div>
                      {Object.keys(scheme.by_regime).length > 0 && (
                        <div className={styles.regimeBreakdown}>
                          <span className={styles.breakdownLabel}>按情绪分层：</span>
                          {Object.entries(scheme.by_regime).map(([r, st]) => (
                            <span key={r} className={styles.breakdownItem}>
                              {REGIME_LABEL[r]?.text ?? r} T+1开盘 {rawReferencePct(st, st.t1_open_win_rate_pct, 0)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <details className={styles.snapshotDetails}>
                  <summary>逐日快照明细（{journal.snapshots.length} 条）</summary>
                  {journal.snapshots.map((snap) => (
                    <div key={snap.snapshot_id} className={styles.snapshotRow}>
                      <span>{snap.trade_date}</span>
                      <span>{snap.scheme_name}</span>
                      <span>{REGIME_LABEL[snap.market_regime]?.text ?? snap.market_regime}</span>
                      <span>{snap.candidates.length} 只候选</span>
                    </div>
                  ))}
                </details>
              </>
            )}
          </div>
        ) : (
        <AnimatePresence mode="wait">
          {!hasAnalyzed ? (
            <motion.div
              key="start-screen"
              className={styles.startScreen}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.4 }}
            >
              {/* 开始按钮 */}
              <motion.div
                className={styles.startButtonContainer}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
              >
                <motion.button
                  className={styles.startButton}
                  onClick={handleStartAnalysis}
                  disabled={isLoading}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <span className={styles.buttonGlow} />
                  <span className={styles.buttonContent}>
                    <Zap size={28} />
                    <span>开始分析</span>
                  </span>
                </motion.button>
              </motion.div>

              {/* 筛选条件卡片 */}
              <motion.div
                className={`${styles.filterCard} ${isEditing ? styles.editing : ''}`}
                onClick={() => !isEditing && setIsEditing(true)}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                whileHover={!isEditing ? { scale: 1.01 } : undefined}
              >
                <div className={styles.filterHeader}>
                  <div className={styles.filterTitle}>
                    <SlidersHorizontal size={20} />
                    <span>筛选条件</span>
                  </div>
                  <div className={styles.filterActions}>
                    <AnimatePresence mode="wait">
                      {isEditing ? (
                        <motion.div
                          key="editing"
                          className={styles.editActions}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                        >
                          <button
                            className={styles.resetBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResetFilters();
                            }}
                            title="恢复默认"
                          >
                            <RotateCcw size={14} />
                            默认
                          </button>
                          <button
                            className={styles.schemeBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowSchemePanel(!showSchemePanel);
                              setShowRecentPanel(false);
                            }}
                            title="管理方案"
                          >
                            <FolderOpen size={14} />
                            方案
                          </button>
                          <button
                            className={styles.recentBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowRecentPanel(!showRecentPanel);
                              setShowSchemePanel(false);
                            }}
                            title="最近使用"
                          >
                            <Clock size={14} />
                            历史
                          </button>
                          <button
                            className={styles.saveBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsEditing(false);
                              setShowSchemePanel(false);
                              setShowRecentPanel(false);
                            }}
                          >
                            <Check size={14} />
                            完成
                          </button>
                        </motion.div>
                      ) : (
                        <motion.span
                          key="hint"
                          className={styles.editHint}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          点击编辑
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* 方案管理面板 */}
                <AnimatePresence>
                  {showSchemePanel && (
                    <motion.div
                      className={styles.schemePanel}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className={styles.schemePanelHeader}>
                        <span>保存的方案</span>
                        <button
                          className={styles.addSchemeBtn}
                          onClick={() => setShowSaveInput(!showSaveInput)}
                        >
                          <Plus size={14} />
                          保存当前
                        </button>
                      </div>
                      {showSaveInput && (
                        <div className={styles.saveInputRow}>
                          <input
                            type="text"
                            placeholder="输入方案名称"
                            value={newSchemeName}
                            onChange={(e) => setNewSchemeName(e.target.value)}
                            className={styles.schemeNameInput}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveScheme()}
                          />
                          <button className={styles.confirmSaveBtn} onClick={handleSaveScheme}>
                            <Save size={14} />
                          </button>
                        </div>
                      )}
                      {savedSchemes.length > 0 ? (
                        <div className={styles.schemeList}>
                          {savedSchemes.map((scheme) => (
                            <div key={scheme.id} className={styles.schemeItem}>
                              <button
                                className={styles.schemeLoadBtn}
                                onClick={() => handleLoadScheme(scheme)}
                              >
                                {scheme.name}
                              </button>
                              <button
                                className={styles.schemeDeleteBtn}
                                onClick={() => handleDeleteScheme(scheme.id)}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.emptyHint}>暂无保存的方案</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 最近使用面板 */}
                <AnimatePresence>
                  {showRecentPanel && (
                    <motion.div
                      className={styles.recentPanel}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className={styles.schemePanelHeader}>
                        <span>最近使用</span>
                      </div>
                      {recentUsage.length > 0 ? (
                        <div className={styles.schemeList}>
                          {recentUsage.map((recent, idx) => (
                            <button
                              key={idx}
                              className={styles.recentItem}
                              onClick={() => handleLoadRecent(recent)}
                            >
                              <span className={styles.recentSummary}>
                                市值 {recent.filters.marketCapMin} ~ {recent.filters.marketCapMax ?? '不限'}亿 · 
                                涨幅 {recent.filters.changePercentMin} ~ {recent.filters.changePercentMax ?? '不限'}%
                              </span>
                              <span className={styles.recentTime}>
                                {new Date(recent.usedAt).toLocaleString('zh-CN', {
                                  month: 'numeric',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.emptyHint}>暂无使用记录</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className={styles.filterGrid}>
                  {/* 流通市值 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>流通市值</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <>
                          <NumberField
                            value={filters.marketCapMin}
                            min={0}
                            onCommit={(v) => handleFilterChange('marketCapMin', v ?? 0)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterSeparator}>~</span>
                          <NumberField
                            value={filters.marketCapMax}
                            nullable
                            min={0}
                            placeholder="不限"
                            onCommit={(v) => handleFilterChange('marketCapMax', v)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterUnit}>亿</span>
                        </>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.marketCapMin} ~ {filters.marketCapMax ?? '不限'}
                          <span className={styles.filterUnit}>亿</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 量比 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>量比</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <NumberField
                          value={filters.volumeRatioMin}
                          min={0}
                          step="0.1"
                          onCommit={(v) => handleFilterChange('volumeRatioMin', v ?? 0)}
                          className={styles.filterInput}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className={styles.filterDisplay}>≥ {filters.volumeRatioMin}</span>
                      )}
                    </div>
                  </div>

                  {/* 当日涨幅 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>当日涨幅</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <>
                          <NumberField
                            value={filters.changePercentMin}
                            step="0.5"
                            onCommit={(v) => handleFilterChange('changePercentMin', v ?? 0)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterSeparator}>~</span>
                          <NumberField
                            value={filters.changePercentMax}
                            nullable
                            step="0.5"
                            placeholder="不限"
                            onCommit={(v) => handleFilterChange('changePercentMax', v)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterUnit}>%</span>
                        </>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.changePercentMin} ~ {filters.changePercentMax ?? '不限'}
                          <span className={styles.filterUnit}>%</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 换手率 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>换手率</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <>
                          <NumberField
                            value={filters.turnoverRateMin}
                            min={0}
                            step="0.5"
                            onCommit={(v) => handleFilterChange('turnoverRateMin', v ?? 0)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterSeparator}>~</span>
                          <NumberField
                            value={filters.turnoverRateMax}
                            nullable
                            min={0}
                            step="0.5"
                            placeholder="不限"
                            onCommit={(v) => handleFilterChange('turnoverRateMax', v)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterUnit}>%</span>
                        </>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.turnoverRateMin} ~ {filters.turnoverRateMax ?? '不限'}
                          <span className={styles.filterUnit}>%</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 过滤ST */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>过滤ST股票</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <button
                          className={`${styles.toggleBtn} ${filters.excludeST ? styles.active : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFilterChange('excludeST', !filters.excludeST);
                          }}
                        >
                          {filters.excludeST ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                          <span>{filters.excludeST ? '开启' : '关闭'}</span>
                        </button>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.excludeST ? '开启' : '关闭'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 分时强度 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>分时强度</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <>
                          <NumberField
                            value={filters.timelineAboveAvgRatio}
                            min={0}
                            max={100}
                            step="5"
                            onCommit={(v) => handleFilterChange('timelineAboveAvgRatio', v ?? 0)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterUnit}>%</span>
                        </>
                      ) : (
                        <span className={styles.filterDisplay}>
                          ≥ {filters.timelineAboveAvgRatio}
                          <span className={styles.filterUnit}>%</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* M1 尾盘斜率下限 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel} title="14:30 至收盘涨跌幅下限">尾盘斜率下限</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <>
                          <NumberField
                            value={filters.tail30mSlopeMin}
                            nullable
                            step="0.1"
                            placeholder="不限"
                            onCommit={(v) => handleFilterChange('tail30mSlopeMin', v)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterUnit}>%</span>
                        </>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.tail30mSlopeMin === null ? '不限' : `≥ ${filters.tail30mSlopeMin}%`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* M1 尾盘额占比下限 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel} title="尾盘成交额占全天比例下限">尾盘额占比下限</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <>
                          <NumberField
                            value={filters.tail30mAmountShareMin}
                            nullable
                            min={0}
                            max={100}
                            step="1"
                            placeholder="不限"
                            onCommit={(v) => handleFilterChange('tail30mAmountShareMin', v)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterUnit}>%</span>
                        </>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.tail30mAmountShareMin === null ? '不限' : `≥ ${filters.tail30mAmountShareMin}%`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* M1 日内最大回撤上限 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel} title="(日内最高-最新价)/日内最高，超出则剔除">日内回撤上限</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <>
                          <NumberField
                            value={filters.intradayDrawbackMax}
                            nullable
                            min={0}
                            step="0.5"
                            placeholder="不限"
                            onCommit={(v) => handleFilterChange('intradayDrawbackMax', v)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterUnit}>%</span>
                        </>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.intradayDrawbackMax === null ? '不限' : `≤ ${filters.intradayDrawbackMax}%`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* M1 主力净流入 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>主力净流入为正</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <button
                          className={`${styles.toggleBtn} ${filters.requireMainInflow ? styles.active : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFilterChange('requireMainInflow', !filters.requireMainInflow);
                          }}
                        >
                          {filters.requireMainInflow ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                          <span>{filters.requireMainInflow ? '开启' : '关闭'}</span>
                        </button>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.requireMainInflow ? '开启' : '关闭'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="results-screen"
              className={styles.resultsScreen}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              {/* 结果头部 */}
              <div className={styles.resultsHeader}>
                <motion.div
                  className={styles.resultsSummary}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <Target size={20} />
                  <span className={styles.summaryText}>
                    共筛选出 <strong>{stocks.length}</strong> 只符合条件的股票
                  </span>
                </motion.div>
                <motion.div
                  className={styles.resultsActions}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  {/* M1：批量排雷 + 记录快照 */}
                  {stocks.length > 0 && (
                    <>
                      <button
                        className={styles.vetBtn}
                        onClick={handleRunVetting}
                        disabled={vettingBusy}
                        title="仅风险安检与结构观察，非买入建议"
                      >
                        <Zap size={16} />
                        {vettingBusy ? '校验中…' : '批量排雷与结构校验'}
                      </button>
                      <button className={styles.recordBtn} onClick={handleRecordSnapshot} title="写入仓外参考观察账本">
                        <Save size={16} />
                        记录快照
                      </button>
                    </>
                  )}
                  {/* 批量选择按钮 */}
                  {stocks.length > 0 && (
                    <button
                      className={`${styles.selectModeBtn} ${showSelectMode ? styles.active : ''}`}
                      onClick={() => {
                        setShowSelectMode(!showSelectMode);
                        if (showSelectMode) {
                          setSelectedStocks(new Set());
                        }
                      }}
                    >
                      {showSelectMode ? <X size={16} /> : <CheckSquare size={16} />}
                      {showSelectMode ? '取消' : '批量选'}
                    </button>
                  )}
                  <button
                    className={styles.backButton}
                    onClick={() => {
                      setHasAnalyzed(false);
                      setStocks([]);
                      setShowSelectMode(false);
                      setSelectedStocks(new Set());
                    }}
                  >
                    <ChevronLeft size={18} />
                    重新筛选
                  </button>
                </motion.div>
              </div>

              {/* 排序和批量操作栏 */}
              {stocks.length > 0 && (
                <motion.div
                  className={styles.sortBar}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <div className={styles.sortSection}>
                    <ArrowUpDown size={14} />
                    <span className={styles.sortLabel}>排序：</span>
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.field}
                        className={`${styles.sortOption} ${sortField === option.field ? styles.active : ''}`}
                        onClick={() => handleSortChange(option.field)}
                      >
                        {option.label}
                        {sortField === option.field && (
                          sortOrder === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />
                        )}
                      </button>
                    ))}
                  </div>
                  {showSelectMode && (
                    <div className={styles.batchSection}>
                      <button className={styles.selectAllBtn} onClick={handleSelectAll}>
                        {selectedStocks.size === sortedStocks.length ? '取消全选' : '全选'}
                      </button>
                      <button
                        className={styles.batchAddBtn}
                        onClick={handleBatchAddWatchlist}
                        disabled={selectedStocks.size === 0}
                      >
                        <Plus size={14} />
                        加入自选 ({selectedStocks.size})
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {/* 结果列表 */}
              {sortedStocks.length > 0 ? (
                <motion.div
                  className={styles.stockGrid}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                >
                  {sortedStocks.map((stock, index) => (
                    <StockCard
                      key={stock.code}
                      stock={stock}
                      index={index}
                      inWatchlist={isInWatchlist(stock.routeCode)}
                      onAddWatchlist={handleAddWatchlist}
                      isSelected={selectedStocks.has(stock.code)}
                      onToggleSelect={handleToggleSelect}
                      showSelect={showSelectMode}
                    />
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  className={styles.noResults}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <SearchX size={64} strokeWidth={1} />
                  <p className={styles.noResultsTitle}>没有找到符合条件的股票</p>
                  <p className={styles.noResultsHint}>请尝试调整筛选条件后重新分析</p>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        )}
      </main>

      {/* 加载遮罩 */}
      <AnimatePresence>
        {isLoading && (
          <LoadingOverlay progress={loadingProgress} onCancel={handleCancelAnalysis} />
        )}
      </AnimatePresence>
    </div>
  );
}
