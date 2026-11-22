/**
 * Stock SDK 服务层
 * 封装 SDK 调用，提供缓存与错误处理
 *
 * 单位契约：经本层出口的金额字段统一为——市值:亿元、成交额/资金流:万元。
 * 东财板块接口原样透传 f20/f6（单位:元），在本层归一；腾讯 FullQuote.amount(万)、
 * totalMarketCap(亿)、fundFlow(万) 原生即符合契约，直接透传。页面不得再自行换算。
 */

import { StockSDK, addIndicators } from 'stock-sdk';
import { MemoryCache } from 'stock-sdk/cache';
import type {
  ConceptBoard,
  ConceptBoardConstituent,
  ConceptBoardKline,
  ConceptBoardSpot,
  DividendDetail,
  FundFlow,
  FundFlowRankItem,
  HistoryKline,
  IndustryBoard,
  IndustryBoardConstituent,
  IndustryBoardKline,
  IndustryBoardSpot,
  MarketFundFlow,
  SearchResult as SDKSearchResult,
  SectorFundFlowItem,
  StockFundFlowDaily,
} from 'stock-sdk';
import { detectAssetMarket, normalizeStockCode } from '@/utils/format';
import { apiFetch, shouldUseRemoteDualChannel } from './apiClient';

export type SearchEntityType = 'stock' | 'industry' | 'concept' | 'unsupported';

export interface AppSearchResult extends SDKSearchResult {
  entityType: SearchEntityType;
  isSupported: boolean;
  route: string | null;
  typeLabel: string;
}

const SEARCH_CATEGORY_LABELS: Record<string, string> = {
  stock: '股票',
  index: '指数',
  fund: '基金',
  bond: '债券',
  futures: '期货',
  option: '期权',
  other: '其他',
};

export function getSearchTypeLabel(item: Pick<SDKSearchResult, 'type' | 'category'>): string {
  return SEARCH_CATEGORY_LABELS[item.category ?? ''] ?? item.type;
}

export function normalizeBoardCode(code: string): string {
  let cur = String(code ?? '').trim();
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(cur);
      if (next === cur) break;
      cur = next;
    } catch {
      break;
    }
  }
  return cur;
}

export function buildBoardRoute(type: 'industry' | 'concept', code: string): string {
  return `/boards/${type}/${encodeURIComponent(normalizeBoardCode(code))}`;
}

/**
 * 统一的搜索实体路由解析：搜索结果与历史记录共用，避免两处映射漂移。
 * '行业板块'/'概念板块' 分支仅为兼容旧版本存下的搜索历史（SDK v2 搜索不再返回板块实体）。
 */
export function resolveSearchRoute(item: {
  code: string;
  market?: string;
  type?: string;
}): { entityType: SearchEntityType; route: string | null } {
  if (item.type === '行业板块') {
    return { entityType: 'industry', route: buildBoardRoute('industry', item.code) };
  }
  if (item.type === '概念板块') {
    return { entityType: 'concept', route: buildBoardRoute('concept', item.code) };
  }

  const normalizedCode = normalizeStockCode(item.code);
  if (detectAssetMarket(normalizedCode) !== 'cn') {
    return { entityType: 'stock', route: `/s/${normalizedCode}` };
  }
  if (
    item.market &&
    ['sh', 'sz', 'bj'].includes(item.market.toLowerCase()) &&
    /^(sh|sz|bj)\d{6}$/i.test(normalizedCode)
  ) {
    return { entityType: 'stock', route: `/s/${normalizedCode}` };
  }

  return { entityType: 'unsupported', route: null };
}

// SDK 单例
export const sdk = new StockSDK({
  timeout: 30000,
  retry: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  },
  rateLimit: {
    requestsPerSecond: 4,
    maxBurst: 8,
  },
  circuitBreaker: {
    failureThreshold: 8,
    resetTimeout: 30000,
    halfOpenRequests: 1,
  },
});

// 内存缓存
const cache = new MemoryCache<unknown>({ maxSize: 300 });
let backendMarketApiDetected: boolean | null = null;

export function clearSdkCache(): void {
  cache.clear();
  backendMarketApiDetected = null;
}

// 默认 TTL 配置（毫秒）
// 优化：增加缓存时间以减少 API 请求频率
const DEFAULT_TTL = {
  boardList: 60000, // 板块列表 60s（从 30s 增加）
  constituents: 180000, // 成分股 3min（从 2min 增加）
  historyKline: 600000, // 历史 K 线 10min
  indicatorKline: 600000, // 指标 K 线 10min
  quotes: 2500, // 实时行情 2.5s（支持 3s 实时盯盘）
  fundFlow: 30000, // 资金流 30s（从 10s 增加）
  timeline: 2500, // 分时 2.5s（支持 5s 实时刷新）
  dividends: 21600000, // 分红数据 6h
  capitalHistory: 30000, // 资金流历史 30s
  northbound: 30000, // 北向资金 30s
  stockChanges: 15000, // 异动池 15s
  boardChanges: 30000, // 板块异动 30s
  dragonTiger: 3600000, // 龙虎榜 1h
  blockTrade: 3600000, // 大宗交易 1h
  margin: 21600000, // 融资融券 6h
  marketSnapshot: 60000, // 全市场快照 60s（约 10+ 请求/次，Dashboard/Scanner/analysis 共享）
};

function normalizeSearchResult(item: SDKSearchResult): AppSearchResult {
  const typeLabel = getSearchTypeLabel(item);
  // 详情页只接入了 A 股股票/指数；基金、债券等 category 一律标记不支持
  const categorySupported =
    item.category === undefined || ['stock', 'index'].includes(item.category);
  const { entityType, route } = categorySupported
    ? resolveSearchRoute(item)
    : { entityType: 'unsupported' as const, route: null };

  if (entityType === 'stock' && route) {
    return {
      ...item,
      code: normalizeStockCode(item.code),
      entityType,
      isSupported: true,
      route,
      typeLabel,
    };
  }

  return {
    ...item,
    entityType: 'unsupported',
    isSupported: false,
    route: null,
    typeLabel,
  };
}

/**
 * 生成缓存键
 */
function getCacheKey(method: string, ...args: unknown[]): string {
  return `${method}:${JSON.stringify(args)}`;
}

/**
 * 带缓存的 SDK 调用包装器
 */
function withCache<T>(
  key: string,
  ttl: number,
  fetcher: () => Promise<T>
): Promise<T> {
  return cache.getOrFetch(key, fetcher, ttl) as Promise<T>;
}

// ========== 实时行情 API ==========

/**
 * 获取完整行情（A股/指数）
 */
export async function getFullQuotes(codes: string[], useCache = true) {
  const key = getCacheKey('getFullQuotes', codes);
  if (useCache) {
    return withCache(key, DEFAULT_TTL.quotes, () => sdk.quotes.cn(codes));
  }
  return sdk.quotes.cn(codes);
}

/**
 * 批量获取行情
 */
export async function getAllQuotesByCodes(
  codes: string[],
  options?: {
    batchSize?: number;
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  }
) {
  return sdk.batch.byCodes(codes, options);
}

/**
 * 获取全部 A 股行情（60s 快照缓存；缓存命中时 onProgress 不会触发）
 */
export async function getAllAShareQuotes(options?: {
  batchSize?: number;
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
}) {
  const key = getCacheKey('getAllAShareQuotes', options?.batchSize, options?.concurrency);
  return withCache(key, DEFAULT_TTL.marketSnapshot, () => sdk.batch.cn(options));
}

// ========== K 线数据 API ==========

async function fetchStockKlineFromBackend(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    startDate?: string;
    endDate?: string;
  }
): Promise<HistoryKline[] | null> {
  const qs = new URLSearchParams();
  if (options?.period) qs.set('period', options.period);
  if (options?.adjust !== undefined) qs.set('adjust', options.adjust);
  if (options?.startDate) qs.set('startDate', options.startDate);
  if (options?.endDate) qs.set('endDate', options.endDate);
  const query = qs.toString();
  const path = `/api/market/stocks/${encodeURIComponent(symbol)}/kline${query ? `?${query}` : ''}`;
  const { data } = await fetchBackendMarketRaw<{ items?: HistoryKline[] }>(path);
  return Array.isArray(data?.items) && data.items.length > 0 ? data.items : null;
}

/**
 * 获取历史 K 线
 */
export async function getHistoryKline(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    startDate?: string;
    endDate?: string;
  }
) {
  const key = getCacheKey('getHistoryKline', symbol, options);
  return withCache(key, DEFAULT_TTL.historyKline, async () => {
    try {
      return await sdk.kline.cn(symbol, options);
    } catch (err) {
      const backup = await fetchStockKlineFromBackend(symbol, options);
      if (backup) return backup;
      throw err;
    }
  });
}

/**
 * 获取带指标的 K 线
 */
export async function getKlineWithIndicators(
  symbol: string,
  options?: Parameters<typeof sdk.kline.withIndicators>[1]
) {
  const key = getCacheKey('getKlineWithIndicators', symbol, options);
  return withCache(key, DEFAULT_TTL.indicatorKline, async () => {
    try {
      return await sdk.kline.withIndicators(symbol, options);
    } catch (err) {
      const backup = await fetchStockKlineFromBackend(symbol, options);
      if (backup) {
        return addIndicators(backup, options?.indicators);
      }
      throw err;
    }
  });
}

/**
 * 获取分钟 K 线
 */
export async function getMinuteKline(
  symbol: string,
  options?: {
    period?: '1' | '5' | '15' | '30' | '60';
    adjust?: '' | 'qfq' | 'hfq';
    startDate?: string;
    endDate?: string;
  }
) {
  return sdk.kline.cnMinute(symbol, options);
}

/**
 * 获取当日分时（默认穿透缓存拉取最新分钟点；可选启用 2.5s 短缓存）
 */
export async function getTodayTimeline(code: string, useCache = false) {
  if (useCache) {
    const key = getCacheKey('getTodayTimeline', code);
    return withCache(key, DEFAULT_TTL.timeline, () => sdk.quotes.timeline(code));
  }
  return sdk.quotes.timeline(code);
}

// ========== 板块 API ==========

// 后端零Key市场数据代理优先读取；若本地后端已在线则不再向不可达的东财 push2 域名发起浏览器回退请求
async function fetchBackendMarketRaw<T>(url: string): Promise<{
  data: T | null;
  allowFallback: boolean;
}> {
  if (typeof fetch !== 'function') {
    return { data: null, allowFallback: true };
  }
  let aborted = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) {
      timer = setTimeout(() => {
        aborted = true;
        controller.abort();
      }, 45000);
    }
    const resp = shouldUseRemoteDualChannel()
      ? (await apiFetch(url, controller ? { signal: controller.signal } : undefined)).response
      : await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (resp.ok) {
      backendMarketApiDetected = true;
      return { data: (await resp.json()) as T, allowFallback: false };
    }
    if (resp.status === 404) {
      return { data: null, allowFallback: backendMarketApiDetected !== true };
    }
    backendMarketApiDetected = true;
    return { data: null, allowFallback: false };
  } catch (err) {
    if (timer) clearTimeout(timer);
    const isAbort = aborted || (err instanceof Error && err.name === 'AbortError');
    if (isAbort || backendMarketApiDetected === true) {
      return { data: null, allowFallback: false };
    }
    return { data: null, allowFallback: true };
  }
}

async function fetchBackendMarketJson<T>(url: string): Promise<T | null> {
  const { data } = await fetchBackendMarketRaw<T>(url);
  return data;
}

async function fetchBackendMarketItems<T>(
  url: string,
  fallback: () => Promise<T>
): Promise<T> {
  const { data, allowFallback } = await fetchBackendMarketRaw<{ items?: T }>(url);
  if (Array.isArray(data?.items)) {
    return data.items;
  }
  if (!allowFallback) {
    return [] as unknown as T;
  }
  return fallback();
}

export interface BoardKlineWithMetaResult {
  items: (IndustryBoardKline | ConceptBoardKline)[];
  klineSource: string | null;
  klineSourceLabel: string | null;
  sampledConstituents: number | null;
}

export interface BoardSummaryMeta {
  rank?: number;
  name?: string;
  code?: string;
  price?: number | null;
  priceScale?: 'index' | 'avg_price' | string | null;
  priceLabel?: string | null;
  change?: number | null;
  changePercent?: number | null;
  totalMarketCap?: number | null;
  turnoverRate?: number | null;
  riseCount?: number | null;
  fallCount?: number | null;
  leadingStock?: string | null;
  leadingStockCode?: string | null;
  leadingStockChangePercent?: number | null;
  amount?: number | null;
  netInflowYi?: number | null;
  constituentCount?: number | null;
  loadedConstituentCount?: number | null;
  source?: string;
  derivedFields?: Record<string, string>;
}

export interface BoardSummaryResult {
  meta: BoardSummaryMeta | null;
  spot: (IndustryBoardSpot | ConceptBoardSpot)[];
}

export interface BoardPeriodFlowItem {
  period: string;
  label: string;
  netInflowYi: number | null;
  inflowYi: number | null;
  outflowYi: number | null;
  changePercent: number | null;
}

export interface BoardFundFlowDailyItem {
  date: string;
  mainNetInflow: number;
  mainNetInflowPercent: number | null;
  superLargeNetInflow: number | null;
  largeNetInflow?: number | null;
  mediumNetInflow?: number | null;
  smallNetInflow: number | null;
}

export interface BoardFundFlowResult {
  periods: BoardPeriodFlowItem[];
  dailyHistory: BoardFundFlowDailyItem[];
  flowSource: string;
  flowSourceLabel: string;
  sampledConstituents: number;
}

// 东财板块口径归一：f20(元)→亿、f6(元)→万，对齐本层单位契约
function normalizeBoardUnits<T extends { totalMarketCap: number | null }>(board: T): T {
  return {
    ...board,
    totalMarketCap:
      board.totalMarketCap === null ? null : board.totalMarketCap / 1e8,
  };
}

function normalizeConstituentUnits<T extends { amount: number | null }>(row: T): T {
  return {
    ...row,
    amount: row.amount === null ? null : row.amount / 1e4,
  };
}

/**
 * 获取行业板块列表
 */
export async function getIndustryList() {
  const key = getCacheKey('getIndustryList');
  return withCache(key, DEFAULT_TTL.boardList, async () =>
    fetchBackendMarketItems<IndustryBoard[]>('/api/market/boards/industry', async () =>
      (await sdk.board.industry.list()).map(normalizeBoardUnits)
    )
  );
}

/**
 * 获取概念板块列表
 */
export async function getConceptList() {
  const key = getCacheKey('getConceptList');
  return withCache(key, DEFAULT_TTL.boardList, async () =>
    fetchBackendMarketItems<ConceptBoard[]>('/api/market/boards/concept', async () =>
      (await sdk.board.concept.list()).map(normalizeBoardUnits)
    )
  );
}

/**
 * 获取行业成分股
 */
export async function getIndustryConstituents(symbol: string) {
  const normalized = normalizeBoardCode(symbol);
  const key = getCacheKey('getIndustryConstituents', normalized);
  return withCache(key, DEFAULT_TTL.constituents, async () =>
    fetchBackendMarketItems<IndustryBoardConstituent[]>(
      `/api/market/boards/industry/${encodeURIComponent(normalized)}/constituents`,
      async () => (await sdk.board.industry.constituents(normalized)).map(normalizeConstituentUnits)
    )
  );
}

/**
 * 获取概念成分股
 */
export async function getConceptConstituents(symbol: string) {
  const normalized = normalizeBoardCode(symbol);
  const key = getCacheKey('getConceptConstituents', normalized);
  return withCache(key, DEFAULT_TTL.constituents, async () =>
    fetchBackendMarketItems<ConceptBoardConstituent[]>(
      `/api/market/boards/concept/${encodeURIComponent(normalized)}/constituents`,
      async () => (await sdk.board.concept.constituents(normalized)).map(normalizeConstituentUnits)
    )
  );
}

/**
 * 获取行业 K 线
 */
export async function getIndustryKline(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    startDate?: string;
    endDate?: string;
  }
) {
  const normalized = normalizeBoardCode(symbol);
  const key = getCacheKey('getIndustryKline', normalized, options);
  const period = options?.period ?? 'daily';
  return withCache(key, DEFAULT_TTL.historyKline, () =>
    fetchBackendMarketItems<IndustryBoardKline[]>(
      `/api/market/boards/industry/${encodeURIComponent(normalized)}/kline?period=${encodeURIComponent(period)}`,
      () => sdk.board.industry.kline(normalized, options)
    )
  );
}

/**
 * 获取概念 K 线
 */
export async function getConceptKline(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    startDate?: string;
    endDate?: string;
  }
) {
  const normalized = normalizeBoardCode(symbol);
  const key = getCacheKey('getConceptKline', normalized, options);
  const period = options?.period ?? 'daily';
  return withCache(key, DEFAULT_TTL.historyKline, () =>
    fetchBackendMarketItems<ConceptBoardKline[]>(
      `/api/market/boards/concept/${encodeURIComponent(normalized)}/kline?period=${encodeURIComponent(period)}`,
      () => sdk.board.concept.kline(normalized, options)
    )
  );
}

export async function getBoardKlineWithMeta(
  boardType: 'industry' | 'concept',
  symbol: string,
  options?: { period?: 'daily' | 'weekly' | 'monthly' }
): Promise<BoardKlineWithMetaResult> {
  const normalized = normalizeBoardCode(symbol);
  const period = options?.period ?? 'daily';
  const key = getCacheKey('getBoardKlineWithMeta', boardType, normalized, period);
  return withCache(key, DEFAULT_TTL.historyKline, async () => {
    const { data: payload, allowFallback } = await fetchBackendMarketRaw<{
      items?: (IndustryBoardKline | ConceptBoardKline)[];
      kline_source?: string | null;
      kline_source_label?: string | null;
      sampled_constituents?: number | null;
    }>(
      `/api/market/boards/${boardType}/${encodeURIComponent(normalized)}/kline?period=${encodeURIComponent(period)}`
    );
    if (Array.isArray(payload?.items)) {
      return {
        items: payload.items,
        klineSource: payload.kline_source ?? null,
        klineSourceLabel: payload.kline_source_label ?? null,
        sampledConstituents: payload.sampled_constituents ?? null,
      };
    }
    if (!allowFallback) {
      return {
        items: [],
        klineSource: payload?.kline_source ?? null,
        klineSourceLabel: payload?.kline_source_label ?? null,
        sampledConstituents: payload?.sampled_constituents ?? null,
      };
    }
    const items =
      boardType === 'industry'
        ? await sdk.board.industry.kline(normalized, options)
        : await sdk.board.concept.kline(normalized, options);
    return {
      items,
      klineSource: null,
      klineSourceLabel: null,
      sampledConstituents: null,
    };
  });
}

export async function getBoardSummary(
  boardType: 'industry' | 'concept',
  symbol: string
): Promise<BoardSummaryResult> {
  const normalized = normalizeBoardCode(symbol);
  const key = getCacheKey('getBoardSummary', boardType, normalized);
  return withCache(key, DEFAULT_TTL.boardList, async () => {
    const payload = await fetchBackendMarketJson<{
      meta?: BoardSummaryMeta | null;
      spot?: (IndustryBoardSpot | ConceptBoardSpot)[];
    }>(`/api/market/boards/${boardType}/${encodeURIComponent(normalized)}/summary`);
    return {
      meta: payload?.meta ?? null,
      spot: Array.isArray(payload?.spot) ? payload.spot : [],
    };
  });
}

export async function getBoardFundFlow(
  boardType: 'industry' | 'concept',
  symbol: string
): Promise<BoardFundFlowResult> {
  const normalized = normalizeBoardCode(symbol);
  const key = getCacheKey('getBoardFundFlow', boardType, normalized);
  return withCache(key, DEFAULT_TTL.capitalHistory, async () => {
    const payload = await fetchBackendMarketJson<{
      periods?: BoardPeriodFlowItem[];
      daily_history?: BoardFundFlowDailyItem[];
      flow_source?: string;
      flow_source_label?: string;
      sampled_constituents?: number;
    }>(`/api/market/boards/${boardType}/${encodeURIComponent(normalized)}/fund-flow`);
    if (payload) {
      return {
        periods: Array.isArray(payload.periods) ? payload.periods : [],
        dailyHistory: Array.isArray(payload.daily_history) ? payload.daily_history : [],
        flowSource: payload.flow_source ?? 'unavailable',
        flowSourceLabel: payload.flow_source_label ?? '',
        sampledConstituents: payload.sampled_constituents ?? 0,
      };
    }
    return {
      periods: [],
      dailyHistory: [],
      flowSource: 'unavailable',
      flowSourceLabel: '暂无可用资金流明细',
      sampledConstituents: 0,
    };
  });
}

/**
 * 获取行业分钟 K 线
 */
export async function getIndustryMinuteKline(
  symbol: string,
  options?: { period?: '1' | '5' | '15' | '30' | '60' }
) {
  return sdk.board.industry.minuteKline(symbol, options);
}

/**
 * 获取概念分钟 K 线
 */
export async function getConceptMinuteKline(
  symbol: string,
  options?: { period?: '1' | '5' | '15' | '30' | '60' }
) {
  return sdk.board.concept.minuteKline(symbol, options);
}

/**
 * 获取行业 Spot 指标
 */
export async function getIndustrySpot(symbol: string) {
  const normalized = normalizeBoardCode(symbol);
  return fetchBackendMarketItems<IndustryBoardSpot[]>(
    `/api/market/boards/industry/${encodeURIComponent(normalized)}/spot`,
    () => sdk.board.industry.spot(normalized)
  );
}

/**
 * 获取概念 Spot 指标
 */
export async function getConceptSpot(symbol: string) {
  const normalized = normalizeBoardCode(symbol);
  return fetchBackendMarketItems<ConceptBoardSpot[]>(
    `/api/market/boards/concept/${encodeURIComponent(normalized)}/spot`,
    () => sdk.board.concept.spot(normalized)
  );
}

// ========== 资金与大单 API ==========

/**
 * 获取个股资金流向（统一走本地可用后端新浪 MoneyFlow 代理；已弃用失效的 sdk.quotes.fundFlow）
 */
export async function getFundFlow(codes: string[]): Promise<FundFlow[]> {
  const key = getCacheKey('getFundFlow', codes);
  return withCache(key, DEFAULT_TTL.fundFlow, async () => {
    const cleanCodes = codes.map((c) => normalizeStockCode(c)).filter(Boolean);
    if (cleanCodes.length === 0) return [];
    const settled = await Promise.allSettled(
      cleanCodes.map(async (sym): Promise<FundFlow | null> => {
        const rows = await getIndividualFundFlow(sym, { period: 'daily' });
        const latest = rows.at(-1);
        if (!latest) return null;
        const superLarge = latest.superLargeNetInflow ?? 0;
        const large = latest.largeNetInflow ?? 0;
        const small = latest.smallNetInflow ?? 0;
        const medium = latest.mediumNetInflow ?? 0;
        const mainNetYuan = latest.mainNetInflow ?? superLarge + large;
        const retailNetYuan = small + medium;
        const totalFlowYuan = Math.max(
          Math.abs(mainNetYuan) + Math.abs(retailNetYuan),
          Math.abs(mainNetYuan)
        );
        const parsedEpoch = /^\d{4}-\d{2}-\d{2}/.test(latest.date)
          ? Date.parse(`${latest.date.slice(0, 10)}T00:00:00+08:00`)
          : Number.NaN;
        return {
          code: sym,
          name: sym,
          date: latest.date,
          timestamp: Number.isFinite(parsedEpoch) ? parsedEpoch : null,
          tz: 'Asia/Shanghai',
          mainInflow: mainNetYuan > 0 ? mainNetYuan / 1e4 : 0,
          mainOutflow: mainNetYuan < 0 ? Math.abs(mainNetYuan) / 1e4 : 0,
          mainNet: mainNetYuan / 1e4,
          mainNetRatio: latest.mainNetInflowPercent ?? 0,
          retailInflow: retailNetYuan > 0 ? retailNetYuan / 1e4 : 0,
          retailOutflow: retailNetYuan < 0 ? Math.abs(retailNetYuan) / 1e4 : 0,
          retailNet: retailNetYuan / 1e4,
          retailNetRatio:
            totalFlowYuan > 0 ? Number(((retailNetYuan / totalFlowYuan) * 100).toFixed(2)) : 0,
          totalFlow: totalFlowYuan / 1e4,
        };
      })
    );
    return settled
      .filter((item): item is PromiseFulfilledResult<FundFlow | null> => item.status === 'fulfilled')
      .map((item) => item.value)
      .filter((row): row is FundFlow => row !== null);
  });
}

/**
 * 获取盘口大单
 */
export async function getPanelLargeOrder(codes: string[]) {
  const key = getCacheKey('getPanelLargeOrder', codes);
  return withCache(key, DEFAULT_TTL.fundFlow, () =>
    sdk.quotes.largeOrder(codes)
  );
}

/**
 * 获取个股历史资金流
 */
export async function getIndividualFundFlow(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
  }
) {
  const normalized = normalizeStockCode(symbol);
  const period = options?.period ?? 'daily';
  const key = getCacheKey('getIndividualFundFlow', normalized, period);
  return withCache(key, DEFAULT_TTL.capitalHistory, () =>
    fetchBackendMarketItems<StockFundFlowDaily[]>(
      `/api/market/stocks/${encodeURIComponent(normalized)}/fund-flow?period=${encodeURIComponent(period)}`,
      () => sdk.fundFlow.individual(symbol, options)
    )
  );
}

/**
 * 获取大盘资金流
 */
export async function getMarketFundFlow() {
  const key = getCacheKey('getMarketFundFlow');
  return withCache(key, DEFAULT_TTL.capitalHistory, () =>
    fetchBackendMarketItems<MarketFundFlow[]>(
      '/api/market/fund-flow/market',
      () => sdk.fundFlow.market()
    )
  );
}

/**
 * 获取个股资金流排行
 */
export async function getFundFlowRank(options?: {
  indicator?: 'today' | '3day' | '5day' | '10day';
}) {
  const key = getCacheKey('getFundFlowRank', options);
  const indicator = options?.indicator ?? 'today';
  return withCache(key, DEFAULT_TTL.fundFlow, () =>
    fetchBackendMarketItems<FundFlowRankItem[]>(
      `/api/market/fund-flow/stocks?indicator=${encodeURIComponent(indicator)}`,
      () => sdk.fundFlow.rank(options)
    )
  );
}

/**
 * 获取板块资金流排行
 */
export async function getSectorFundFlowRank(options?: {
  indicator?: 'today' | '3day' | '5day' | '10day';
  sectorType?: 'industry' | 'concept' | 'region';
}) {
  const key = getCacheKey('getSectorFundFlowRank', options);
  const sectorType = options?.sectorType ?? 'industry';
  const indicator = options?.indicator ?? 'today';
  return withCache(key, DEFAULT_TTL.fundFlow, () =>
    fetchBackendMarketItems<SectorFundFlowItem[]>(
      `/api/market/fund-flow/sectors?sector_type=${encodeURIComponent(sectorType)}&indicator=${encodeURIComponent(indicator)}`,
      () => sdk.fundFlow.sectorRank(options)
    )
  );
}

/**
 * 获取单个板块历史资金流
 */
export async function getSectorFundFlowHistory(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
  }
) {
  if (!/^BK\d+/i.test(symbol)) {
    return [];
  }
  const key = getCacheKey('getSectorFundFlowHistory', symbol, options);
  return withCache(key, DEFAULT_TTL.capitalHistory, () =>
    sdk.fundFlow.sectorHistory(symbol, options)
  );
}

/**
 * 获取北向/南向资金汇总
 */
export async function getNorthboundFlowSummary() {
  const key = getCacheKey('getNorthboundFlowSummary');
  return withCache(key, DEFAULT_TTL.northbound, () => sdk.northbound.summary());
}

/**
 * 获取北向/南向资金历史
 */
export async function getNorthboundHistory(
  direction: 'north' | 'south' = 'north',
  options?: {
    startDate?: string;
    endDate?: string;
  }
) {
  const key = getCacheKey('getNorthboundHistory', direction, options);
  return withCache(key, DEFAULT_TTL.northbound, () =>
    sdk.northbound.history(direction, options)
  );
}

/**
 * 获取个股北向持仓历史
 */
export async function getNorthboundIndividual(
  symbol: string,
  options?: {
    startDate?: string;
    endDate?: string;
  }
) {
  const key = getCacheKey('getNorthboundIndividual', symbol, options);
  return withCache(key, DEFAULT_TTL.northbound, () =>
    sdk.northbound.individual(symbol, options)
  );
}

/**
 * 获取涨停股池
 */
export async function getZTPool(
  type: 'zt' | 'yesterday' | 'strong' | 'sub_new' | 'broken' | 'dt' = 'zt',
  date?: string
) {
  const key = getCacheKey('getZTPool', type, date);
  return withCache(key, DEFAULT_TTL.stockChanges, () => sdk.marketEvent.ztPool(type, date));
}

/**
 * 获取盘口异动
 */
export async function getStockChanges(
  type:
    | 'rocket_launch'
    | 'quick_rebound'
    | 'large_buy'
    | 'limit_up_seal'
    | 'limit_down_open'
    | 'big_buy_order'
    | 'auction_up'
    | 'high_open_5d'
    | 'gap_up'
    | 'high_60d'
    | 'surge_60d'
    | 'accelerate_down'
    | 'high_dive'
    | 'large_sell'
    | 'limit_down_seal'
    | 'limit_up_open'
    | 'big_sell_order'
    | 'auction_down'
    | 'low_open_5d'
    | 'gap_down'
    | 'low_60d'
    | 'drop_60d' = 'large_buy'
) {
  const key = getCacheKey('getStockChanges', type);
  return withCache(key, DEFAULT_TTL.stockChanges, () => sdk.marketEvent.stockChanges(type));
}

/**
 * 获取龙虎榜详情
 */
export async function getDragonTigerDetail(options: {
  startDate: string;
  endDate: string;
}) {
  const key = getCacheKey('getDragonTigerDetail', options);
  return withCache(key, DEFAULT_TTL.dragonTiger, () => sdk.dragonTiger.detail(options));
}

/**
 * 获取大宗交易明细
 */
export async function getBlockTradeDetail(options?: {
  startDate?: string;
  endDate?: string;
}) {
  const key = getCacheKey('getBlockTradeDetail', options);
  return withCache(key, DEFAULT_TTL.blockTrade, () => sdk.blockTrade.detail(options));
}

/**
 * 获取融资融券账户统计
 */
export async function getMarginAccountInfo() {
  const key = getCacheKey('getMarginAccountInfo');
  return withCache(key, DEFAULT_TTL.margin, () => sdk.margin.accountInfo());
}

// ========== 搜索 API ==========

/**
 * 搜索股票/板块
 * @param keyword - 搜索关键词
 * @returns 搜索结果列表
 */
export async function search(keyword: string) {
  const results = await sdk.search(keyword);
  return results.map(normalizeSearchResult);
}

// ========== 其他 API ==========

/**
 * 获取分红派息详情
 */
export async function getDividendDetail(symbol: string): Promise<DividendDetail[]> {
  const key = getCacheKey('getDividendDetail', symbol);
  return withCache(key, DEFAULT_TTL.dividends, () => sdk.reference.dividendDetail(symbol));
}

/**
 * 获取交易日历
 */
export async function getTradingCalendar() {
  const key = getCacheKey('getTradingCalendar');
  return withCache(key, 3600000, () => sdk.reference.tradingCalendar()); // 1 小时缓存
}
