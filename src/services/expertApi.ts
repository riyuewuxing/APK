/**
 * 投资专家只读研究接口客户端 (Strictly Read-Only Research API Client)
 * 对接 FastAPI 后端：/api/health, /api/workbench, /api/radar, /api/research/{id},
 * /api/quantstats/tearsheet, /api/audit, POST /api/lwc/native-window/{id}
 * 永久禁止任何交易下单请求 (research_only = true, execution_allowed = false)。
 */

import { normalizeStockCode, parseStockCode } from '@/utils/format';
import { apiRequestJson, apiRequestText } from './apiClient';

export type DecisionAction =
  | 'BUY'
  | 'HOLD'
  | 'SELL'
  | 'WAIT'
  | 'INSUFFICIENT_EVIDENCE';

export type OrthogonalCluster =
  | 'VALUATION_AND_ODDS'
  | 'FUNDAMENTAL_AND_QUALITY'
  | 'PRICE_TREND_AND_FLOW'
  | 'INDUSTRY_AND_CATALYST'
  | 'PORTFOLIO_AND_OPPORTUNITY_COST';

export type ClaimKind =
  | 'FACT'
  | 'INFERENCE'
  | 'HYPOTHESIS'
  | 'UNKNOWN'
  | 'RISK'
  | 'COUNTEREVIDENCE';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export type VerificationStatus =
  | 'SUPPORTED'
  | 'CONFLICTED'
  | 'UNVERIFIED'
  | 'STALE'
  | 'UNKNOWN'
  | 'REJECTED';

export type ValueTrapClassification =
  | 'TRUE_TURNAROUND'
  | 'VALUE_TRAP_WARNING'
  | 'QUALITY_COMPOUNDER'
  | 'NEUTRAL_OBSERVE'
  | 'INSUFFICIENT_DATA';

export type ETFSubtype = 'INDEX_ETF' | 'ACTIVE_ETF';

export interface ProvenanceBadge {
  source_id: string;
  as_of: string;
  confidence: ConfidenceLevel;
  verification_status: VerificationStatus;
  crosscheck_status: string;
  claim_id?: string | null;
}

export interface GlobalGovernanceStatus {
  pit_cutoff_summary: string;
  ledger_status: string;
  ledger_sha256_short: string;
  crosscheck_summary: string;
  execution_lock_label: string;
  research_only: boolean;
  execution_allowed: boolean;
}

export interface HealthResponse {
  status: string;
  version: string;
  server_profile?: string;
  api_contract_version?: number;
  frontend_bundle_sha256?: string | null;
  lan_ips?: string[];
  vendor_assets?: Record<string, number>;
  frontend_mode?: string;
  dist_assets_count?: number;
  execution_lock_label?: string;
  research_only: boolean;
  execution_allowed: boolean;
}

export interface MobilePairingInfo {
  api_contract_version: number;
  mobile_port: number;
  lan_ips: string[];
  primary_lan_ip: string | null;
  tailscale_ip: string | null;
  tailscale_dns: string | null;
  lan_url: string;
  remote_url: string;
  device_token: string;
  pairing_code: string;
}

export interface WebBundleManifest {
  bundle_version: string;
  bundle_sha256: string;
  zip_sha256?: string;
  zip_bytes?: number;
  file_count: number;
  total_bytes: number;
  generated_at: string;
  download_url?: string;
}

export interface AppReleaseInfo {
  available: boolean;
  reason?: string;
  version_code?: number;
  version_name?: string;
  private_head_sha?: string;
  signing_sha256?: string;
  apk_filename?: string;
  apk_bytes?: number;
  apk_sha256?: string;
  built_at?: string;
  download_url?: string;
}

export interface StockPositionRow {
  symbol: string;
  name: string;
  quantity: number;
  close_price: number;
  market_value: number;
  weight_pct: number;
  action: DecisionAction;
  action_label_zh: string;
  zero_position_test: string;
  trigger_summary: string;
  hypothesis_id: string;
  hypothesis_status: string;
  badge: ProvenanceBadge;
}

export interface HypothesisReviewRow {
  hypothesis_id?: string;
  id?: string;
  symbol?: string;
  status?: string;
  summary?: string;
  [key: string]: string | undefined;
}

export interface StockAccountSummary {
  account_id: string;
  account_name: string;
  as_of: string;
  reference_close_date: string;
  total_asset: number;
  frozen_baseline_total: number | null;
  change_pct: number | null;
  cash_amount: number;
  cash_weight_pct: number;
  plan_b_total: number | null;
  plan_b_diff: number | null;
  plan_b_diff_pct: number | null;
  snapshot_id?: string | null;
  book_status?: string;
  valuation_basis?: string;
  positions: StockPositionRow[];
  hypothesis_reviews: HypothesisReviewRow[];
  badge: ProvenanceBadge;
}

export interface FundPositionRow {
  fund_code: string;
  fund_name: string;
  asset_value: number;
  daily_pnl: number;
  holding_pnl: number;
  weight_pct: number;
  risk_bucket: string;
  pending_redemption_cny: number;
  badge: ProvenanceBadge;
}

export interface RiskBucketRow {
  bucket_name: string;
  current_weight_pct: number;
  post_redemption_weight_pct: number;
  band_min_pct: number;
  band_max_pct: number;
  band_display: string;
  status: string;
}

export interface PendingRedemptionOrder {
  order_id: string;
  submitted_at: string;
  fund_code: string;
  fund_name: string;
  request_shares: number;
  request_ratio_pct: number;
  reference_nav_date: string;
  reference_nav: number;
  reference_gross_cny: number;
  status: string;
  expected_next_open_day: string;
  post_confirm_remaining_shares: number;
  intended_liquidity_role: string;
}

export interface FundAccountSummary {
  account_id: string;
  account_name: string;
  as_of: string;
  pending_as_of: string;
  snapshot_id?: string | null;
  book_status?: string;
  total_asset: number;
  daily_pnl: number;
  holding_pnl: number;
  pending_redemption_total_cny: number;
  redemption_state_chain: string;
  holdings: FundPositionRow[];
  risk_buckets: RiskBucketRow[];
  pending_orders: PendingRedemptionOrder[];
  badge: ProvenanceBadge;
}

export interface WorkbenchState {
  governance: GlobalGovernanceStatus;
  priority_alerts: string[];
  stock_account: StockAccountSummary;
  frozen_stock_account?: StockAccountSummary | null;
  fund_account: FundAccountSummary;
  registered_accounts: string[];
  research_only: boolean;
  execution_allowed: boolean;
}

export interface RawIndicatorEvidence {
  indicator_id: string;
  name: string;
  cluster: OrthogonalCluster;
  direction: number;
  strength: number;
  value_display: string;
  summary: string;
  is_red_flag_blocker: boolean;
  claim_kind: ClaimKind;
  badge: ProvenanceBadge;
}

export interface ClusterVoteSummary {
  cluster: OrthogonalCluster;
  net_direction: number;
  deduped_score: number;
  raw_indicator_count: number;
  effective_independent_votes: number;
  collinearity_suppressed_count: number;
  has_red_flag: boolean;
  has_conflict: boolean;
  primary_evidence_summary: string;
  indicators: RawIndicatorEvidence[];
}

export interface OrthogonalDecisionPacket {
  subject_id: string;
  subject_name: string;
  asset_type: string;
  as_of: string;
  currently_held: boolean;
  action: DecisionAction;
  action_label_zh: string;
  research_action?: DecisionAction | null;
  admission_state?: 'ADMITTED' | 'NOT_ADMITTED' | 'LEGACY_UNVERIFIED';
  admission_blockers?: string[];
  supporting_clusters_count: number;
  contradicting_clusters_count: number;
  unknown_clusters_count: number;
  composite_conviction_score: number;
  red_flag_blockers: string[];
  unresolved_gaps: string[];
  supporting_reasons: string[];
  counter_reasons: string[];
  change_triggers: string[];
  cluster_votes: ClusterVoteSummary[];
  research_only: boolean;
  execution_allowed: boolean;
}

export interface DuPontDecomposition {
  net_profit_margin_pct: number;
  asset_turnover: number;
  equity_multiplier: number;
  computed_roe_pct: number;
  driver_diagnosis: string;
}

export interface ReverseDCFImpliedExpectation {
  market_cap: number;
  normalized_fcf: number;
  discount_rate: number;
  terminal_growth: number;
  implied_5y_cagr_pct: number | null;
  safety_margin_assessment: string;
}

export interface AccountingRedFlag {
  flag_id: string;
  title_zh: string;
  severity: string;
  detail: string;
}

export interface TurnaroundAndTrapReport {
  subject_id: string;
  as_of: string;
  classification: ValueTrapClassification;
  turnaround_score: number;
  trap_risk_score: number;
  piotroski_f_score: number;
  altman_z_score: number;
  beneish_m_score: number;
  engine_provider: string;
  dupont: DuPontDecomposition | null;
  reverse_dcf: ReverseDCFImpliedExpectation | null;
  red_flags: AccountingRedFlag[];
  turnaround_drivers: string[];
  emitted_indicators: RawIndicatorEvidence[];
}

export interface OpportunityComparisonMetric {
  key: string;
  label: string;
  unit: string;
  candidate_value: number;
  alternative_value: number;
  definition: string;
}

const COMPARISON_DIMENSIONS = [
  ['expected_net_return_pct', '预期净收益', '%', true],
  ['downside_risk_pct', '下行风险', '%', false],
  ['liquidity_cost_bps', '流动性成本', 'bps', false],
  ['marginal_portfolio_risk_pct', '组合边际风险', '%', false],
] as const;

/** A display guard, not an independent admission authority. Reject old text-only
 * rows and inconsistent numeric directions instead of rendering them as verified. */
export function comparisonEvidenceReady(row: OpportunityCostMatrixRow): boolean {
  const metrics = row.comparison_metrics;
  if (row.decision_eligible !== true || typeof row.comparison_basis_label !== 'string'
      || !row.comparison_basis_label.trim() || !Array.isArray(metrics)
      || metrics.length !== COMPARISON_DIMENSIONS.length
      || !Array.isArray(row.governance_reasons) || row.governance_reasons.length !== 0
      || !Array.isArray(row.candidate_advantages) || !Array.isArray(row.alternative_advantages)) return false;
  const left: string[] = [];
  const right: string[] = [];
  for (const [key, label, unit, higher] of COMPARISON_DIMENSIONS) {
    const matches = metrics.filter(item => item?.key === key);
    if (matches.length !== 1) return false;
    const item = matches[0];
    if (item.label !== label || item.unit !== unit
        || typeof item.definition !== 'string' || !item.definition.trim()
        || !Number.isFinite(item.candidate_value) || !Number.isFinite(item.alternative_value)
        || ((key === 'downside_risk_pct' || key === 'liquidity_cost_bps')
            && (item.candidate_value < 0 || item.alternative_value < 0))) return false;
    if (item.candidate_value === item.alternative_value) continue;
    const direction = key.toUpperCase() + (higher ? '_HIGHER' : '_LOWER');
    ((item.candidate_value > item.alternative_value) === higher ? left : right).push(direction);
  }
  return JSON.stringify(left) === JSON.stringify(row.candidate_advantages)
    && JSON.stringify(right) === JSON.stringify(row.alternative_advantages);
}

export function comparisonAdvantageLabel(code: string): string {
  const dimension = COMPARISON_DIMENSIONS.find(([key, , , higher]) =>
    code === key.toUpperCase() + (higher ? '_HIGHER' : '_LOWER'));
  return dimension ? dimension[1] + (dimension[3] ? '更高' : '更低') : '';
}

export interface OpportunityCostMatrixRow {
  alternative_id: string;
  alternative_name: string;
  alternative_kind: string;
  thesis_quality: string;
  evidence_confidence: string;
  zero_position_test: string;
  decision_eligible: boolean;
  candidate_advantages: string[];
  alternative_advantages: string[];
  shared_unknowns: string[];
  governance_reasons: string[];
  comparison_basis_label?: string | null;
  comparison_metrics?: OpportunityComparisonMetric[];
}

export interface KlineBarPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface KlineMarkerPoint {
  time: string;
  position: string;
  color: string;
  shape: string;
  text: string;
}

export interface BacktestSummaryViewModel {
  strategy_name: string;
  total_return_1x_pct: number;
  total_return_2x_pct: number | null;
  max_drawdown_1x_pct: number;
  sharpe_1x: number | null;
  win_rate_pct: number | null;
  trade_count: number | null;
  statistics_basis?: string;
  positive_day_rate_pct?: number | null;
  position_change_count?: number | null;
  observation_count?: number | null;
  underwater_dates: string[];
  underwater_drawdowns_pct: number[];
  warnings: string[];
}

export interface ClaimAuditRow {
  claim_id: string;
  subject_ids: string[];
  domain: string;
  kind: ClaimKind | string;
  verification_status: VerificationStatus | string;
  confidence: ConfidenceLevel | string;
  claim_text: string;
  source_ids: string[];
}

export interface PortfolioCorrelationSummary {
  as_of?: string;
  symbols?: string[];
  names?: Record<string, string>;
  target_symbol?: string | null;
  avg_correlation_to_portfolio?: number;
  max_correlated_holding?: {
    symbol: string;
    name: string;
    correlation: number;
  };
  target_min_vol_weight_pct?: number;
  target_equal_weight_pct?: number;
  weights?: Record<string, number>;
  equal_weight_baseline?: Record<string, number>;
  correlation_matrix?: Record<string, Record<string, number>>;
  optimized_metrics?: Record<string, number | string | null>;
  equal_weight_metrics?: Record<string, number | string | null>;
  coverage?: Record<string, unknown>;
  price_source?: string;
  missing_or_short_symbols?: string[];
  reason?: string;
  library?: string;
  library_version?: string | null;
  status?: string;
  research_only?: boolean;
  execution_allowed?: boolean;
}

export interface CashExecutionResearch {
  status: 'UNAVAILABLE' | 'BLOCKED' | 'SCENARIO_ONLY' | 'NOT_APPLICABLE';
  reason: string;
  execution_gate?: string | null;
  data_cutoff?: string | null;
  sample_start?: string | null;
  sample_end?: string | null;
  price_provider?: string | null;
  status_provider?: string | null;
  input_sha256?: string | null;
  observation_count: number;
  initial_cash_cny?: number | null;
  total_return_pct?: number | null;
  max_drawdown_pct?: number | null;
  filled_order_count?: number | null;
  blocked_order_count?: number | null;
  closed_trade_count?: number | null;
  closed_trade_win_rate_pct?: number | null;
  closed_trade_net_pnl_cny?: number | null;
  open_position_count?: number | null;
  warnings: string[];
  historical_vintage_verified: false;
  research_only: true;
  execution_allowed: false;
}

export interface ResearchPriceBand {
  low_cny: number;
  high_cny: number;
}

export interface ResearchPlaybook {
  status: 'UNAVAILABLE' | 'BLOCKED' | 'REFERENCE_ONLY' | 'CONDITIONAL_RESEARCH' | 'NOT_APPLICABLE';
  reason: string;
  subject_id: string;
  research_direction: string;
  reference_session?: string | null;
  reference_close_cny?: number | null;
  observed_at?: string | null;
  reference_band?: ResearchPriceBand | null;
  candidate_band?: ResearchPriceBand | null;
  valid_from?: string | null;
  valid_until?: string | null;
  confirmation_conditions: string[];
  invalidation_conditions: string[];
  counterevidence: string[];
  cost_assumptions: Record<string, number | string>;
  evidence_hashes: Record<string, string>;
  research_only: true;
  execution_allowed: false;
}

export interface DeepResearchCard {
  subject_id: string;
  subject_name: string;
  asset_type: string;
  as_of: string;
  decision_packet: OrthogonalDecisionPacket;
  account_snapshot_id?: string | null;
  account_snapshot_status?: string | null;
  account_snapshots?: Record<string, { snapshot_id?: string | null; status?: string | null }>;
  request_mode?: string;
  turnaround_report: TurnaroundAndTrapReport | null;
  asset_specific_metrics: Record<string, string>;
  opportunity_cost_matrix: OpportunityCostMatrixRow[];
  portfolio_correlation: PortfolioCorrelationSummary;
  kline_bars: KlineBarPoint[];
  kline_markers: KlineMarkerPoint[];
  kline_as_of?: string | null;
  kline_origin?: string;
  backtest_summary: BacktestSummaryViewModel | null;
  cash_execution_summary?: CashExecutionResearch | null;
  research_playbook?: ResearchPlaybook | null;
  subject_review_status?: string | null;
  subject_review_valid_until?: string | null;
  audit_claims: ClaimAuditRow[];
  header_badge: ProvenanceBadge;
  research_only: boolean;
  execution_allowed: boolean;
}

export interface RadarStockEntry {
  symbol: string;
  name: string;
  security_id: string;
  primary_lens: string;
  research_priority_score: number;
  ranking_semantics: string;
  state: string;
  turnaround_classification: ValueTrapClassification;
  turnaround_score: number;
  trap_risk_score: number;
  piotroski_f_score: number;
  altman_z_score: number;
  beneish_m_score: number;
  red_flag_titles: string[];
  summary: string;
  badge: ProvenanceBadge;
}

export interface RadarETFEntry {
  listed_security_id: string;
  symbol: string;
  name: string;
  etf_subtype: ETFSubtype;
  benchmark_or_index: string;
  market_price: number;
  reference_value: number;
  premium_discount_pct: number | null;
  tracking_error_or_excess: string;
  liquidity_spread_bps: number;
  fee_bps: number;
  lens_score: number;
  quality_status: string;
  summary: string;
  badge: ProvenanceBadge;
}

export interface RadarFundEntry {
  fund_code: string;
  fund_name: string;
  category: string;
  manager_tenure_years: number;
  rolling_excess_1y_pct: number;
  max_drawdown_recovery_days: number;
  style_consistency: string;
  fee_rate_pct: number;
  subscription_state: string;
  lens_score: number;
  summary: string;
  badge: ProvenanceBadge;
}

export interface RadarState {
  as_of: string;
  market_coverage?: import('@/components/expert/ObservationPanels').MarketCoverageView;
  observation_transport_cached?: boolean;
  turnaround_candidates: RadarStockEntry[];
  value_trap_warnings: RadarStockEntry[];
  stock_discovery: RadarStockEntry[];
  index_etfs: RadarETFEntry[];
  active_etfs: RadarETFEntry[];
  public_funds: RadarFundEntry[];
  snapshot_store_count: number;
  research_only: boolean;
  execution_allowed: boolean;
}

export interface GapAuditRow {
  requirement_id: string;
  disposition: string;
  resolved_claim_ids: string[];
  rationale: string;
}

export interface SnapshotManifestRow {
  dataset_id: string;
  snapshot_id: string;
  dataset_kind: string;
  research_as_of: string;
  row_count: number;
  content_sha256: string;
  verified: boolean;
}

export interface SourceHealthRow {
  source_name: string;
  category: string;
  status: string;
  crosscheck_mode: string;
  detail: string;
}

export interface AuditState {
  governance: GlobalGovernanceStatus;
  ledger_id: string;
  ledger_as_of: string;
  raw_ledger_sha256: string;
  manifest_ledger_match: boolean;
  internal_seal_match: boolean;
  model_rehash_match: boolean;
  hash_note: string;
  graph_id: string;
  graph_node_count: number;
  graph_relation_count: number;
  graph_conflicts: string[];
  graph_unknowns: string[];
  status_counts: Record<string, number>;
  kind_counts: Record<string, number>;
  claims: ClaimAuditRow[];
  gap_items: GapAuditRow[];
  conflict_rows: Array<Record<string, string>>;
  snapshots: SnapshotManifestRow[];
  source_health: SourceHealthRow[];
  research_only: boolean;
  execution_allowed: boolean;
}

export interface QuantStatsMetrics {
  sharpe: number;
  sortino: number;
  max_drawdown_pct: number;
  calmar: number;
  win_rate_pct: number;
  tail_ratio: number;
  var_95_pct: number;
  cvar_95_pct: number;
  cagr_pct: number;
  volatility_pct: number;
  total_return_pct: number;
  benchmark_total_return_pct: number;
  excess_return_pct: number;
  benchmark_sharpe: number;
  benchmark_max_drawdown_pct: number;
}

export interface QuantStatsSummary {
  account_id: string;
  account_name: string;
  as_of: string;
  total_asset_cny: number;
  holding_count: number;
  account_snapshot_id?: string | null;
  performance_basis?: string;
  benchmark_label: string;
  quantstats_version: string;
  metrics: QuantStatsMetrics;
  series: {
    dates: string[];
    strategy_cum_pct: number[];
    benchmark_cum_pct: number[];
    drawdown_pct: number[];
  };
  pypfopt_summary: PortfolioCorrelationSummary;
  manifest: Record<string, unknown>;
  html_path: string;
  html_content?: string;
  research_only: boolean;
  execution_allowed: boolean;
}

export interface NativeKlineWindowResponse {
  status: string;
  engine: string;
  payload_summary: {
    symbol: string;
    bars_count: number;
    research_only: boolean;
    execution_allowed: boolean;
  };
}

export const CLUSTER_LABELS_ZH: Record<OrthogonalCluster, string> = {
  VALUATION_AND_ODDS: '估值与赔率簇',
  FUNDAMENTAL_AND_QUALITY: '基本面与质量簇',
  PRICE_TREND_AND_FLOW: '价格趋势与资金簇',
  INDUSTRY_AND_CATALYST: '行业景气与催化簇',
  PORTFOLIO_AND_OPPORTUNITY_COST: '组合与机会成本簇',
};

export const ACTION_META: Record<
  DecisionAction,
  { labelZh: string; shortLabel: string; tone: 'rise' | 'fall' | 'accent' | 'warning' | 'muted' }
> = {
  BUY: { labelZh: '买入 (研究建议)', shortLabel: 'BUY', tone: 'rise' },
  HOLD: { labelZh: '持有观察', shortLabel: 'HOLD', tone: 'accent' },
  SELL: { labelZh: '卖出/减仓建议', shortLabel: 'SELL', tone: 'fall' },
  WAIT: { labelZh: '等待观察', shortLabel: 'WAIT', tone: 'warning' },
  INSUFFICIENT_EVIDENCE: {
    labelZh: '证据不足 (Fail-Closed)',
    shortLabel: 'BLOCKED',
    tone: 'muted',
  },
};

export function extractSubjectSixDigits(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/^(?:sh|sz|bj)?\.?(\d{6})(?:\.(?:sh|sz|bj))?$/i);
  return m ? m[1] : trimmed.toUpperCase();
}

export function normalizeResearchSubjectId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.toUpperCase() === '000999_TRAP') return '000999_TRAP';
  if (trimmed.toUpperCase() === '511090_ACT') return '511090_ACT';
  const prefixMatch = trimmed.match(/^(sh|sz|bj)\.?(\d{6})$/i);
  if (prefixMatch) {
    return `${prefixMatch[1].toLowerCase()}${prefixMatch[2]}`;
  }
  const suffixMatch = trimmed.match(/^(\d{6})\.(sh|sz|bj)$/i);
  if (suffixMatch) {
    return `${suffixMatch[2].toLowerCase()}${suffixMatch[1]}`;
  }
  if (/^\d{6}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = parseStockCode(trimmed);
  if (parsed.market && parsed.symbol) {
    return `${parsed.market}${parsed.symbol}`;
  }
  return trimmed.toUpperCase();
}

export function toStockDetailRoute(subjectId: string): string | null {
  const clean = normalizeResearchSubjectId(subjectId);
  if (/^(sh|sz|bj)\d{6}$/i.test(clean)) {
    return `/s/${clean.toLowerCase()}`;
  }
  if (!/^\d{6}$/.test(clean)) return null;
  if (clean.startsWith('51') || clean.startsWith('56') || clean.startsWith('58')) {
    return `/s/sh${clean}`;
  }
  if (clean.startsWith('159')) {
    return `/s/sz${clean}`;
  }
  if (clean.startsWith('6') || clean.startsWith('0') || clean.startsWith('3')) {
    return `/s/${normalizeStockCode(clean)}`;
  }
  if (clean.startsWith('4') || clean.startsWith('8') || clean.startsWith('92')) {
    return `/s/bj${clean}`;
  }
  return `/s/${clean}`;
}

async function requestJson<T>(
  url: string,
  options?: { method?: 'GET' | 'POST'; signal?: AbortSignal; fallbackToCache?: boolean }
): Promise<T> {
  return apiRequestJson<T>(url, options);
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/api/health', { signal, fallbackToCache: false });
}

export function fetchWorkbench(signal?: AbortSignal): Promise<WorkbenchState> {
  return requestJson<WorkbenchState>('/api/workbench', { signal });
}

export function guardSubjectReview(card: DeepResearchCard, now: number, responseFresh: boolean): DeepResearchCard {
  if (card.subject_review_status !== 'REVIEW_VERIFIED' && card.subject_review_status !== 'REVIEW_GAPS') return card;
  const expiry = Date.parse(card.subject_review_valid_until ?? '');
  if (responseFresh && Number.isFinite(expiry) && expiry > now) return card;
  const packet = card.decision_packet;
  return {
    ...card,
    subject_review_status: 'SUBJECT_REVIEW_REFRESH_REQUIRED',
    audit_claims: [],
    opportunity_cost_matrix: [],
    asset_specific_metrics: {
      ...card.asset_specific_metrics,
      ...('替代机会证据' in (card.asset_specific_metrics ?? {}) ? { '替代机会证据': '独立审查已失效；已撤回同口径比较，需重新核验' } : {}),
      ...('正式准入状态' in (card.asset_specific_metrics ?? {}) ? { '正式准入状态': 'SUBJECT_REVIEW_REFRESH_REQUIRED' } : {}),
    },
    research_playbook: card.research_playbook ? {
      ...card.research_playbook,
      status: card.research_playbook.reference_band ? 'REFERENCE_ONLY' : 'BLOCKED',
      reason: '独立审查失效；仅保留原历史价格参考，撤回方向性价带',
      research_direction: 'WAIT',
      candidate_band: null,
      valid_from: null,
      valid_until: null,
      counterevidence: ['独立审查已失效'],
      confirmation_conditions: [],
      invalidation_conditions: [],
    } : card.research_playbook,
    decision_packet: {
      ...packet,
      admission_state: 'NOT_ADMITTED',
      action: packet.action === 'INSUFFICIENT_EVIDENCE' ? packet.action : 'WAIT',
      action_label_zh: packet.action === 'INSUFFICIENT_EVIDENCE' ? packet.action_label_zh : '等待',
      admission_blockers: [...(packet.admission_blockers ?? []), 'SUBJECT_REVIEW_REFRESH_OR_EXPIRY_REQUIRED'],
      research_action: null,
      supporting_clusters_count: 0,
      contradicting_clusters_count: 0,
      unknown_clusters_count: 5,
      composite_conviction_score: 0,
      supporting_reasons: [],
      counter_reasons: ['独立审查已失效；旧证据不能用于当前方向判断'],
      red_flag_blockers: [],
      unresolved_gaps: ['重新核验当前标的及独立证据'],
      change_triggers: ['重新获取当前观察并完成独立审查'],
      cluster_votes: [],
    },
  };
}

export async function fetchResearchCard(
  subjectId: string,
  signal?: AbortSignal,
  assetType?: string,
  liveStock = false
): Promise<DeepResearchCard> {
  const normalized = normalizeResearchSubjectId(subjectId);
  const params = new URLSearchParams();
  if (assetType) params.set('asset_type', assetType);
  if (liveStock) params.set('live_stock', 'true');
  const query = params.size ? `?${params}` : '';
  let responseFresh = true;
  const card = await apiRequestJson<DeepResearchCard>(
    `/api/research/${encodeURIComponent(normalized)}${query}`,
    { signal, fallbackToCache: !liveStock, onCacheFallback: () => { responseFresh = false; } }
  );
  return guardSubjectReview(card, Date.now(), responseFresh);
}

export async function fetchRadar(signal?: AbortSignal): Promise<RadarState> {
  let cached = false;
  const data = await apiRequestJson<RadarState>('/api/radar', {signal, onCacheFallback: () => {cached = true;}});
  return {...data, observation_transport_cached: cached};
}

export function fetchAudit(signal?: AbortSignal): Promise<AuditState> {
  return requestJson<AuditState>('/api/audit', { signal });
}

export function fetchQuantStatsJson(
  accountId = 'STK-ALIPAY-001',
  signal?: AbortSignal
): Promise<QuantStatsSummary> {
  const query = new URLSearchParams({ account_id: accountId, format: 'json' });
  return requestJson<QuantStatsSummary>(`/api/quantstats/tearsheet?${query.toString()}`, {
    signal,
  });
}

export function getQuantStatsHtmlUrl(accountId = 'STK-ALIPAY-001'): string {
  const query = new URLSearchParams({ account_id: accountId, format: 'html' });
  return `/api/quantstats/tearsheet?${query.toString()}`;
}

export function fetchQuantStatsHtml(
  accountId = 'STK-ALIPAY-001',
  signal?: AbortSignal
): Promise<string> {
  return apiRequestText(getQuantStatsHtmlUrl(accountId), { signal });
}

export function fetchMobilePairing(
  mobilePort = 8502,
  signal?: AbortSignal
): Promise<MobilePairingInfo> {
  const query = new URLSearchParams({ mobile_port: String(mobilePort) });
  return requestJson<MobilePairingInfo>(`/api/mobile/pairing?${query.toString()}`, {
    signal,
    fallbackToCache: false,
  });
}

export function fetchWebBundleManifest(signal?: AbortSignal): Promise<WebBundleManifest> {
  return requestJson<WebBundleManifest>('/api/mobile/web-bundle/manifest', {
    signal,
    fallbackToCache: false,
  });
}

export function fetchLatestAppRelease(signal?: AbortSignal): Promise<AppReleaseInfo> {
  return requestJson<AppReleaseInfo>('/api/mobile/app-release/latest', {
    signal,
    fallbackToCache: false,
  });
}

export interface PitSyncResponse {
  status: string;
  store_dir: string;
  snapshot_id: string;
  dataset_count: number;
  total_rows: number;
  synced_at: string;
}

export function triggerPitSync(): Promise<PitSyncResponse> {
  return requestJson<PitSyncResponse>('/api/market/pit-sync', {
    method: 'POST',
    fallbackToCache: false,
  });
}

export function openNativeKlineWindow(
  subjectId: string,
  launch = true
): Promise<NativeKlineWindowResponse> {
  const normalized = normalizeResearchSubjectId(subjectId);
  const query = new URLSearchParams({ launch: String(launch) });
  return requestJson<NativeKlineWindowResponse>(
    `/api/lwc/native-window/${encodeURIComponent(normalized)}?${query.toString()}`,
    { method: 'POST', fallbackToCache: false }
  );
}

