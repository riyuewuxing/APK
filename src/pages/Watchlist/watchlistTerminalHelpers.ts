import type {
  FullQuote,
  HistoryKline,
  TodayTimeline,
  TodayTimelineResponse,
} from 'stock-sdk';
import {
  buildAxisPointerLabel,
  buildCrosshairAxisPointer,
  buildCrosshairGlobalAxisPointer,
  withAlpha,
  type ChartColors,
} from '@/components/charts/chartTheme';
import type { WatchlistLiveMode } from '@/services/storage';
import type { ColumnConfig } from '@/types';
import { formatAmount, formatVolume, normalizeStockCode } from '@/utils/format';

export type AShareSessionState =
  | 'auction'
  | 'morning'
  | 'noon_break'
  | 'afternoon'
  | 'closed';

export type TickFlashDirection = 'up' | 'down';

export type WatchlistSortField =
  | 'default'
  | 'code'
  | 'changePercent'
  | 'price'
  | 'change'
  | 'speed'
  | 'volumeRatio'
  | 'amount'
  | 'turnoverRate'
  | 'amplitude'
  | 'peDynamic'
  | 'totalMarketCap'
  | 'circulatingMarketCap';

export type SortOrder = 'asc' | 'desc';

export interface PriceSamplePoint {
  ts: number;
  price: number;
}

export interface IntradayVolumeBar {
  volumeLots: number;
  isRise: boolean;
}

export interface CompactKlineBar {
  label: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
}

export type KlineWithMaLike = HistoryKline & {
  ma?: Record<string, number | null | undefined>;
};

export interface CompactKlineInput {
  date?: string;
  time?: string;
  open: number | null;
  close: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  ma?: Record<string, number | null | undefined>;
}

export const WATCHLIST_TERMINAL_COLUMNS_KEY = 'watchlist_terminal_v2';

export const DEFAULT_TERMINAL_COLUMNS: ColumnConfig[] = [
  { key: 'index', label: '#', visible: true },
  { key: 'code', label: '代码', visible: true },
  { key: 'name', label: '名称', visible: true },
  { key: 'changePercent', label: '涨幅%', visible: true },
  { key: 'price', label: '现价', visible: true },
  { key: 'change', label: '涨跌', visible: true },
  { key: 'speed', label: '涨速', visible: true },
  { key: 'volumeRatio', label: '量比', visible: true },
  { key: 'amount', label: '成交额', visible: true },
  { key: 'turnoverRate', label: '换手%', visible: true },
  { key: 'amplitude', label: '振幅%', visible: true },
  { key: 'peDynamic', label: '市盈(动)', visible: true },
  { key: 'totalMarketCap', label: '总市值', visible: true },
  { key: 'circulatingMarketCap', label: '流通市值', visible: false },
  { key: 'highLow', label: '最高/最低', visible: false },
];

export function mergeTerminalColumns(stored: ColumnConfig[] | null): ColumnConfig[] {
  if (!stored || stored.length === 0) {
    return DEFAULT_TERMINAL_COLUMNS.map((col) => ({ ...col }));
  }
  return DEFAULT_TERMINAL_COLUMNS.map((col) => {
    const matched = stored.find((item) => item.key === col.key);
    return matched ? { ...col, visible: Boolean(matched.visible) } : { ...col };
  });
}

export function extractBareCode(code: string): string {
  const trimmed = String(code ?? '').trim();
  const m = trimmed.match(/^(?:sh|sz|bj)\.?(\d{6})$/i);
  if (m) return m[1];
  const s = trimmed.match(/^(\d{6})\.(?:sh|sz|bj)$/i);
  if (s) return s[1];
  return trimmed;
}

const SHANGHAI_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * 判定当前北京时间所处的 A 股交易时段，严格隔离主机本地时区。
 */
export function getAShareSessionState(now: Date = new Date()): AShareSessionState {
  const parts = SHANGHAI_FORMATTER.formatToParts(now);
  let weekday = '';
  let hour = 0;
  let minute = 0;

  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value;
    if (part.type === 'hour') hour = Number(part.value);
    if (part.type === 'minute') minute = Number(part.value);
  }

  if (weekday === 'Sat' || weekday === 'Sun') {
    return 'closed';
  }

  const normalizedHour = hour === 24 ? 0 : hour;
  const totalMinutes = normalizedHour * 60 + minute;

  if (totalMinutes >= 9 * 60 + 15 && totalMinutes <= 9 * 60 + 29) {
    return 'auction';
  }
  if (totalMinutes >= 9 * 60 + 30 && totalMinutes <= 11 * 60 + 30) {
    return 'morning';
  }
  if (totalMinutes >= 11 * 60 + 31 && totalMinutes <= 12 * 60 + 59) {
    return 'noon_break';
  }
  if (totalMinutes >= 13 * 60 && totalMinutes <= 15 * 60) {
    return 'afternoon';
  }
  return 'closed';
}

export function isAShareTradingSession(state: AShareSessionState): boolean {
  return state === 'auction' || state === 'morning' || state === 'afternoon';
}

export interface WatchlistPollingPlan {
  enabled: boolean;
  quoteIntervalMs: number;
  timelineIntervalMs: number;
  sessionState: AShareSessionState;
  isTrading: boolean;
  statusLabel: string;
}

export function resolveWatchlistPollingPlan(
  mode: WatchlistLiveMode,
  standardIntervalMs: number,
  now: Date = new Date()
): WatchlistPollingPlan {
  const sessionState = getAShareSessionState(now);
  const isTrading = isAShareTradingSession(sessionState);
  const safeStandard = Math.max(3000, Number.isFinite(standardIntervalMs) ? standardIntervalMs : 15000);

  if (mode === 'paused') {
    return {
      enabled: false,
      quoteIntervalMs: safeStandard,
      timelineIntervalMs: safeStandard,
      sessionState,
      isTrading,
      statusLabel: '⏸ 已暂停',
    };
  }

  if (mode === 'live3s') {
    if (isTrading) {
      return {
        enabled: true,
        quoteIntervalMs: 3000,
        timelineIntervalMs: 5000,
        sessionState,
        isTrading: true,
        statusLabel: sessionState === 'auction' ? '● 盘中实时 3s(竞价)' : '● 盘中实时 3s',
      };
    }
    return {
      enabled: true,
      quoteIntervalMs: 30000,
      timelineIntervalMs: 30000,
      sessionState,
      isTrading: false,
      statusLabel:
        sessionState === 'noon_break'
          ? '○ 午间休市(自动降频30s)'
          : '○ 非交易时段(自动降频30s)',
    };
  }

  return {
    enabled: true,
    quoteIntervalMs: safeStandard,
    timelineIntervalMs: Math.max(5000, safeStandard),
    sessionState,
    isTrading,
    statusLabel: `${isTrading ? '● 盘中' : '○ 非交易时段'} · 标准 ${Math.round(safeStandard / 1000)}s`,
  };
}

/**
 * 对比前后两帧行情价格，输出需要触发红/绿微闪的股票映射（停牌/price=0 不触发）。
 */
export function computeQuoteFlashMap(
  prevQuotes: ReadonlyMap<string, Pick<FullQuote, 'code' | 'price'>>,
  nextQuotes: ReadonlyMap<string, Pick<FullQuote, 'code' | 'price'>>
): Map<string, TickFlashDirection> {
  const flashes = new Map<string, TickFlashDirection>();
  const normalizedPrev = new Map<string, number>();

  prevQuotes.forEach((q, key) => {
    const norm = normalizeStockCode(q.code || key);
    if (norm && Number.isFinite(q.price) && q.price > 0) {
      normalizedPrev.set(norm, q.price);
    }
  });

  nextQuotes.forEach((q, key) => {
    const norm = normalizeStockCode(q.code || key);
    if (!norm || flashes.has(norm)) return;
    if (!Number.isFinite(q.price) || q.price <= 0) return;

    const prevPrice = normalizedPrev.get(norm);
    if (prevPrice === undefined || prevPrice <= 0 || q.price === prevPrice) return;

    flashes.set(norm, q.price > prevPrice ? 'up' : 'down');
  });

  return flashes;
}

/**
 * 更新单只股票的 6 分钟内存滑窗并计算涨速（优先选取最接近 180s 前的样本；跨度 < 30s 严格 fail-closed 返回 null）。
 */
export function updatePriceWindowAndComputeSpeed(
  history: readonly PriceSamplePoint[],
  price: number,
  nowTs: number,
  options?: {
    windowMaxAgeMs?: number;
    minSpanMs?: number;
    targetLookbackMs?: number;
    maxLookbackMs?: number;
  }
): { samples: PriceSamplePoint[]; speedPercent: number | null } {
  const windowMaxAgeMs = options?.windowMaxAgeMs ?? 360_000;
  const minSpanMs = options?.minSpanMs ?? 30_000;
  const targetLookbackMs = options?.targetLookbackMs ?? 180_000;
  const maxLookbackMs = options?.maxLookbackMs ?? 300_000;

  const cutoff = nowTs - windowMaxAgeMs;
  const pruned = history.filter(
    (pt) =>
      Number.isFinite(pt.ts) &&
      Number.isFinite(pt.price) &&
      pt.price > 0 &&
      pt.ts >= cutoff &&
      pt.ts <= nowTs
  );

  const validCurrent = Number.isFinite(price) && price > 0 && Number.isFinite(nowTs);
  const samples = validCurrent
    ? (() => {
      const last = pruned[pruned.length - 1];
      if (last && last.ts === nowTs) {
        return [...pruned.slice(0, -1), { ts: nowTs, price }];
      }
      return [...pruned, { ts: nowTs, price }];
    })()
    : pruned;

  if (!validCurrent) {
    return { samples, speedPercent: null };
  }

  let bestCandidate: PriceSamplePoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAge = -1;

  for (const pt of samples) {
    const age = nowTs - pt.ts;
    if (age < minSpanMs || age > maxLookbackMs || pt.price <= 0) {
      continue;
    }
    const distance = Math.abs(age - targetLookbackMs);
    if (distance < bestDistance || (distance === bestDistance && age > bestAge)) {
      bestCandidate = pt;
      bestDistance = distance;
      bestAge = age;
    }
  }

  if (!bestCandidate) {
    return { samples, speedPercent: null };
  }

  const speedPercent = ((price - bestCandidate.price) / bestCandidate.price) * 100;
  return {
    samples,
    speedPercent: Number.isFinite(speedPercent) ? speedPercent : null,
  };
}

/**
 * stock-sdk 的 TodayTimeline.volume 为累计成交量（股）；
 * 经相邻差分并除以 100 转为单分钟成交量（手），异常回退单调递减值归零防负柱。
 */
export function computeIntradayMinuteVolumes(
  points: readonly Pick<TodayTimeline, 'price' | 'volume'>[],
  prevClose?: number
): IntradayVolumeBar[] {
  return points.map((pt, idx) => {
    const curVol = Number.isFinite(pt.volume) ? pt.volume : 0;
    const prevVol = idx > 0 && Number.isFinite(points[idx - 1]!.volume) ? points[idx - 1]!.volume : 0;
    const deltaShares = idx === 0 ? Math.max(0, curVol) : Math.max(0, curVol - prevVol);

    const refPrice =
      idx === 0
        ? prevClose !== undefined && Number.isFinite(prevClose) && prevClose > 0
          ? prevClose
          : pt.price
        : points[idx - 1]!.price;

    return {
      volumeLots: deltaShares / 100,
      isRise: pt.price >= refPrice,
    };
  });
}

function getNumericSortValue(
  quote: FullQuote,
  field: Exclude<WatchlistSortField, 'default' | 'code'>,
  speedMap?: ReadonlyMap<string, number | null>
): number | null {
  let raw: number | null | undefined;
  switch (field) {
    case 'speed': {
      const norm = normalizeStockCode(quote.code);
      raw = speedMap?.get(norm) ?? speedMap?.get(quote.code) ?? null;
      break;
    }
    case 'peDynamic':
      raw = quote.peDynamic ?? quote.pe;
      break;
    default:
      raw = quote[field];
      break;
  }
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * 自选行情排序器：null / undefined / NaN 始终置底（nulls last）。
 */
export function sortWatchlistQuotes(
  quotes: readonly FullQuote[],
  sortField: WatchlistSortField,
  sortOrder: SortOrder,
  speedMap?: ReadonlyMap<string, number | null>
): FullQuote[] {
  if (sortField === 'default') {
    return [...quotes];
  }

  return [...quotes].sort((a, b) => {
    if (sortField === 'code') {
      const aCode = extractBareCode(a.code);
      const bCode = extractBareCode(b.code);
      if (!aCode && !bCode) return 0;
      if (!aCode) return 1;
      if (!bCode) return -1;
      const cmp = aCode.localeCompare(bCode);
      return sortOrder === 'asc' ? cmp : -cmp;
    }

    const aVal = getNumericSortValue(a, sortField, speedMap);
    const bVal = getNumericSortValue(b, sortField, speedMap);
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
  });
}

export function formatSignedAmountWan(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }
  if (value === 0) {
    return '0.00万';
  }
  const sign = value > 0 ? '+' : '-';
  return `${sign}${formatAmount(Math.abs(value))}`;
}

export function computeSimpleMA(
  values: readonly number[],
  period: number
): Array<number | null> {
  if (period <= 0) return values.map(() => null);
  const out: Array<number | null> = [];
  let rollingSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    rollingSum += values[i]!;
    if (i >= period) {
      rollingSum -= values[i - period]!;
    }
    if (i >= period - 1) {
      out.push(Number((rollingSum / period).toFixed(3)));
    } else {
      out.push(null);
    }
  }
  return out;
}

export function normalizeCompactKlineBars(
  rows: readonly CompactKlineInput[],
  maxBars = 90
): CompactKlineBar[] {
  const sliced = rows.slice(-maxBars);
  if (sliced.length === 0) return [];

  const closes = sliced.map((row) => row.close ?? 0);
  const fallbackMa5 = computeSimpleMA(closes, 5);
  const fallbackMa10 = computeSimpleMA(closes, 10);
  const fallbackMa20 = computeSimpleMA(closes, 20);

  return sliced.map((row, idx) => {
    const label = row.date ?? row.time ?? '';
    const maRecord = row.ma;
    const readMa = (k: 'ma5' | 'ma10' | 'ma20', fallback: number | null) => {
      const v = maRecord?.[k];
      return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    };
    return {
      label,
      open: row.open ?? 0,
      close: row.close ?? 0,
      high: row.high ?? 0,
      low: row.low ?? 0,
      volume: row.volume ?? 0,
      ma5: readMa('ma5', fallbackMa5[idx] ?? null),
      ma10: readMa('ma10', fallbackMa10[idx] ?? null),
      ma20: readMa('ma20', fallbackMa20[idx] ?? null),
    };
  });
}

export function buildCompactTimelineOption(args: {
  timeline: TodayTimelineResponse | null;
  prevClose?: number;
  colors: ChartColors;
}): Record<string, unknown> {
  const { timeline, prevClose, colors } = args;
  const points = timeline?.data ?? [];
  if (points.length === 0) {
    return {};
  }

  const times = points.map((p) => p.time);
  const prices = points.map((p) => p.price);
  const avgPrices = points.map((p) =>
    Number.isFinite(p.avgPrice) && p.avgPrice > 0 ? p.avgPrice : null
  );

  const effectivePrevClose =
    timeline?.preClose && Number.isFinite(timeline.preClose) && timeline.preClose > 0
      ? timeline.preClose
      : prevClose !== undefined && Number.isFinite(prevClose) && prevClose > 0
        ? prevClose
        : prices[0]!;

  const validSamples = [
    ...prices,
    ...avgPrices.filter((v): v is number => v !== null),
  ];
  const minVal = Math.min(...validSamples);
  const maxVal = Math.max(...validSamples);
  const rawDev = Math.max(
    Math.abs(maxVal - effectivePrevClose),
    Math.abs(effectivePrevClose - minVal)
  );
  const minBand = Math.max(effectivePrevClose * 0.005, 0.01);
  const halfRange = Math.max(rawDev * 1.12, minBand);
  const yMin = effectivePrevClose - halfRange;
  const yMax = effectivePrevClose + halfRange;

  const minuteBars = computeIntradayMinuteVolumes(points, effectivePrevClose);
  const volumeSeriesData = minuteBars.map((bar) => ({
    value: bar.volumeLots,
    itemStyle: {
      color: bar.isRise ? colors.rise : colors.fall,
    },
  }));

  return {
    animation: false,
    axisPointer: buildCrosshairGlobalAxisPointer(colors),
    grid: [
      { left: 48, right: 54, top: 10, height: '62%' },
      { left: 48, right: 54, top: '76%', height: '18%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: times,
        boundaryGap: false,
        axisLine: { lineStyle: { color: colors.borderPrimary } },
        axisTick: { show: false },
        axisLabel: { show: false },
        axisPointer: { show: true, label: { show: false } },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: times,
        boundaryGap: true,
        axisLine: { lineStyle: { color: colors.borderPrimary } },
        axisTick: { show: false },
        axisLabel: {
          color: colors.textTertiary,
          fontSize: 10,
          interval: Math.max(0, Math.floor(times.length / 4) - 1),
        },
        axisPointer: buildAxisPointerLabel(colors),
      },
    ],
    yAxis: [
      {
        type: 'value',
        min: yMin,
        max: yMax,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: colors.textTertiary,
          fontSize: 10,
          formatter: (val: number) => val.toFixed(2),
        },
        axisPointer: buildAxisPointerLabel(colors, (p) => Number(p.value).toFixed(2)),
        splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
      },
      {
        type: 'value',
        position: 'right',
        min: yMin,
        max: yMax,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: colors.textTertiary,
          fontSize: 10,
          formatter: (val: number) => {
            if (effectivePrevClose <= 0) return '0.00%';
            const pct = ((val - effectivePrevClose) / effectivePrevClose) * 100;
            const sign = pct > 0.005 ? '+' : '';
            return `${sign}${pct.toFixed(2)}%`;
          },
        },
        axisPointer: buildAxisPointerLabel(colors, (p) => {
          const val = Number(p.value);
          if (effectivePrevClose <= 0 || !Number.isFinite(val)) return '0.00%';
          const pct = ((val - effectivePrevClose) / effectivePrevClose) * 100;
          const sign = pct > 0.005 ? '+' : '';
          return `${sign}${pct.toFixed(2)}%`;
        }),
        splitLine: { show: false },
      },
      {
        type: 'value',
        gridIndex: 1,
        splitNumber: 2,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        axisPointer: { show: false },
        splitLine: { show: false },
      },
    ],
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: buildCrosshairAxisPointer(colors),
      backgroundColor: colors.tooltipBg,
      borderColor: colors.borderPrimary,
      borderWidth: 1,
      textStyle: { color: colors.textPrimary, fontSize: 11 },
      extraCssText:
        'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 6px; box-shadow: 0 10px 24px rgba(0,0,0,0.32);',
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [];
        const first = list[0] as { dataIndex?: number } | undefined;
        const idx = first?.dataIndex ?? -1;
        const pt = points[idx];
        const bar = minuteBars[idx];
        if (!pt) return '';
        const pct =
          effectivePrevClose > 0
            ? ((pt.price - effectivePrevClose) / effectivePrevClose) * 100
            : 0;
        const sign = pct > 0 ? '+' : '';
        return [
          `<b>${pt.time}</b>`,
          `价格: ${pt.price.toFixed(2)} (${sign}${pct.toFixed(2)}%)`,
          `均价: ${pt.avgPrice > 0 ? pt.avgPrice.toFixed(2) : '--'}`,
          `成交: ${bar ? `${formatVolume(Math.round(bar.volumeLots))}手` : '--'}`,
        ].join('<br/>');
      },
    },
    series: [
      {
        name: '分时',
        type: 'line',
        data: prices,
        symbol: 'none',
        lineStyle: { width: 1.6, color: colors.accent },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: withAlpha(colors.accent, 0.24) },
              { offset: 1, color: withAlpha(colors.accent, 0.01) },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: colors.textTertiary, width: 1 },
          label: { show: false },
          data: [{ yAxis: effectivePrevClose }],
        },
      },
      {
        name: '均价',
        type: 'line',
        data: avgPrices,
        symbol: 'none',
        connectNulls: true,
        lineStyle: { width: 1.1, color: '#f59e0b' },
      },
      {
        name: '成交量(手)',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 2,
        data: volumeSeriesData,
      },
    ],
  };
}

export function buildCompactKlineOption(args: {
  bars: readonly CompactKlineBar[];
  colors: ChartColors;
}): Record<string, unknown> {
  const { bars, colors } = args;
  if (bars.length === 0) {
    return {};
  }

  const labels = bars.map((b) => b.label);
  const ohlc = bars.map((b) => [b.open, b.close, b.low, b.high]);
  const volumes = bars.map((b) => ({
    value: b.volume,
    itemStyle: { color: b.close >= b.open ? colors.rise : colors.fall },
  }));
  const zoomStart = bars.length > 50 ? Math.max(0, ((bars.length - 50) / bars.length) * 100) : 0;

  return {
    animation: false,
    axisPointer: buildCrosshairGlobalAxisPointer(colors),
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        start: zoomStart,
        end: 100,
      },
    ],
    grid: [
      { left: 48, right: 14, top: 10, height: '62%' },
      { left: 48, right: 14, top: '76%', height: '18%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: colors.borderPrimary } },
        axisTick: { show: false },
        axisLabel: { show: false },
        axisPointer: { show: true, label: { show: false } },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: labels,
        axisLine: { lineStyle: { color: colors.borderPrimary } },
        axisTick: { show: false },
        axisLabel: {
          color: colors.textTertiary,
          fontSize: 10,
          formatter: (val: string) => (val.length > 10 ? val.slice(5) : val),
        },
        axisPointer: buildAxisPointerLabel(colors),
      },
    ],
    yAxis: [
      {
        type: 'value',
        scale: true,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: colors.textTertiary,
          fontSize: 10,
          formatter: (val: number) => val.toFixed(2),
        },
        axisPointer: buildAxisPointerLabel(colors, (p) => Number(p.value).toFixed(2)),
        splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
      },
      {
        type: 'value',
        gridIndex: 1,
        splitNumber: 2,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        axisPointer: { show: false },
        splitLine: { show: false },
      },
    ],
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: buildCrosshairAxisPointer(colors),
      backgroundColor: colors.tooltipBg,
      borderColor: colors.borderPrimary,
      borderWidth: 1,
      textStyle: { color: colors.textPrimary, fontSize: 11 },
      extraCssText:
        'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 6px; box-shadow: 0 10px 24px rgba(0,0,0,0.32);',
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [];
        const first = list[0] as { dataIndex?: number } | undefined;
        const bar = bars[first?.dataIndex ?? -1];
        if (!bar) return '';
        return [
          `<b>${bar.label}</b>`,
          `开: ${bar.open.toFixed(2)}  收: ${bar.close.toFixed(2)}`,
          `高: ${bar.high.toFixed(2)}  低: ${bar.low.toFixed(2)}`,
          `MA5: ${bar.ma5?.toFixed(2) ?? '--'}  MA10: ${bar.ma10?.toFixed(2) ?? '--'}  MA20: ${bar.ma20?.toFixed(2) ?? '--'}`,
        ].join('<br/>');
      },
    },
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: ohlc,
        itemStyle: {
          color: colors.rise,
          color0: colors.fall,
          borderColor: colors.rise,
          borderColor0: colors.fall,
        },
      },
      {
        name: 'MA5',
        type: 'line',
        data: bars.map((b) => b.ma5),
        symbol: 'none',
        lineStyle: { width: 1, color: '#f59e0b' },
      },
      {
        name: 'MA10',
        type: 'line',
        data: bars.map((b) => b.ma10),
        symbol: 'none',
        lineStyle: { width: 1, color: colors.accent2 },
      },
      {
        name: 'MA20',
        type: 'line',
        data: bars.map((b) => b.ma20),
        symbol: 'none',
        lineStyle: { width: 1, color: '#ec4899' },
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes,
      },
    ],
  };
}
