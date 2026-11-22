import { addIndicators, type FullQuote, type HistoryKline, type TodayTimelineResponse } from 'stock-sdk';
import {
  getAllAShareQuotes,
  getKlineWithIndicators,
  getTodayTimeline,
} from './sdk';
import { fetchGlobalChart } from './globalMarketsApi';
import { detectAssetMarket, normalizeStockCode, parseStockCode, yearsAgoYmd } from '@/utils/format';

export interface AnalysisProgress {
  completed: number;
  total: number;
  stage: string;
}

// 涨跌停幅度按板块区分：创业板/科创板 20%、北交所 30%、主板 ST 5%、其余 10%；
// 创业板/科创板的 ST 仍按 20%，所以先判板块再判 ST
const LIMIT_TOLERANCE = 0.2;

export function getLimitPercent(code: string, name: string): number {
  const { symbol } = parseStockCode(code);
  if (/^(300|301|688|689)/.test(symbol)) return 20;
  if (/^(4|8|92)/.test(symbol)) return 30;
  if (name.includes('ST')) return 5;
  return 10;
}

export function isLimitUp(
  quote: Pick<FullQuote, 'code' | 'name'> & { changePercent: number | null }
): boolean {
  if (quote.changePercent === null) return false;
  return quote.changePercent >= getLimitPercent(quote.code, quote.name) - LIMIT_TOLERANCE;
}

export function isLimitDown(
  quote: Pick<FullQuote, 'code' | 'name'> & { changePercent: number | null }
): boolean {
  if (quote.changePercent === null) return false;
  return quote.changePercent <= -(getLimitPercent(quote.code, quote.name) - LIMIT_TOLERANCE);
}

export interface TimelinePoint {
  time: string;
  price: number;
  avgPrice: number;
  /** 当日累计成交额（元），后端尾盘额占比计算用；旧数据可能缺省 */
  amount?: number;
}

export interface EndOfDayFilters {
  marketCapMin: number;
  /** null = 不设上限 */
  marketCapMax: number | null;
  volumeRatioMin: number;
  changePercentMin: number;
  changePercentMax: number | null;
  turnoverRateMin: number;
  turnoverRateMax: number | null;
  excludeST: boolean;
  timelineAboveAvgRatio: number;
  /** M1 尾盘 2.0：尾盘 30 分钟涨跌幅下限（null = 不限，建议 0.3） */
  tail30mSlopeMin: number | null;
  /** 尾盘成交额占全天比例下限（null = 不限） */
  tail30mAmountShareMin: number | null;
  /** 日内最大回撤上限（默认 3.0%） */
  intradayDrawbackMax: number | null;
  /** 仅保留主力净流入为正 */
  requireMainInflow: boolean;
}

export interface EndOfDayStock {
  code: string;
  routeCode: string;
  name: string;
  price: number;
  changePercent: number;
  change: number;
  volume: number;
  amount: number;
  turnoverRate: number | null;
  volumeRatio: number | null;
  circulatingMarketCap: number | null;
  totalMarketCap: number | null;
  pe: number | null;
  pb: number | null;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  timeline?: TimelinePoint[];
  timelineAboveAvgRatio?: number;
  /** M1 尾盘 2.0：后端结构校验后回填 */
  tail30mReturnPct?: number | null;
  tail30mAmountSharePct?: number | null;
  chipProfitRatioApprox?: number | null;
  mainNetInflow10k?: number | null;
  vettingStatus?: string;
  vettingFlags?: string[];
}

export type ScannerSignalKey =
  | 'ma_golden'
  | 'ma_death'
  | 'macd_golden'
  | 'macd_death'
  | 'rsi_oversold'
  | 'rsi_overbought'
  | 'boll_upper'
  | 'boll_lower';

export interface ScannerStockPoolItem {
  code: string;
  routeCode: string;
  name: string;
}

export interface ScannerSignalResult {
  code: string;
  routeCode: string;
  name: string;
  matchedSignals: string[];
}

const DEFAULT_SCAN_CONCURRENCY = 4;
const ABORT_ERROR_CODE = 'ANALYSIS_ABORTED';

class AnalysisAbortError extends Error {
  code = ABORT_ERROR_CODE;

  constructor() {
    super('Analysis aborted');
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new AnalysisAbortError();
  }
}

export function isAnalysisAborted(error: unknown): boolean {
  return error instanceof AnalysisAbortError;
}

function toRouteCode(code: string): string {
  const normalized = normalizeStockCode(code);
  return normalized || code;
}

function toDisplayCode(code: string): string {
  const normalized = toRouteCode(code);
  return parseStockCode(normalized).symbol || normalized;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  options?: {
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<R[]> {
  const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_SCAN_CONCURRENCY);
  const results: R[] = [];
  let cursor = 0;
  let completed = 0;

  const worker = async () => {
    while (true) {
      throwIfAborted(options?.signal);

      const currentIndex = cursor;
      cursor += 1;

      if (currentIndex >= items.length) {
        return;
      }

      const result = await mapper(items[currentIndex], currentIndex);

      throwIfAborted(options?.signal);
      results.push(result);
      completed += 1;
      options?.onProgress?.(completed, items.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );

  return results;
}

export function calculateTimelineStrength(
  timeline: TodayTimelineResponse
): { ratio: number; points: TimelinePoint[] } {
  if (!timeline.data || timeline.data.length === 0) {
    return { ratio: 0, points: [] };
  }

  const points: TimelinePoint[] = timeline.data.map((item) => ({
    time: item.time,
    price: item.price,
    avgPrice: item.avgPrice,
    amount: item.amount,
  }));

  const aboveAvgCount = points.filter((point) => point.price >= point.avgPrice).length;
  return {
    ratio: (aboveAvgCount / points.length) * 100,
    points,
  };
}

export interface TimelineStructure {
  tail30mReturnPct: number | null;
  tail30mAmountSharePct: number | null;
  intradayDrawbackPct: number | null;
}

/**
 * 前端结构因子快照（与后端 eod_engine 同口径），用于"前结构校验"。
 * - tail30mReturnPct：14:30 首价 -> 最新价
 * - tail30mAmountSharePct：(期末累计额 - 14:30 前最后一笔累计额)/期末累计额（amount 为累计额，按差分）
 * - intradayDrawbackPct：(日内最高 - 最新)/日内最高
 * 数据缺失一律 null（fail-closed，不合成）。
 */
export function computeTimelineStructure(points: TimelinePoint[]): TimelineStructure {
  if (!points.length) {
    return { tail30mReturnPct: null, tail30mAmountSharePct: null, intradayDrawbackPct: null };
  }
  const ordered = [...points].sort((a, b) => a.time.localeCompare(b.time));
  const hhmm = (t: string) => t.slice(-5);

  const tailPrices = ordered.filter((p) => hhmm(p.time) >= '14:30').map((p) => p.price);
  const lastPrice = ordered[ordered.length - 1].price;
  const tail30mReturnPct = tailPrices.length && tailPrices[0] > 0
    ? ((lastPrice - tailPrices[0]) / tailPrices[0]) * 100
    : null;

  const highPrice = ordered.reduce((max, p) => Math.max(max, p.price), -Infinity);
  const intradayDrawbackPct = Number.isFinite(highPrice) && highPrice > 0
    ? ((highPrice - lastPrice) / highPrice) * 100
    : null;

  const cumulative = ordered.filter((p) => typeof p.amount === 'number' && Number.isFinite(p.amount));
  let tail30mAmountSharePct: number | null = null;
  if (cumulative.length) {
    const finalCum = cumulative[cumulative.length - 1].amount as number;
    const preTail = cumulative.filter((p) => hhmm(p.time) < '14:30');
    if (finalCum > 0 && preTail.length) {
      const baseline = preTail[preTail.length - 1].amount as number;
      const increment = finalCum - baseline;
      if (increment >= 0) tail30mAmountSharePct = (increment / finalCum) * 100;
    }
  }
  return { tail30mReturnPct, tail30mAmountSharePct, intradayDrawbackPct };
}

/**
 * 前结构校验：应用 M1 新滤网。返回 null 表示被过滤掉。
 * - tail30mSlopeMin / tail30mAmountShareMin / intradayDrawbackMax：数据缺失时按 fail-closed 剔除。
 * - requireMainInflow：前端无主力资金源，不在此判定，交由后端结构校验（analyze-vetting）回填后联动。
 */
export function applyEodStructureFilters(
  stock: EndOfDayStock,
  filters: EndOfDayFilters,
  structure: TimelineStructure
): EndOfDayStock | null {
  if (filters.tail30mSlopeMin !== null) {
    if (structure.tail30mReturnPct === null || structure.tail30mReturnPct < filters.tail30mSlopeMin) return null;
  }
  if (filters.tail30mAmountShareMin !== null) {
    if (structure.tail30mAmountSharePct === null || structure.tail30mAmountSharePct < filters.tail30mAmountShareMin) return null;
  }
  if (filters.intradayDrawbackMax !== null) {
    if (structure.intradayDrawbackPct === null || structure.intradayDrawbackPct > filters.intradayDrawbackMax) return null;
  }
  return {
    ...stock,
    tail30mReturnPct: structure.tail30mReturnPct,
    tail30mAmountSharePct: structure.tail30mAmountSharePct,
  };
}

/**
 * 后结构校验：后端 analyze-vetting 回填后，联动应用 requireMainInflow 滤网。
 * 主力净流入字段缺失时 fail-closed 剔除；未开启该滤网则原样通过。
 */
export function applyBackendVettingFilter(
  stock: EndOfDayStock & { mainNetInflow10k?: number | null },
  filters: EndOfDayFilters
): boolean {
  if (!filters.requireMainInflow) return true;
  return typeof stock.mainNetInflow10k === 'number' && stock.mainNetInflow10k > 0;
}

function filterBasicQuotes(quotes: FullQuote[], filters: EndOfDayFilters): EndOfDayStock[] {
  return quotes
    .filter((quote) => {
      const marketCap = quote.circulatingMarketCap;
      const volumeRatio = quote.volumeRatio;
      const changePercent = quote.changePercent;
      const turnoverRate = quote.turnoverRate;

      if (filters.excludeST && (quote.name.includes('ST') || quote.name.includes('*ST'))) {
        return false;
      }

      if (
        marketCap === null ||
        marketCap < filters.marketCapMin ||
        (filters.marketCapMax !== null && marketCap > filters.marketCapMax)
      ) {
        return false;
      }

      if (volumeRatio === null || volumeRatio < filters.volumeRatioMin) {
        return false;
      }

      if (
        changePercent < filters.changePercentMin ||
        (filters.changePercentMax !== null && changePercent > filters.changePercentMax)
      ) {
        return false;
      }

      if (
        turnoverRate === null ||
        turnoverRate < filters.turnoverRateMin ||
        (filters.turnoverRateMax !== null && turnoverRate > filters.turnoverRateMax)
      ) {
        return false;
      }

      return true;
    })
    .map((quote) => ({
      code: toDisplayCode(quote.code),
      routeCode: toRouteCode(quote.code),
      name: quote.name,
      price: quote.price,
      changePercent: quote.changePercent,
      change: quote.change,
      volume: quote.volume,
      amount: quote.amount,
      turnoverRate: quote.turnoverRate,
      volumeRatio: quote.volumeRatio,
      circulatingMarketCap: quote.circulatingMarketCap,
      totalMarketCap: quote.totalMarketCap,
      pe: quote.pe,
      pb: quote.pb,
      high: quote.high,
      low: quote.low,
      open: quote.open,
      prevClose: quote.prevClose,
    }))
    .sort((a, b) => b.changePercent - a.changePercent);
}

function detectSignals(
  klineData: Array<{
    ma?: Record<string, number>;
    macd?: { dif?: number; dea?: number; macd?: number };
    rsi?: { rsi6?: number; rsi12?: number };
    boll?: { upper?: number; lower?: number };
    close: number;
  }>,
  signals: ScannerSignalKey[]
) {
  const detected: string[] = [];

  if (klineData.length < 3) {
    return detected;
  }

  const latest = klineData[klineData.length - 1];
  const prev = klineData[klineData.length - 2];

  if (signals.includes('ma_golden') && latest.ma && prev.ma) {
    if (latest.ma.ma5 > latest.ma.ma10 && prev.ma.ma5 <= prev.ma.ma10) {
      detected.push('MA金叉');
    }
  }

  if (signals.includes('ma_death') && latest.ma && prev.ma) {
    if (latest.ma.ma5 < latest.ma.ma10 && prev.ma.ma5 >= prev.ma.ma10) {
      detected.push('MA死叉');
    }
  }

  if (signals.includes('macd_golden') && latest.macd && prev.macd) {
    if ((latest.macd.dif ?? 0) > (latest.macd.dea ?? 0) && (prev.macd.dif ?? 0) <= (prev.macd.dea ?? 0)) {
      detected.push('MACD金叉');
    }
  }

  if (signals.includes('macd_death') && latest.macd && prev.macd) {
    if ((latest.macd.dif ?? 0) < (latest.macd.dea ?? 0) && (prev.macd.dif ?? 0) >= (prev.macd.dea ?? 0)) {
      detected.push('MACD死叉');
    }
  }

  if (signals.includes('rsi_oversold') && latest.rsi) {
    if ((latest.rsi.rsi6 ?? Infinity) < 30 || (latest.rsi.rsi12 ?? Infinity) < 30) {
      detected.push('RSI超卖');
    }
  }

  if (signals.includes('rsi_overbought') && latest.rsi) {
    if ((latest.rsi.rsi6 ?? -Infinity) > 70 || (latest.rsi.rsi12 ?? -Infinity) > 70) {
      detected.push('RSI超买');
    }
  }

  if (signals.includes('boll_upper') && latest.boll) {
    if (latest.close > (latest.boll.upper ?? Infinity)) {
      detected.push('BOLL突破上轨');
    }
  }

  if (signals.includes('boll_lower') && latest.boll) {
    if (latest.close < (latest.boll.lower ?? -Infinity)) {
      detected.push('BOLL跌破下轨');
    }
  }

  return detected;
}

export async function analyzeEndOfDayStocks(
  filters: EndOfDayFilters,
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: AnalysisProgress) => void;
    timelineConcurrency?: number;
  }
) {
  options?.onProgress?.({
    completed: 0,
    total: 0,
    stage: '获取行情数据',
  });

  const quotes = await getAllAShareQuotes({
    batchSize: 500,
    concurrency: 4,
    onProgress: (completed, total) => {
      options?.onProgress?.({
        completed,
        total,
        stage: '获取行情数据',
      });
    },
  });

  throwIfAborted(options?.signal);

  const basicStocks = filterBasicQuotes(quotes, filters);

  if (basicStocks.length === 0) {
    return [];
  }

  options?.onProgress?.({
    completed: 0,
    total: basicStocks.length,
    stage: '分时结构筛选',
  });

  const results = await mapWithConcurrency(
    basicStocks,
    async (stock) => {
      const timeline = await getTodayTimeline(stock.routeCode);
      const { ratio, points } = calculateTimelineStrength(timeline);

      if (ratio < filters.timelineAboveAvgRatio) {
        return null;
      }

      const enriched: EndOfDayStock = {
        ...stock,
        timeline: points,
        timelineAboveAvgRatio: ratio,
      };

      // M1 前结构校验：累计差分尾盘额占比 / 尾盘斜率 / 日内回撤
      const structure = computeTimelineStructure(points);
      return applyEodStructureFilters(enriched, filters, structure);
    },
    {
      concurrency: options?.timelineConcurrency ?? DEFAULT_SCAN_CONCURRENCY,
      signal: options?.signal,
      onProgress: (completed, total) => {
        options?.onProgress?.({
          completed,
          total,
          stage: '分时结构筛选',
        });
      },
    }
  );

  return results
    .filter((item): item is EndOfDayStock => !!item)
    .sort((a, b) => (b.timelineAboveAvgRatio ?? 0) - (a.timelineAboveAvgRatio ?? 0));
}

export async function scanSignalPool(
  pool: ScannerStockPoolItem[],
  signals: ScannerSignalKey[],
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: AnalysisProgress) => void;
    onResult?: (result: ScannerSignalResult) => void;
    concurrency?: number;
  }
) {
  if (pool.length === 0 || signals.length === 0) {
    return [];
  }

  const indicators = {
    ma: signals.some((signal) => signal.startsWith('ma_')),
    macd: signals.some((signal) => signal.startsWith('macd_')),
    rsi: signals.some((signal) => signal.startsWith('rsi_')),
    boll: signals.some((signal) => signal.startsWith('boll_')),
  };

  const startDate = yearsAgoYmd(1);

  const results = await mapWithConcurrency(
    pool,
    async (stock) => {
      const klineData =
        detectAssetMarket(stock.routeCode) !== 'cn'
          ? await fetchGlobalChart(stock.routeCode, 'daily', options?.signal).then((gc) => {
              const baseBars = (gc.bars ?? []).map((b) => ({
                date: b.date,
                open: b.open,
                close: b.close,
                high: b.high,
                low: b.low,
                volume: b.volume,
                amount: b.close * b.volume,
              })) as HistoryKline[];
              return addIndicators(baseBars, indicators);
            })
          : await getKlineWithIndicators(stock.routeCode, {
              period: 'daily',
              adjust: 'qfq',
              startDate,
              indicators,
            });

      const matchedSignals = detectSignals(
        klineData as Array<{
          ma?: Record<string, number>;
          macd?: { dif?: number; dea?: number; macd?: number };
          rsi?: { rsi6?: number; rsi12?: number };
          boll?: { upper?: number; lower?: number };
          close: number;
        }>,
        signals
      );

      if (matchedSignals.length === 0) {
        return null;
      }

      const result: ScannerSignalResult = {
        code: stock.code,
        routeCode: stock.routeCode,
        name: stock.name,
        matchedSignals,
      };

      options?.onResult?.(result);
      return result;
    },
    {
      concurrency: options?.concurrency ?? DEFAULT_SCAN_CONCURRENCY,
      signal: options?.signal,
      onProgress: (completed, total) => {
        options?.onProgress?.({
          completed,
          total,
          stage: '技术信号扫描',
        });
      },
    }
  );

  return results.filter((item): item is ScannerSignalResult => !!item);
}
