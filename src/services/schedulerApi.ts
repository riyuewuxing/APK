/**
 * Stage 4 M5 定时守护自动化与简报只读/配置客户端。
 * 统一经 apiClient 走桌面同源直连或移动端 Bearer 双通道（服务端在 mobile_remote 下对所有写入接口返回 403）。
 */
import { apiRequestJson } from './apiClient';

export type WebhookType = 'none' | 'wecom' | 'feishu' | 'dingtalk' | 'custom_json';
export type TaskType = 'EOD_SCAN_1445' | 'POST_CLOSE_1535' | 'TEST_WEBHOOK';
export type RunStatus =
  | 'OK'
  | 'SKIPPED_NON_TRADING_DAY'
  | 'SKIPPED_CALENDAR_UNAVAILABLE'
  | 'DEGRADED'
  | 'ERROR';

export interface EodSchemeFilters {
  scheme_name: string;
  market_cap_min: number;
  market_cap_max: number | null;
  volume_ratio_min: number;
  change_percent_min: number;
  change_percent_max: number | null;
  turnover_rate_min: number;
  turnover_rate_max: number | null;
  exclude_st: boolean;
  max_candidates: number;
}

export interface SchedulerRunRecord {
  run_id: string;
  task_type: TaskType;
  triggered_at: string;
  trade_date: string;
  status: RunStatus;
  summary_title: string;
  summary_text: string;
  regime: string | null;
  candidate_count: number;
  candidates: Array<Record<string, unknown>>;
  red_flag_alerts: Array<Record<string, unknown>>;
  notification_dispatched: boolean;
  webhook_dispatched: boolean;
  error: string | null;
}

export interface TrayBadge {
  level: 'idle' | 'ok' | 'warn' | 'alert';
  text: string;
}

export interface SchedulerStatusView {
  enabled: boolean;
  daemon_running: boolean;
  is_readonly_view: boolean;
  config_path: string;
  eod_scan_time: string;
  post_close_time: string;
  auto_record_journal: boolean;
  auto_settle_journal: boolean;
  windows_notify_enabled: boolean;
  webhook_type: WebhookType;
  webhook_configured: boolean;
  webhook_url_masked: string;
  webhook_verified: boolean;
  eod_scheme: EodSchemeFilters;
  watchlist_codes: string[];
  poll_interval_seconds: number;
  last_eod_scan_date: string | null;
  last_post_close_date: string | null;
  tray_badge: TrayBadge;
  latest_briefing: SchedulerRunRecord | null;
  recent_runs: SchedulerRunRecord[];
  research_only: true;
  execution_allowed: false;
}

export interface SchedulerConfigUpdate {
  enabled?: boolean;
  eod_scan_time?: string;
  post_close_time?: string;
  auto_record_journal?: boolean;
  auto_settle_journal?: boolean;
  windows_notify_enabled?: boolean;
  webhook_type?: WebhookType;
  webhook_url?: string | null;
  eod_scheme?: EodSchemeFilters;
  watchlist_codes?: string[];
  poll_interval_seconds?: number;
}

export interface SchedulerActionResult {
  record: SchedulerRunRecord;
  status: SchedulerStatusView;
}

export const WEBHOOK_TYPE_LABELS: Record<WebhookType, string> = {
  none: '不启用外部 Webhook',
  wecom: '企业微信机器人 Webhook',
  feishu: '飞书自定义机器人 Webhook',
  dingtalk: '钉钉自定义机器人 Webhook',
  custom_json: '通用只读 JSON Webhook',
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  OK: '执行成功',
  SKIPPED_NON_TRADING_DAY: '休市跳过',
  SKIPPED_CALENDAR_UNAVAILABLE: '日历不可用跳过',
  DEGRADED: '部分降级',
  ERROR: '执行失败',
};

export function fetchSchedulerStatus(signal?: AbortSignal): Promise<SchedulerStatusView> {
  return apiRequestJson<SchedulerStatusView>('/api/scheduler/status', { signal });
}

export function saveSchedulerConfig(
  payload: SchedulerConfigUpdate
): Promise<SchedulerStatusView> {
  return apiRequestJson<SchedulerStatusView>('/api/scheduler/config', {
    method: 'POST',
    body: payload,
    fallbackToCache: false,
  });
}

export function testSchedulerWebhook(payload: {
  webhook_type?: WebhookType;
  webhook_url?: string;
}): Promise<SchedulerActionResult> {
  return apiRequestJson<SchedulerActionResult>('/api/scheduler/test-webhook', {
    method: 'POST',
    body: payload,
    fallbackToCache: false,
  });
}

export function runSchedulerTaskNow(task: 'eod' | 'post_close'): Promise<SchedulerActionResult> {
  return apiRequestJson<SchedulerActionResult>('/api/scheduler/run-now', {
    method: 'POST',
    body: { task },
    fallbackToCache: false,
  });
}
