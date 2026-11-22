import type { FullQuote } from 'stock-sdk';
import type { GlobalMarketId, GlobalStockRow } from '@/services/globalMarketsApi';
import { detectAssetMarket, normalizeStockCode } from '@/utils/format';

export interface TerminalQuote extends FullQuote {
  __market?: GlobalMarketId;
  __currency?: string;
  __currencyNote?: string;
  __sector?: string;
  __peTtm?: number | null;
}

export const OUTER_MARKET_BADGE: Record<GlobalMarketId, string> = {
  cn: 'A股',
  hk: '港股',
  us: '美股',
  jp: '日股',
  kr: '韩股',
  eu: '欧股',
};

export function globalRowToTerminalQuote(row: GlobalStockRow): TerminalQuote {
  const price = row.price ?? 0;
  const pct = row.change_pct ?? 0;
  const prevClose = pct !== -100 && price > 0 ? price / (1 + pct / 100) : price;
  const change = price > 0 ? price - prevClose : 0;

  return {
    code: row.symbol,
    name: row.name,
    price,
    prevClose,
    open: price,
    high: price,
    low: price,
    volume: row.volume ?? 0,
    amount: row.amount ?? 0,
    change,
    changePercent: pct,
    turnoverRate: null as unknown as number,
    amplitude: null as unknown as number,
    volumeRatio: null as unknown as number,
    peDynamic: row.pe_ttm ?? (null as unknown as number),
    pe: row.pe_ttm ?? (null as unknown as number),
    totalMarketCap: row.market_cap ?? (null as unknown as number),
    circulatingMarketCap: row.market_cap ?? (null as unknown as number),
    __market: row.market,
    __currency: row.currency,
    __currencyNote: row.currency_note,
    __sector: row.industry || row.sector,
    __peTtm: row.pe_ttm ?? null,
  } as TerminalQuote;
}

export function isSupportedWatchlistCode(rawCode: string): boolean {
  const normalized = normalizeStockCode(rawCode);
  if (!normalized) return false;
  if (/^(sh|sz|bj)\d{6}$/i.test(normalized)) return true;
  return detectAssetMarket(normalized) !== 'cn';
}

export function formatTerminalCodeLabel(code: string): string {
  const normalized = normalizeStockCode(code);
  if (detectAssetMarket(normalized) !== 'cn') {
    return normalized;
  }
  const m = normalized.match(/^(?:sh|sz|bj)(\d{6})$/i);
  return m ? m[1] : normalized;
}
