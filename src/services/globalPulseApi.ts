import { apiRequestJson } from './apiClient';

export type GlobalPulseRegion = 'US' | 'APAC' | 'EU' | 'MACRO';
export type GlobalPulseStatus = 'OK' | 'STALE' | 'UNAVAILABLE';
export type GlobalPulseSessionState = 'TRADING' | 'CLOSED' | '24H' | 'DAILY';

export interface GlobalPulseItemMeta {
  cn10y_yield?: number | null;
  cn10y_change_bp?: number | null;
  us10y_change_bp?: number | null;
  spread_bps?: number | null;
  rate_date?: string;
}

export interface GlobalPulseItem {
  code: string;
  name: string;
  short_name: string;
  region: GlobalPulseRegion;
  kind: 'INDEX' | 'FX' | 'COMMODITY' | 'RATE';
  unit: string;
  decimals: number;
  core8: boolean;
  status: GlobalPulseStatus;
  price: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  session_state: GlobalPulseSessionState;
  session_label: string;
  exchange_tz: string;
  source: string;
  source_time: string;
  meta: GlobalPulseItemMeta;
}

export interface CrossBorderAnchors {
  ndx_pct: number | null;
  spx_pct: number | null;
  hsi_pct: number | null;
  hstech_pct: number | null;
  n225_pct: number | null;
  ks11_pct: number | null;
  usdcnh_price: number | null;
  usdcnh_pct: number | null;
  gold_pct: number | null;
  wti_pct: number | null;
  us10y_yield: number | null;
  cn_us_spread_bps: number | null;
}

export interface GlobalPulsePayload {
  scope: 'GLOBAL_MACRO_CONTEXT_ONLY';
  research_only: boolean;
  execution_allowed: boolean;
  as_of_bj: string;
  stale: boolean;
  throttled?: boolean;
  warnings: string[];
  items: GlobalPulseItem[];
  cross_border_anchors: CrossBorderAnchors;
}

export function fetchGlobalPulse(
  force = false,
  signal?: AbortSignal
): Promise<GlobalPulsePayload> {
  const path = force ? '/api/market/global-pulse?force=true' : '/api/market/global-pulse';
  return apiRequestJson<GlobalPulsePayload>(path, { signal });
}

export function formatPulsePrice(item: GlobalPulseItem): string {
  if (item.status === 'UNAVAILABLE' || item.price === null || !Number.isFinite(item.price)) {
    return '--';
  }
  const fixed = item.price.toFixed(item.decimals);
  return item.unit === '%' ? `${fixed}%` : fixed;
}

export function formatPulseChangePct(item: GlobalPulseItem): string {
  if (
    item.status === 'UNAVAILABLE'
    || item.change_pct === null
    || !Number.isFinite(item.change_pct)
  ) {
    return '--';
  }
  if (item.kind === 'RATE' && typeof item.meta?.us10y_change_bp === 'number' && Number.isFinite(item.meta.us10y_change_bp)) {
    const bp = item.meta.us10y_change_bp;
    return `${bp > 0 ? '+' : ''}${bp.toFixed(1)}bp`;
  }
  const sign = item.change_pct > 0 ? '+' : '';
  return `${sign}${item.change_pct.toFixed(2)}%`;
}
