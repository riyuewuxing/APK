/**
 * 尾盘选股 2.0 后端 API 服务层。
 * 全部经 apiClient 统一通道（桌面同源 / 移动 Bearer / 离线快照横幅）。
 * 输出仅用于候选研究与安检（CANDIDATE_VETTING_ONLY），不构成买卖指令。
 */
import { apiRequestJson } from './apiClient';

export type EodRegime = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
export type VettingStatus = 'CLEAN' | 'WARNING' | 'TRAP_FLAGGED' | 'UNKNOWN';

export interface EodRegimeSnapshot {
  regime: EodRegime;
  trade_date: string | null;
  as_of: string | null;
  data_available: boolean;
  advance_ratio_pct: number | null;
  broken_board_rate_pct: number | null;
  limit_up_count: number | null;
  broken_board_count: number | null;
  limit_down_count: number | null;
  max_streak_height: number | null;
  note: string;
  source: string | null;
  research_only: boolean;
  execution_allowed: boolean;
}

export interface EodStructureFactors {
  code: string;
  tail_30m_return_pct: number | null;
  tail_30m_amount_share_pct: number | null;
  intraday_drawback_pct: number | null;
  timeline_above_avg_ratio: number | null;
  timeline_average_basis?: string | null;
  chip_profit_ratio_approx: number | null;
  overhead_pressure_pct: number | null;
  chip_known_coverage_pct?: number | null;
  chip_unknown_pct?: number | null;
  chip_break_even_pct?: number | null;
  chip_bin_sensitivity_pp?: number | null;
  main_net_inflow_10k: number | null;
  board_resonance: number | null;
  chip_estimate_basis: string;
  available: boolean;
  unavailable_reasons: string[];
}

export interface EodVetting {
  code: string;
  name: string;
  vetting_status: VettingStatus;
  flags: string[];
  as_of: string | null;
  research_route: string;
  disclaimer: string;
}

export interface EodAnalyzeItem {
  code: string;
  name: string;
  pick_price: number;
  change_percent: number | null;
  structure_factors: EodStructureFactors;
  vetting: EodVetting;
}

export interface EodAnalyzeResponse {
  items: EodAnalyzeItem[];
  count: number;
  as_of: string;
  disclaimer: string;
  research_only: boolean;
  execution_allowed: boolean;
}

export interface EodAnalyzeCandidate {
  code: string;
  name?: string;
  pick_price: number;
  change_percent?: number | null;
  timeline?: Array<{ time: string; price: number; avgPrice: number; amount?: number }>;
  daily_bars?: Array<Record<string, unknown>>;
  fund_flow?: Array<Record<string, unknown>>;
  board_change_pct?: number | null;
  tail_30m_return_pct?: number | null;
  tail_30m_amount_share_pct?: number | null;
  vetting_status?: string | null;
}

export interface EodSettlement {
  price_basis?: "LEGACY_UNVERIFIED" | "RAW_REFERENCE_GROSS";
  t1_date: string | null;
  t1_open_premium_pct: number | null;
  t1_high_return_pct: number | null;
  t1_close_return_pct: number | null;
  t3_date: string | null;
  t3_close_return_pct: number | null;
  status: 'PENDING' | 'PARTIAL' | 'SETTLED' | 'UNKNOWN';
}

export interface EodJournalCandidate {
  code: string;
  name: string;
  pick_price: number;
  change_percent: number | null;
  tail_30m_return_pct: number | null;
  tail_30m_amount_share_pct: number | null;
  vetting_status: VettingStatus | null;
  settlement: EodSettlement;
}

export interface EodJournalSnapshot {
  journal_version: number;
  snapshot_id: string;
  trade_date: string;
  created_at: string;
  recorded_at?: string | null;
  record_basis?: "LEGACY_UNVERIFIED" | "CLIENT_REFERENCE_ONLY";
  scheme_name: string;
  filters: Record<string, unknown>;
  market_regime: EodRegime;
  candidates: EodJournalCandidate[];
  research_only: boolean;
  execution_allowed: boolean;
}

export interface EodWinRateStats {
  sample_count: number;
  settled_count: number;
  legacy_excluded_count?: number;
  t1_open_observation_count?: number;
  t1_close_observation_count?: number;
  t3_close_observation_count?: number;
  statistics_basis?: "RAW_REFERENCE_GROSS_NOT_TRADE_WIN_RATE";
  t1_open_win_rate_pct: number | null;
  t1_close_win_rate_pct: number | null;
  t3_close_win_rate_pct: number | null;
  avg_open_premium_pct: number | null;
  profit_loss_ratio: number | null;
}

export interface EodSchemeStats {
  scheme_name: string;
  overall: EodWinRateStats;
  by_regime: Record<string, EodWinRateStats>;
}

export interface EodJournalResponse {
  snapshots: EodJournalSnapshot[];
  stats: {
    generated_at: string;
    snapshot_count: number;
    candidate_count: number;
    schemes: EodSchemeStats[];
    research_only: boolean;
    execution_allowed: boolean;
  };
  journal_path: string;
  research_only: boolean;
  execution_allowed: boolean;
}

export function fetchEodRegime(signal?: AbortSignal): Promise<EodRegimeSnapshot> {
  return apiRequestJson<EodRegimeSnapshot>('/api/eod/regime', { signal, fallbackToCache: false });
}

export function postEodAnalyzeVetting(
  candidates: EodAnalyzeCandidate[],
  tradeDate: string,
  signal?: AbortSignal
): Promise<EodAnalyzeResponse> {
  return apiRequestJson<EodAnalyzeResponse>('/api/eod/analyze-vetting', {
    method: 'POST',
    body: { candidates, trade_date: tradeDate },
    signal,
  });
}

export function fetchEodJournal(signal?: AbortSignal): Promise<EodJournalResponse> {
  return apiRequestJson<EodJournalResponse>('/api/eod/journal', { signal, fallbackToCache: false });
}

export function postEodJournalRecord(snapshot: EodJournalSnapshot): Promise<{ written: boolean; snapshot_id: string }> {
  return apiRequestJson<{ written: boolean; snapshot_id: string }>('/api/eod/journal/record', {
    method: 'POST',
    body: { snapshot },
  });
}

export function postEodJournalSettle(): Promise<{ changed: number; stats: EodJournalResponse['stats'] }> {
  return apiRequestJson<{ changed: number; stats: EodJournalResponse['stats'] }>('/api/eod/journal/settle', {
    method: 'POST',
    body: {},
  });
}
