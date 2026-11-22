/**
 * 跨资产组合 X-Ray 穿透诊断 API 客户端（Strictly Read-Only）。
 * 对接 GET /api/portfolio/xray?account_id=...，支持桌面同源、移动 Bearer 与离线快照模式。
 * 严格遵循「未披露部分统一保留在 UNATTRIBUTED_FUND_RESIDUAL，严禁插值反推」。
 */
import { apiRequestJson } from './apiClient';

export type XRayAccountId = 'ALL' | 'STK-ALIPAY-001' | 'FND-TIANTIAN-002';

export interface LookThroughContribution {
  holder_id: string;
  holder_name: string;
  holder_kind: 'DIRECT_STOCK' | 'FUND' | 'ETF';
  portfolio_weight_pct: number;
  inside_fund_weight_pct: number | null;
}

export interface UnderlyingExposureRow {
  symbol: string;
  name: string;
  sector: string;
  total_weight_pct: number;
  direct_weight_pct: number;
  indirect_weight_pct: number;
  holder_count: number;
  is_direct_held: boolean;
  research_route: string;
  breakdown_text: string;
  contributions: LookThroughContribution[];
}

export interface OverlapAlertRow {
  symbol: string;
  name: string;
  sector: string;
  alert_type: 'MULTI_HOLDER_AND_CONCENTRATED' | 'MULTI_HOLDER' | 'CONCENTRATED_SINGLE';
  holder_count: number;
  total_weight_pct: number;
  direct_weight_pct: number;
  indirect_weight_pct: number;
  holders_summary: string;
  research_route: string;
}

export interface SectorExposureRow {
  sector: string;
  total_weight_pct: number;
  direct_weight_pct: number;
  indirect_weight_pct: number;
  underlying_count: number;
  top_symbols: string[];
}

export interface FundDisclosureStatusRow {
  fund_code: string;
  fund_name: string;
  account_id: string;
  portfolio_weight_pct: number;
  asset_class: 'MONEY_FUND' | 'FUND' | 'ETF';
  holdings_report_date: string | null;
  staleness_days: number | null;
  disclosed_coverage_pct: number;
  unattributed_residual_pct: number;
  top_holdings_count: number;
  status: 'DISCLOSED' | 'LOW_COVERAGE_FEEDER' | 'MONEY_FUND_CASH_EQUIV' | 'UNAVAILABLE';
  source: string | null;
  note: string;
}

export interface XRayCoverageSummary {
  direct_stock_weight_pct: number;
  indirect_disclosed_stock_weight_pct: number;
  total_disclosed_equity_weight_pct: number;
  cash_and_money_fund_weight_pct: number;
  unattributed_fund_residual_pct: number;
  max_staleness_days: number | null;
  disclosed_fund_count: number;
  total_fund_count: number;
  data_gap_notes: string[];
}

export interface PortfolioXRayResponse {
  account_id: XRayAccountId;
  account_label: string;
  as_of: string;
  include_amounts: boolean;
  total_equity_cny: number | null;
  unattributed_bucket_id: 'UNATTRIBUTED_FUND_RESIDUAL';
  coverage_summary: XRayCoverageSummary;
  top_underlying_exposures: UnderlyingExposureRow[];
  overlap_alerts: OverlapAlertRow[];
  sector_exposures: SectorExposureRow[];
  fund_disclosures: FundDisclosureStatusRow[];
  lookthrough_exposures: Array<Record<string, unknown>>;
  warnings: string[];
  research_only: true;
  execution_allowed: false;
}

export const XRAY_ACCOUNT_OPTIONS: ReadonlyArray<{ value: XRayAccountId; label: string }> = [
  { value: 'ALL', label: '全账户联合 (STK + FND)' },
  { value: 'STK-ALIPAY-001', label: '支付宝股票 (STK)' },
  { value: 'FND-TIANTIAN-002', label: '天天基金 (FND)' },
];

export const FUND_DISCLOSURE_STATUS_LABELS: Record<
  FundDisclosureStatusRow['status'],
  string
> = {
  DISCLOSED: '季报可穿透',
  LOW_COVERAGE_FEEDER: '联接基金低覆盖',
  MONEY_FUND_CASH_EQUIV: '货币现金垫',
  UNAVAILABLE: '暂无重仓明细',
};

export const OVERLAP_ALERT_TYPE_LABELS: Record<OverlapAlertRow['alert_type'], string> = {
  MULTI_HOLDER_AND_CONCENTRATED: '跨持仓重复 + 高集中',
  MULTI_HOLDER: '跨账户/多基金叠加',
  CONCENTRATED_SINGLE: '单标的集中 ≥8%',
};

export function fetchPortfolioXRay(
  accountId: XRayAccountId = 'ALL',
  signal?: AbortSignal
): Promise<PortfolioXRayResponse> {
  const qs = encodeURIComponent(accountId);
  return apiRequestJson<PortfolioXRayResponse>(`/api/portfolio/xray?account_id=${qs}`, {
    signal,
  });
}
