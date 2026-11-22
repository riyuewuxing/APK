/**
 * 全球多市场只读 API 与偏好持久化服务
 * 对接后端 5 个 /api/market/global/* 接口，自动走 apiRequestJson 支持桌面同源与手机 Bearer 鉴权。
 */

import { apiRequestJson } from './apiClient';

export type GlobalMarketId = 'cn' | 'hk' | 'us' | 'jp' | 'kr' | 'eu';
export type OuterMarketId = Exclude<GlobalMarketId, 'cn'>;
export type GlobalSortBy = 'market_cap' | 'change' | 'change_asc' | 'amount';

export interface GlobalMarketMeta {
  id: GlobalMarketId;
  label: string;
  badge: string;
  currency: string;
  pulseCode: string;
}

export const GLOBAL_MARKET_LIST: GlobalMarketMeta[] = [
  { id: 'cn', label: '大A', badge: 'CN', currency: 'CNY', pulseCode: 'SH' },
  { id: 'hk', label: '港股', badge: 'HK', currency: 'HKD', pulseCode: 'HSI' },
  { id: 'us', label: '美股', badge: 'US', currency: 'USD', pulseCode: 'NDX' },
  { id: 'jp', label: '日股', badge: 'JP', currency: 'JPY', pulseCode: 'N225' },
  { id: 'kr', label: '韩股', badge: 'KR', currency: 'KRW', pulseCode: 'KS11' },
  { id: 'eu', label: '欧股', badge: 'EU', currency: 'EUR', pulseCode: 'GDAXI' },
];

export const ACTIVE_GLOBAL_MARKET_KEY = 'ui.activeGlobalMarket';

export function getActiveGlobalMarket(): GlobalMarketId {
  try {
    const raw = localStorage.getItem(ACTIVE_GLOBAL_MARKET_KEY);
    if (raw && GLOBAL_MARKET_LIST.some((m) => m.id === raw)) {
      return raw as GlobalMarketId;
    }
  } catch {
    // ignore storage failures
  }
  return 'cn';
}

export function saveActiveGlobalMarket(market: GlobalMarketId): void {
  try {
    localStorage.setItem(ACTIVE_GLOBAL_MARKET_KEY, market);
  } catch {
    // ignore storage failures
  }
}

export interface GlobalSessionInfo {
  state: 'TRADING' | 'CLOSED' | '24H' | 'DAILY';
  label: string;
  exchange_tz: string;
}

export interface GlobalStockRow {
  symbol: string;
  raw_code: string;
  tv_symbol?: string;
  market: OuterMarketId;
  name: string;
  en_name: string;
  exchange?: string;
  country?: string;
  currency: string;
  currency_note?: string;
  price: number | null;
  change_pct: number | null;
  volume?: number | null;
  market_cap?: number | null;
  amount?: number | null;
  pe_ttm?: number | null;
  sector_key: string;
  sector: string;
  industry: string;
  source?: string;
}

export interface GlobalSectorRow {
  board_code: string;
  name: string;
  change_pct: number;
  change_method: 'cap_weighted' | 'equal_weighted';
  total_market_cap: number;
  total_amount: number;
  rise_count: number;
  fall_count: number;
  flat_count: number;
  constituent_count: number;
  leading_stock_symbol: string;
  leading_stock_name: string;
  leading_stock_pct: number;
}

export interface GlobalMarketOverviewResponse {
  market: OuterMarketId;
  market_label: string;
  currency: string;
  status: 'OK' | 'UNAVAILABLE';
  as_of_bj: string;
  session: GlobalSessionInfo;
  summary: {
    total_count: number;
    rise_count: number;
    fall_count: number;
    flat_count: number;
    total_amount: number;
    total_market_cap: number;
    index_anchors: Array<{
      code: string;
      name: string;
      short_name: string;
      price: number | null;
      change_pct: number | null;
      status: string;
    }>;
  };
  sectors: GlobalSectorRow[];
  sub_industries: GlobalSectorRow[];
  stocks: GlobalStockRow[];
  stale: boolean;
  warnings: string[];
  research_only: boolean;
  execution_allowed: boolean;
}

export interface GlobalBoardConstituentsResponse {
  market: OuterMarketId;
  sector_key: string;
  sector_name: string;
  as_of_bj: string;
  session: GlobalSessionInfo;
  items: GlobalStockRow[];
  total_count: number;
  stale: boolean;
  warnings: string[];
  research_only: boolean;
  execution_allowed: boolean;
}

export interface GlobalQuotesResponse {
  items: GlobalStockRow[];
  count: number;
  warnings: string[];
  research_only: boolean;
  execution_allowed: boolean;
}

export interface GlobalTimelinePoint {
  time: string;
  price: number;
  avgPrice: number;
  volume: number;
}

export interface GlobalChartBar {
  date: string;
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  ma?: { ma5: number | null; ma10: number | null; ma20: number | null };
}

export interface GlobalChartResponse {
  symbol: string;
  market: OuterMarketId;
  currency: string;
  exchange_tz?: string;
  date?: string;
  prevClose?: number | null;
  period?: string;
  data?: GlobalTimelinePoint[];
  bars?: GlobalChartBar[];
  status?: string;
  source?: string;
  stale: boolean;
  warnings: string[];
  research_only: boolean;
  execution_allowed: boolean;
}

export interface GlobalSearchResponse {
  items: Array<
    Partial<GlobalStockRow> & {
      symbol: string;
      raw_code: string;
      market: OuterMarketId;
      name: string;
      en_name: string;
      currency: string;
      sector?: string;
    }
  >;
  count: number;
  research_only: boolean;
  execution_allowed: boolean;
}

export function fetchGlobalMarketOverview(
  market: OuterMarketId,
  sortBy: GlobalSortBy = 'market_cap',
  limit = 160,
  signal?: AbortSignal
): Promise<GlobalMarketOverviewResponse> {
  const params = new URLSearchParams({
    market,
    sort_by: sortBy,
    limit: String(limit),
  });
  return apiRequestJson<GlobalMarketOverviewResponse>(
    `/api/market/global/overview?${params.toString()}`,
    { signal }
  );
}

export function fetchGlobalBoardConstituents(
  market: OuterMarketId,
  sectorKey: string,
  sortBy: GlobalSortBy = 'market_cap',
  limit = 120,
  signal?: AbortSignal
): Promise<GlobalBoardConstituentsResponse> {
  const params = new URLSearchParams({ sort_by: sortBy, limit: String(limit) });
  return apiRequestJson<GlobalBoardConstituentsResponse>(
    `/api/market/global/boards/${encodeURIComponent(market)}/${encodeURIComponent(sectorKey)}/constituents?${params.toString()}`,
    { signal }
  );
}

export function fetchGlobalQuotes(
  symbols: string[],
  signal?: AbortSignal
): Promise<GlobalQuotesResponse> {
  const params = new URLSearchParams({ symbols: symbols.join(',') });
  return apiRequestJson<GlobalQuotesResponse>(
    `/api/market/global/quotes?${params.toString()}`,
    { signal }
  );
}

export function fetchGlobalChart(
  symbol: string,
  period: 'timeline' | 'daily' | 'weekly' | '5' | '15' | '30' | '60',
  signal?: AbortSignal
): Promise<GlobalChartResponse> {
  const params = new URLSearchParams({ symbol, period });
  return apiRequestJson<GlobalChartResponse>(
    `/api/market/global/chart?${params.toString()}`,
    { signal }
  );
}

export function searchGlobalSymbols(
  query: string,
  limit = 12,
  signal?: AbortSignal
): Promise<GlobalSearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return apiRequestJson<GlobalSearchResponse>(
    `/api/market/global/search?${params.toString()}`,
    { signal }
  );
}
