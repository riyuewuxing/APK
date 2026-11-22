import { useEffect, useState, useSyncExternalStore } from 'react';
import { BellRing, Play, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { Button, Card, useToast } from '@/components/common';
import { isMobileViewport, isNativeApp } from '@/platform/runtime';
import { shouldUseRemoteDualChannel } from '@/services/apiClient';
import {
  RUN_STATUS_LABELS,
  WEBHOOK_TYPE_LABELS,
  fetchSchedulerStatus,
  runSchedulerTaskNow,
  saveSchedulerConfig,
  testSchedulerWebhook,
  type EodSchemeFilters,
  type SchedulerStatusView,
  type WebhookType,
} from '@/services/schedulerApi';
import { selectAllCodes, watchlistStore } from '@/services/watchlistStore';
import styles from './Settings.module.css';

interface DraftConfig {
  enabled: boolean;
  eodScanTime: string;
  postCloseTime: string;
  autoRecordJournal: boolean;
  autoSettleJournal: boolean;
  windowsNotifyEnabled: boolean;
  webhookType: WebhookType;
  webhookUrlInput: string;
  eodScheme: EodSchemeFilters;
  watchlistCodes: string[];
}

function toDraft(st: SchedulerStatusView): DraftConfig {
  return {
    enabled: st.enabled,
    eodScanTime: st.eod_scan_time,
    postCloseTime: st.post_close_time,
    autoRecordJournal: st.auto_record_journal,
    autoSettleJournal: st.auto_settle_journal,
    windowsNotifyEnabled: st.windows_notify_enabled,
    webhookType: st.webhook_type,
    webhookUrlInput: '',
    eodScheme: { ...st.eod_scheme },
    watchlistCodes: [...st.watchlist_codes],
  };
}

function badgeToneClass(level: SchedulerStatusView['tray_badge']['level']): string {
  if (level === 'ok') return styles.mobileStatusOk;
  if (level === 'warn' || level === 'alert') return styles.mobileStatusWarn;
  return styles.mobileStatusMuted;
}

export function SchedulerSettingsCard() {
  const toast = useToast();
  const wlSnap = useSyncExternalStore(watchlistStore.subscribe, watchlistStore.getSnapshot);
  const allWatchlistCodes = selectAllCodes(wlSnap);

  const [status, setStatus] = useState<SchedulerStatusView | null>(null);
  const [draft, setDraft] = useState<DraftConfig | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadStatus = (signal?: AbortSignal) =>
    fetchSchedulerStatus(signal)
      .then((res) => {
        setStatus(res);
        setDraft(toDraft(res));
        setLoadErr(null);
      })
      .catch((err: unknown) => {
        if (signal?.aborted) return;
        setLoadErr(err instanceof Error ? err.message : '加载定时自动化状态失败');
      });

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, []);

  const isReadonlyMobile = Boolean(
    isNativeApp() || isMobileViewport() || shouldUseRemoteDualChannel() || status?.is_readonly_view
  );

  const handleSave = async () => {
    if (!draft || isReadonlyMobile) return;
    setBusyAction('save');
    try {
      const updated = await saveSchedulerConfig({
        enabled: draft.enabled,
        eod_scan_time: draft.eodScanTime,
        post_close_time: draft.postCloseTime,
        auto_record_journal: draft.autoRecordJournal,
        auto_settle_journal: draft.autoSettleJournal,
        windows_notify_enabled: draft.windowsNotifyEnabled,
        webhook_type: draft.webhookType,
        webhook_url: draft.webhookUrlInput.trim() ? draft.webhookUrlInput.trim() : null,
        eod_scheme: draft.eodScheme,
        watchlist_codes: draft.watchlistCodes,
      });
      setStatus(updated);
      setDraft(toDraft(updated));
      toast.success('盘中/盘后自动化配置已保存到仓外本地目录');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '保存定时设置失败');
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestWebhook = async () => {
    if (!draft || isReadonlyMobile) return;
    setBusyAction('webhook');
    try {
      const res = await testSchedulerWebhook({
        webhook_type: draft.webhookType,
        webhook_url: draft.webhookUrlInput.trim() || undefined,
      });
      setStatus(res.status);
      setDraft(toDraft(res.status));
      if (res.record.status === 'OK') {
        toast.success(`测试消息发送成功 (${res.record.summary_text})`);
      } else {
        toast.error(res.record.error || res.record.summary_text || 'Webhook 测试失败');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Webhook 测试请求失败');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunNow = async (task: 'eod' | 'post_close') => {
    if (isReadonlyMobile) return;
    setBusyAction(task);
    try {
      const res = await runSchedulerTaskNow(task);
      setStatus(res.status);
      setDraft(toDraft(res.status));
      toast.success(res.record.summary_title);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '手动试跑定时任务失败');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncWatchlist = () => {
    if (!draft) return;
    setDraft({ ...draft, watchlistCodes: allWatchlistCodes });
    toast.info(`已勾选 ${allWatchlistCodes.length} 只本地自选股，点击保存配置生效`);
  };

  return (
    <Card>
      <div className={styles.section} data-testid="scheduler-settings-card">
        <div className={styles.sectionHeader}>
          <BellRing size={18} className={styles.sectionIcon} />
          <h3>盘中/盘后自动化简报（14:45 扫池 · 15:35 复盘 · 只研不下单）</h3>
        </div>

        <div className={styles.sectionContent}>
          {loadErr ? (
            <div className={styles.pairingBox}>
              <span className={styles.signingWarnText}>{loadErr}</span>
              <div className={styles.mobileActionRow}>
                <Button
                  size="sm"
                  icon={<RefreshCw size={14} />}
                  onClick={() => {
                    void loadStatus();
                  }}
                >
                  重试读取状态
                </Button>
              </div>
            </div>
          ) : !status || !draft ? (
            <div className={styles.settingDesc}>正在读取本地守护任务与简报摘要...</div>
          ) : (
            <>
              <div className={styles.mobileStatusRow}>
                <span className={`${styles.mobileStatusBadge} ${badgeToneClass(status.tray_badge.level)}`}>
                  <ShieldCheck size={14} />
                  <span>{status.tray_badge.text}</span>
                </span>
                <span
                  className={`${styles.mobileStatusBadge} ${status.daemon_running ? styles.mobileStatusOk : styles.mobileStatusMuted}`}
                >
                  {status.daemon_running ? '后台守护运行中' : status.enabled ? '已启用（待周期启动）' : '后台守护未开启'}
                </span>
                <span className={styles.paramValue}>
                  触发窗口: {status.eod_scan_time} 扫池 / {status.post_close_time} 复盘
                </span>
              </div>

              {isReadonlyMobile ? (
                <div className={styles.pairingBox} data-testid="scheduler-readonly-banner">
                  <strong>电脑端守护任务只读状态（移动端防误改写保护）</strong>
                  <div className={styles.pairingMetaGrid}>
                    <div>
                      <span className={styles.pairingMetaLabel}>启用状态</span>
                      <code>{status.enabled ? '已启用' : '未启用'}</code>
                    </div>
                    <div>
                      <span className={styles.pairingMetaLabel}>最近 14:45 扫池</span>
                      <code>{status.last_eod_scan_date ?? '尚未运行'}</code>
                    </div>
                    <div>
                      <span className={styles.pairingMetaLabel}>最近 15:35 复盘</span>
                      <code>{status.last_post_close_date ?? '尚未运行'}</code>
                    </div>
                    <div>
                      <span className={styles.pairingMetaLabel}>外部 Webhook</span>
                      <code>
                        {status.webhook_configured
                          ? `${status.webhook_url_masked} (${status.webhook_verified ? '已验证' : '未验证'})`
                          : '未配置'}
                      </code>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.otaBox} data-testid="scheduler-desktop-form">
                  <div className={styles.schedulerCheckRow}>
                    <label className={styles.schedulerCheckLabel}>
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                      />
                      <span>启用本机静默守护（仅交易日触发）</span>
                    </label>
                    <label className={styles.schedulerCheckLabel}>
                      <input
                        type="checkbox"
                        checked={draft.autoRecordJournal}
                        onChange={(e) => setDraft({ ...draft, autoRecordJournal: e.target.checked })}
                      />
                      <span>14:45 自动记入 EodOutcomeJournal</span>
                    </label>
                    <label className={styles.schedulerCheckLabel}>
                      <input
                        type="checkbox"
                        checked={draft.autoSettleJournal}
                        onChange={(e) => setDraft({ ...draft, autoSettleJournal: e.target.checked })}
                      />
                      <span>15:35 自动结算历史 T+1/T+3</span>
                    </label>
                    <label className={styles.schedulerCheckLabel}>
                      <input
                        type="checkbox"
                        checked={draft.windowsNotifyEnabled}
                        onChange={(e) => setDraft({ ...draft, windowsNotifyEnabled: e.target.checked })}
                      />
                      <span>Windows 本机 Toast 通知</span>
                    </label>
                  </div>

                  <div className={styles.mobileFormGrid}>
                    <div className={styles.mobileFieldGroup}>
                      <span className={styles.settingLabel}>尾盘扫池时间 (HH:MM)</span>
                      <input
                        className={styles.mobileFullInput}
                        value={draft.eodScanTime}
                        onChange={(e) => setDraft({ ...draft, eodScanTime: e.target.value })}
                        placeholder="14:45"
                      />
                    </div>
                    <div className={styles.mobileFieldGroup}>
                      <span className={styles.settingLabel}>盘后复盘时间 (HH:MM)</span>
                      <input
                        className={styles.mobileFullInput}
                        value={draft.postCloseTime}
                        onChange={(e) => setDraft({ ...draft, postCloseTime: e.target.value })}
                        placeholder="15:35"
                      />
                    </div>
                    <div className={styles.mobileFieldGroup}>
                      <span className={styles.settingLabel}>Webhook 类型（仅显式测试后启用）</span>
                      <select
                        className={styles.select}
                        value={draft.webhookType}
                        onChange={(e) => setDraft({ ...draft, webhookType: e.target.value as WebhookType })}
                      >
                        {(Object.keys(WEBHOOK_TYPE_LABELS) as WebhookType[]).map((k) => (
                          <option key={k} value={k}>
                            {WEBHOOK_TYPE_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.mobileFieldGroup}>
                      <span className={styles.settingLabel}>
                        Webhook URL（存仓外 {status.webhook_verified ? '· 已测通' : '· 未验证'}）
                      </span>
                      <input
                        className={styles.mobileFullInput}
                        type="password"
                        value={draft.webhookUrlInput}
                        onChange={(e) => setDraft({ ...draft, webhookUrlInput: e.target.value })}
                        placeholder={status.webhook_configured ? `${status.webhook_url_masked}（留空保持不变）` : 'https://...'}
                      />
                    </div>
                  </div>

                  <div className={styles.settingDesc}>
                    默认方案「{draft.eodScheme.scheme_name}」：流通市值 {draft.eodScheme.market_cap_min}~
                    {draft.eodScheme.market_cap_max ?? '∞'} 亿 · 涨幅 {draft.eodScheme.change_percent_min}~
                    {draft.eodScheme.change_percent_max ?? '∞'}% · 换手 {draft.eodScheme.turnover_rate_min}~
                    {draft.eodScheme.turnover_rate_max ?? '∞'}% · 量比 ≥ {draft.eodScheme.volume_ratio_min} · 最多 Top{' '}
                    {draft.eodScheme.max_candidates} · 自选监控 {draft.watchlistCodes.length} 只
                  </div>

                  <div className={styles.mobileActionRow}>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busyAction === 'save'}
                      data-testid="scheduler-save-btn"
                      onClick={() => {
                        void handleSave();
                      }}
                    >
                      保存配置
                    </Button>
                    <Button
                      size="sm"
                      icon={<Send size={14} />}
                      loading={busyAction === 'webhook'}
                      data-testid="scheduler-test-webhook-btn"
                      onClick={() => {
                        void handleTestWebhook();
                      }}
                    >
                      发送测试消息
                    </Button>
                    <Button size="sm" onClick={handleSyncWatchlist}>
                      同步自选股 ({allWatchlistCodes.length})
                    </Button>
                    <Button
                      size="sm"
                      icon={<Play size={14} />}
                      loading={busyAction === 'eod'}
                      data-testid="scheduler-run-eod-btn"
                      onClick={() => {
                        void handleRunNow('eod');
                      }}
                    >
                      试跑 14:45 扫池
                    </Button>
                    <Button
                      size="sm"
                      icon={<Play size={14} />}
                      loading={busyAction === 'post_close'}
                      data-testid="scheduler-run-post-btn"
                      onClick={() => {
                        void handleRunNow('post_close');
                      }}
                    >
                      试跑 15:35 复盘
                    </Button>
                  </div>
                </div>
              )}

              {status.latest_briefing && (
                <div className={styles.pairingBox} data-testid="scheduler-latest-briefing">
                  <strong>{status.latest_briefing.summary_title}</strong>
                  <pre className={styles.briefingPre}>{status.latest_briefing.summary_text}</pre>
                </div>
              )}

              {status.recent_runs.length > 0 && (
                <div className={styles.schedulerRunList}>
                  {status.recent_runs.slice(0, 4).map((run) => (
                    <div key={run.run_id} className={styles.schedulerRunRow}>
                      <div className={styles.schedulerRunTop}>
                        <span>
                          <strong>{run.task_type}</strong> · {run.triggered_at}
                        </span>
                        <span className={styles.paramValue}>
                          {RUN_STATUS_LABELS[run.status] ?? run.status}
                        </span>
                      </div>
                      <div className={styles.settingDesc}>{run.summary_title}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
