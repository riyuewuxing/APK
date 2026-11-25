/**
 * Stage 4 M4 只读研究接口客户端：
 * - GET /api/research/{subjectId}/minesweeper（30 条财报与近 90 天公告排雷体检）
 * - GET /api/research/{subjectId}/debate（四视角多空对抗辩论结构视图）
 * 统一经 apiClient 走桌面同源 / 移动 Bearer / 离线快照降级。
 */
import { apiRequestJson } from './apiClient';
import type { VerificationStatus } from './expertApi';

export type MinesweeperRuleStatus = 'PASS' | 'WARN' | 'RED_FLAG' | 'UNKNOWN';
export type MinesweeperCategoryKey =
  | 'BALANCE_SHEET'
  | 'PROFIT_CASHFLOW'
  | 'GOVERNANCE_DISCLOSURE';

export interface MinesweeperRuleItem {
  rule_id: string;
  category: MinesweeperCategoryKey;
  category_zh: string;
  title_zh: string;
  status: MinesweeperRuleStatus;
  metric_display: string;
  threshold_desc: string;
  detail: string;
  missing_fields: string[];
  evidence_source: string;
}

export interface MinesweeperCategorySummary {
  category: MinesweeperCategoryKey;
  label: string;
  total: number;
  red_flag: number;
  warn: number;
  unknown: number;
  pass: number;
}

export interface FilingMinesweeperReport {
  symbol: string;
  subject_id: string;
  subject_name: string;
  asset_type: string;
  asset_semantic_isolated: boolean;
  as_of: string;
  report_date: string | null;
  report_name: string | null;
  overall_status: 'CLEAN' | 'WARN' | 'RED_FLAG' | 'UNKNOWN' | 'NOT_APPLICABLE';
  risk_score: number | null;
  rules_total: number;
  red_flag_count: number;
  warn_count: number;
  unknown_count: number;
  pass_count: number;
  categories: MinesweeperCategorySummary[];
  rules: MinesweeperRuleItem[];
  recent_disclosures: Array<{ title: string; date: string; url?: string }>;
  pledge_ratio_pct: number | null;
  restricted_unlock_pct: number | null;
  data_sources: Record<string, string>;
  notice: string;
  research_only: true;
  execution_allowed: false;
}

export type DebatePerspectiveKey =
  | 'BULL_FUNDAMENTAL'
  | 'TREND_FLOW_STRUCTURE'
  | 'DEVILS_ADVOCATE'
  | 'OPPORTUNITY_COST';

export interface DebateArgument {
  argument_id: string;
  perspective: DebatePerspectiveKey;
  claim_id: string;
  verification_status: VerificationStatus;
  source_id: string;
  as_of: string;
  stance: 'SUPPORT' | 'OPPOSE' | 'CAUTION' | 'UNKNOWN';
  headline: string;
  detail: string;
}

export interface DebatePerspectiveBlock {
  perspective: DebatePerspectiveKey;
  title_zh: string;
  role_summary: string;
  supported_count: number;
  caution_or_unknown_count: number;
  arguments: DebateArgument[];
}

export interface DebateSynthesisReport {
  subject_id: string;
  subject_name: string;
  asset_type: string;
  as_of: string;
  claim_ledger_status: string;
  action_lock: string;
  action_label_zh: string;
  research_action?: string | null;
  admission_state?: string;
  account_snapshot_id?: string | null;
  composite_conviction_score: number;
  minesweeper_overall_status: string;
  minesweeper_red_flags: number;
  minesweeper_warn_count: number;
  minesweeper_unknown_count: number;
  perspectives: DebatePerspectiveBlock[];
  dominant_tension: string;
  change_triggers: string[];
  research_only: true;
  execution_allowed: false;
}

export const MINESWEEPER_OVERALL_LABELS: Record<
  FilingMinesweeperReport['overall_status'],
  string
> = {
  CLEAN: '30条体检通过',
  WARN: '存在财务/治理预警',
  RED_FLAG: '触发高风险红旗',
  UNKNOWN: '核心财务字段缺失 (UNKNOWN)',
  NOT_APPLICABLE: '资产语义隔离 (非公司三表)',
};

export const RULE_STATUS_LABELS: Record<MinesweeperRuleStatus, string> = {
  RED_FLAG: '红旗',
  WARN: '预警',
  UNKNOWN: '未知',
  PASS: '通过',
};

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  SUPPORTED: 'SUPPORTED',
  CONFLICTED: 'CONFLICTED',
  UNVERIFIED: 'UNVERIFIED',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
  REJECTED: 'REJECTED',
};

export const STANCE_LABELS: Record<DebateArgument['stance'], string> = {
  SUPPORT: '支持',
  OPPOSE: '反对',
  CAUTION: '审慎',
  UNKNOWN: '待证',
};

export function fetchFilingMinesweeper(
  subjectId: string,
  signal?: AbortSignal,
  assetType?: string
): Promise<FilingMinesweeperReport> {
  const qs = assetType ? `?asset_type=${encodeURIComponent(assetType)}` : '';
  return apiRequestJson<FilingMinesweeperReport>(
    `/api/research/${encodeURIComponent(subjectId)}/minesweeper${qs}`,
    { signal }
  );
}

export function fetchDebateSynthesis(
  subjectId: string,
  signal?: AbortSignal,
  assetType?: string
): Promise<DebateSynthesisReport> {
  const qs = assetType ? `?asset_type=${encodeURIComponent(assetType)}` : '';
  return apiRequestJson<DebateSynthesisReport>(
    `/api/research/${encodeURIComponent(subjectId)}/debate${qs}`,
    { signal }
  );
}
