import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Maximize2,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { FullQuote } from 'stock-sdk';
import { LazyEChart } from '@/components/charts/LazyEChart';
import { getChartColors } from '@/components/charts/chartTheme';
import { Button, Card, Empty, Loading, Tabs, useToast } from '@/components/common';
import {
  ActionDecisionPill,
  GovernanceBanner,
  ProvenancePill,
  buildBacktestUnderwaterChartOption,
  buildCorrelationHeatmapOption,
  buildExpertKlineChartOption,
  buildOrthogonalClustersChartOption,
  buildQuantStatsEquityChartOption,
} from '@/components/expert';
import { useAppSettings } from '@/contexts';
import { usePolling, useTheme } from '@/hooks';
import { getFullQuotes } from '@/services/sdk';
import {
  CLUSTER_LABELS_ZH,
  extractSubjectSixDigits,
  fetchQuantStatsHtml,
  fetchQuantStatsJson,
  fetchResearchCard,
  fetchWorkbench,
  getQuantStatsHtmlUrl,
  normalizeResearchSubjectId,
  openNativeKlineWindow,
  toStockDetailRoute,
  type DeepResearchCard,
  type QuantStatsSummary,
  type WorkbenchState,
} from '@/services/expertApi';
import { shouldUseRemoteDualChannel } from '@/services/apiClient';
import { isMobileViewport, isNativeApp } from '@/platform/runtime';
import { registerModalCloser } from '@/platform/modalStack';
import { formatNumber, formatPercent, getChangeColorClass, normalizeStockCode } from '@/utils/format';
import styles from './ExpertWorkbench.module.css';

const PRESET_SUBJECTS = [
  { id: '600900', label: '600900 长江电力' },
  { id: '300476', label: '300476 胜宏科技' },
  { id: '600426', label: '600426 华鲁恒升' },
  { id: '000999_TRAP', label: '000999_TRAP' },
  { id: '510300', label: '510300 沪深300ETF' },
  { id: '511090_ACT', label: '511090_ACT 主动ETF' },
  { id: '018956', label: '018956 中航AI' },
  { id: '920289', label: '920289 发现候选' },
  { id: 'UNKNOWN_XYZ', label: 'UNKNOWN_XYZ' },
];

const ACCOUNT_TABS = [
  { key: 'STK-ALIPAY-001', label: '支付宝股票 (STK)' },
  { key: 'FND-TIANTIAN-002', label: '天天基金 (FND)' },
];

const DETAIL_TABS = [
  { key: 'valueinvest', label: 'ValueInvest 排雷与估值' },
  { key: 'opportunity', label: '跨资产机会成本 & PyPortfolioOpt' },
  { key: 'backtest', label: 'A股 T+1 摩擦回测' },
  { key: 'quantstats', label: 'QuantStats 机构级报告' },
];

export function ExpertWorkbench() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const { theme } = useTheme();
  const { settings } = useAppSettings();
  const chartColors = useMemo(
    () => getChartColors(theme, settings.colorMode),
    [theme, settings.colorMode]
  );

  const activeSubjectId = normalizeResearchSubjectId(
    searchParams.get('symbol')?.trim() || '600900'
  );
  const activeAssetType = searchParams.get('asset_type')?.trim() || undefined;
  const activeRequestKey = activeAssetType
    ? `${activeSubjectId}::${activeAssetType}`
    : activeSubjectId;

  const [workbench, setWorkbench] = useState<WorkbenchState | null>(null);
  const [wbError, setWbError] = useState<string | null>(null);

  const [accountTab, setAccountTab] = useState<string>('STK-ALIPAY-001');
  const [symbolDraft, setSymbolDraft] = useState<{ subject: string; text: string }>({
    subject: activeSubjectId,
    text: activeSubjectId,
  });

  const [researchState, setResearchState] = useState<{
    subjectId: string;
    card: DeepResearchCard | null;
    error: string | null;
  }>({ subjectId: '', card: null, error: null });

  const [detailTab, setDetailTab] = useState<string>('valueinvest');
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({});
  const [qsModalOpen, setQsModalOpen] = useState(false);
  const [liveQuotesMap, setLiveQuotesMap] = useState<Map<string, FullQuote>>(new Map());
  const [qsState, setQsState] = useState<{
    accountId: string;
    data: QuantStatsSummary | null;
  }>({ accountId: '', data: null });
  const [qsHtmlState, setQsHtmlState] = useState<{
    accountId: string;
    html: string | null;
    error: boolean;
  }>({ accountId: '', html: null, error: false });
  const hideDesktopNativeControls = isNativeApp() || isMobileViewport();
  const useAuthenticatedHtmlSrcDoc = shouldUseRemoteDualChannel();

  const holdingSdkCodes = useMemo(() => {
    if (!workbench?.stock_account.positions.length) return [];
    return Array.from(
      new Set(
        workbench.stock_account.positions
          .map((pos) => normalizeStockCode(pos.symbol))
          .filter(Boolean)
      )
    );
  }, [workbench]);

  const fetchHoldingLiveQuotes = useCallback(async () => {
    if (holdingSdkCodes.length === 0) return;
    try {
      const list = await getFullQuotes(holdingSdkCodes);
      const nextMap = new Map<string, FullQuote>();
      list.forEach((q) => {
        const key = normalizeStockCode(q.code);
        if (key) nextMap.set(key, q);
      });
      if (nextMap.size > 0) {
        setLiveQuotesMap(nextMap);
      }
    } catch {
      // 保留离线/限流容错：静默回退至 PIT 快照价格
    }
  }, [holdingSdkCodes]);

  usePolling(fetchHoldingLiveQuotes, {
    interval: 15000,
    enabled: holdingSdkCodes.length > 0,
    immediate: true,
  });

  useEffect(() => {
    if (!qsModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setQsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [qsModalOpen]);

  const livePortfolioMetrics = useMemo(() => {
    if (!workbench || liveQuotesMap.size === 0) return null;
    let equityLive = 0;
    let equityPrev = 0;
    let matched = 0;
    workbench.stock_account.positions.forEach((pos) => {
      const q = liveQuotesMap.get(normalizeStockCode(pos.symbol));
      if (q && q.price > 0) {
        matched += 1;
        const mv = pos.quantity * q.price;
        const pct = Number.isFinite(q.changePercent) ? q.changePercent : 0;
        const prevMv = pct > -99 ? mv / (1 + pct / 100) : mv;
        equityLive += mv;
        equityPrev += prevMv;
      } else {
        equityLive += pos.market_value;
        equityPrev += pos.market_value;
      }
    });
    if (matched === 0) return null;
    const totalLive = workbench.stock_account.cash_amount + equityLive;
    const totalPrev = workbench.stock_account.cash_amount + equityPrev;
    const dayPct = totalPrev > 0 ? ((totalLive - totalPrev) / totalPrev) * 100 : 0;
    return {
      totalLive,
      dayPct,
      matched,
    };
  }, [workbench, liveQuotesMap]);

  // 加载双账户组合台账
  useEffect(() => {
    const controller = new AbortController();
    fetchWorkbench(controller.signal)
      .then((res) => {
        setWorkbench(res);
        setWbError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setWbError(err instanceof Error ? err.message : '加载组合工作台失败');
      });
    return () => controller.abort();
  }, []);

  // 加载当前标的深度研究卡
  useEffect(() => {
    const controller = new AbortController();
    fetchResearchCard(activeSubjectId, controller.signal, activeAssetType)
      .then((card) => {
        setResearchState({ subjectId: activeRequestKey, card, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setResearchState({
          subjectId: activeRequestKey,
          card: null,
          error: err instanceof Error ? err.message : '加载研究卡片失败',
        });
      });
    return () => controller.abort();
  }, [activeSubjectId, activeAssetType, activeRequestKey]);

  // 按需加载选中账户 QuantStats 报告 JSON（避免非该 Tab 时提前计算）
  useEffect(() => {
    if (detailTab !== 'quantstats') return;
    const controller = new AbortController();
    fetchQuantStatsJson(accountTab, controller.signal)
      .then((qs) => {
        setQsState({ accountId: accountTab, data: qs });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setQsState({ accountId: accountTab, data: null });
        }
      });
    return () => controller.abort();
  }, [accountTab, detailTab]);

  // 移动端/远程双通道下通过 Bearer 鉴权拉取 QuantStats HTML 供 iframe srcDoc 渲染
  useEffect(() => {
    if (!useAuthenticatedHtmlSrcDoc) return;
    if (detailTab !== 'quantstats' && !qsModalOpen) return;
    const controller = new AbortController();
    fetchQuantStatsHtml(accountTab, controller.signal)
      .then((html) => {
        setQsHtmlState({ accountId: accountTab, html, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setQsHtmlState({ accountId: accountTab, html: null, error: true });
        }
      });
    return () => controller.abort();
  }, [accountTab, detailTab, qsModalOpen, useAuthenticatedHtmlSrcDoc]);

  useEffect(() => {
    if (!qsModalOpen) {
      return undefined;
    }
    return registerModalCloser('expert-quantstats-modal', () => setQsModalOpen(false));
  }, [qsModalOpen]);

  const researchLoading = researchState.subjectId !== activeRequestKey;
  const researchCard =
    researchState.subjectId === activeRequestKey ? researchState.card : null;
  const researchError =
    researchState.subjectId === activeRequestKey ? researchState.error : null;

  const qsLoading = qsState.accountId !== accountTab;
  const quantStats = qsState.accountId === accountTab ? qsState.data : null;
  const quantStatsHtml =
    qsHtmlState.accountId === accountTab ? qsHtmlState.html : null;
  const quantStatsHtmlError =
    qsHtmlState.accountId === accountTab ? qsHtmlState.error : false;
  const symbolInputValue =
    symbolDraft.subject === activeSubjectId ? symbolDraft.text : activeSubjectId;

  const handleSelectSubject = (code: string, assetTypeHint?: string) => {
    const clean = normalizeResearchSubjectId(code);
    if (!clean) return;
    setSymbolDraft({ subject: clean, text: clean });
    if (assetTypeHint) {
      setSearchParams({ symbol: clean, asset_type: assetTypeHint }, { replace: true });
    } else {
      setSearchParams({ symbol: clean }, { replace: true });
    }
  };

  const handleLookupSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!symbolInputValue.trim()) return;
    handleSelectSubject(symbolInputValue);
  };

  const handleLaunchNativeKline = async () => {
    try {
      const res = await openNativeKlineWindow(activeSubjectId, true);
      toast.success(`已调用原生 TradingView 桌面窗 (${res.payload_summary.symbol})`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '启动独立窗口失败');
    }
  };

  const toggleCluster = (clusterKey: string) => {
    setExpandedClusters((prev) => ({ ...prev, [clusterKey]: !prev[clusterKey] }));
  };

  const clusterChartOption = useMemo(
    () =>
      researchCard
        ? buildOrthogonalClustersChartOption(researchCard.decision_packet.cluster_votes, chartColors)
        : {},
    [researchCard, chartColors]
  );

  const klineChartOption = useMemo(
    () =>
      researchCard
        ? buildExpertKlineChartOption(
          researchCard.kline_bars,
          researchCard.kline_markers,
          `${researchCard.subject_id} ${researchCard.subject_name}`,
          chartColors
        )
        : {},
    [researchCard, chartColors]
  );

  const corrHeatmapOption = useMemo(
    () =>
      researchCard
        ? buildCorrelationHeatmapOption(researchCard.portfolio_correlation, chartColors)
        : {},
    [researchCard, chartColors]
  );

  const underwaterChartOption = useMemo(
    () =>
      buildBacktestUnderwaterChartOption(researchCard?.backtest_summary ?? null, chartColors),
    [researchCard, chartColors]
  );

  const quantStatsChartOption = useMemo(
    () => buildQuantStatsEquityChartOption(quantStats, chartColors),
    [quantStats, chartColors]
  );

  const stockRoute =
    researchCard && (researchCard.asset_type === 'FUND' || researchCard.asset_type === 'ACTIVE_ETF')
      ? null
      : toStockDetailRoute(activeSubjectId);

  if (!workbench && !wbError) {
    return <Loading fullScreen text="正在加载双账户与 PIT 研判工作台..." />;
  }

  return (
    <div className={styles.page}>
      {workbench && <GovernanceBanner governance={workbench.governance} />}

      {wbError && (
        <Card title="后端连接异常">
          <div className={styles.evidenceDanger}>{wbError}</div>
        </Card>
      )}

      {workbench && workbench.priority_alerts.length > 0 && (
        <div className={styles.alertBox}>
          <div className={styles.alertTitle}>
            <AlertTriangle size={14} />
            <span>账户高优待办提醒 (Priority Alerts)</span>
          </div>
          <div className={styles.alertList}>
            {workbench.priority_alerts.map((alert) => (
              <div key={alert}>• {alert}</div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.workspaceGrid}>
        {/* 左侧栏：双账户台账 + 持仓点击联动 + 标的输入 */}
        <div className={styles.leftColumn}>
          <Card title="代码直达深研">
            <form className={styles.lookupForm} onSubmit={handleLookupSubmit}>
              <input
                className={styles.lookupInput}
                value={symbolInputValue}
                onChange={(e) =>
                  setSymbolDraft({ subject: activeSubjectId, text: e.target.value })
                }
                placeholder="输入代码如 600900 / 510300 / 018956"
              />
              <Button type="submit" size="md" variant="primary" icon={<Search size={15} />}>
                深研
              </Button>
            </form>
            <div className={styles.presetRow}>
              {PRESET_SUBJECTS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`${styles.presetChip} ${normalizeResearchSubjectId(activeSubjectId) === preset.id
                      ? styles.presetActive
                      : ''
                    }`}
                  onClick={() => handleSelectSubject(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </Card>

          {workbench && (
            <Card
              title="双实证账户与持仓"
              extra={
                <Tabs
                  items={ACCOUNT_TABS}
                  activeKey={accountTab}
                  onChange={setAccountTab}
                  size="md"
                />
              }
            >
              {accountTab === 'STK-ALIPAY-001' ? (
                <div>
                  <ProvenancePill badge={workbench.stock_account.badge} compact variant="subtle" />
                  <div className={styles.kpiGrid2}>
                    <div className={styles.kpiTile}>
                      <span className={styles.kpiLabel}>
                        {livePortfolioMetrics ? 'PIT总资产 / 盘中参考' : '股票账户总资产'}
                      </span>
                      <span className={styles.kpiVal}>
                        ¥{formatNumber(workbench.stock_account.total_asset)}
                      </span>
                      {livePortfolioMetrics && (
                        <span className={styles.kpiSub}>
                          实时 ¥{formatNumber(livePortfolioMetrics.totalLive)}
                        </span>
                      )}
                    </div>
                    <div className={styles.kpiTile}>
                      <span className={styles.kpiLabel}>
                        {livePortfolioMetrics ? '基线变化 / 今日实时' : '较基线变化'}
                      </span>
                      <span
                        className={`${styles.kpiVal} ${workbench.stock_account.change_pct >= 0 ? 'text-rise' : 'text-fall'
                          }`}
                      >
                        {formatPercent(workbench.stock_account.change_pct)}
                      </span>
                      {livePortfolioMetrics && (
                        <span className={`${styles.kpiSub} ${getChangeColorClass(livePortfolioMetrics.dayPct)}`}>
                          今日 {formatPercent(livePortfolioMetrics.dayPct)}
                        </span>
                      )}
                    </div>
                    <div className={styles.kpiTile}>
                      <span className={styles.kpiLabel}>可用现金 ({workbench.stock_account.cash_weight_pct.toFixed(2)}%)</span>
                      <span className={styles.kpiVal}>
                        ¥{formatNumber(workbench.stock_account.cash_amount)}
                      </span>
                    </div>
                    <div className={styles.kpiTile}>
                      <span className={styles.kpiLabel}>Plan B 对照差额</span>
                      <span className={styles.kpiVal}>
                        {formatPercent(workbench.stock_account.plan_b_diff_pct)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.subSectionTitle}>
                    持仓明细 ({workbench.stock_account.positions.length} 标的 · 点击联动右侧研判)
                  </div>
                  <div className={styles.holdingList}>
                    {workbench.stock_account.positions.map((pos) => {
                      const active = extractSubjectSixDigits(activeSubjectId) === pos.symbol && activeAssetType !== 'fund';
                      const liveQuote = liveQuotesMap.get(normalizeStockCode(pos.symbol));
                      return (
                        <button
                          key={pos.symbol}
                          type="button"
                          className={`${styles.holdingRow} ${active ? styles.holdingRowActive : ''}`}
                          onClick={() => handleSelectSubject(pos.symbol)}
                        >
                          <div className={styles.holdingTop}>
                            <div className={styles.holdingTitle}>
                              <span>{pos.name}</span>
                              <span className={styles.holdingCode}>{pos.symbol}</span>
                            </div>
                            <ActionDecisionPill action={pos.action} showZh={false} />
                          </div>
                          <div className={styles.holdingMeta}>
                            <span>PIT ¥{pos.close_price.toFixed(2)}</span>
                            {liveQuote && liveQuote.price > 0 && (
                              <span className={getChangeColorClass(liveQuote.changePercent)}>
                                现价 ¥{liveQuote.price.toFixed(2)} ({formatPercent(liveQuote.changePercent)})
                              </span>
                            )}
                            <span>权重 {pos.weight_pct.toFixed(2)}%</span>
                            <span>零仓:{pos.zero_position_test}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <ProvenancePill badge={workbench.fund_account.badge} compact variant="subtle" />
                  <div className={styles.kpiGrid2}>
                    <div className={styles.kpiTile}>
                      <span className={styles.kpiLabel}>基金组合总资产</span>
                      <span className={styles.kpiVal}>
                        ¥{formatNumber(workbench.fund_account.total_asset)}
                      </span>
                    </div>
                    <div className={styles.kpiTile}>
                      <span className={styles.kpiLabel}>待确认赎回总额</span>
                      <span className={styles.kpiVal}>
                        ¥{formatNumber(workbench.fund_account.pending_redemption_total_cny)}
                      </span>
                    </div>
                    <div className={styles.kpiTile}>
                      <span className={styles.kpiLabel}>当日参考盈亏</span>
                      <span
                        className={`${styles.kpiVal} ${workbench.fund_account.daily_pnl >= 0 ? 'text-rise' : 'text-fall'
                          }`}
                      >
                        ¥{formatNumber(workbench.fund_account.daily_pnl)}
                      </span>
                    </div>
                    <div className={styles.kpiTile}>
                      <span className={styles.kpiLabel}>累计持有盈亏</span>
                      <span
                        className={`${styles.kpiVal} ${workbench.fund_account.holding_pnl >= 0 ? 'text-rise' : 'text-fall'
                          }`}
                      >
                        ¥{formatNumber(workbench.fund_account.holding_pnl)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.subSectionTitle}>在途赎回状态机</div>
                  <div className={styles.chainBanner}>
                    {workbench.fund_account.redemption_state_chain}
                  </div>

                  <div className={styles.subSectionTitle}>
                    待确认赎回订单 ({workbench.fund_account.pending_orders.length} 笔)
                  </div>
                  <div className={styles.holdingList}>
                    {workbench.fund_account.pending_orders.map((order) => (
                      <div key={order.order_id} className={styles.holdingRow}>
                        <div className={styles.holdingTop}>
                          <span className={styles.holdingTitle}>
                            {order.fund_name} ({order.fund_code})
                          </span>
                          <span className={styles.assetTag}>{order.status}</span>
                        </div>
                        <div className={styles.holdingMeta}>
                          <span>赎回比例 {order.request_ratio_pct}%</span>
                          <span>估算金额 ¥{formatNumber(order.reference_gross_cny)}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={styles.subSectionTitle}>6 大风险桶分布</div>
                  <div className={styles.holdingList}>
                    {workbench.fund_account.risk_buckets.map((b) => (
                      <div key={b.bucket_name} className={styles.holdingRow}>
                        <div className={styles.holdingTop}>
                          <span className={styles.holdingTitle}>{b.bucket_name}</span>
                          <span className={styles.assetTag}>{b.status}</span>
                        </div>
                        <div className={styles.holdingMeta}>
                          <span>当前 {b.current_weight_pct.toFixed(1)}%</span>
                          <span>确认后 {b.post_redemption_weight_pct.toFixed(1)}%</span>
                          <span>区间 {b.band_display}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={styles.subSectionTitle}>
                    基金持仓 ({workbench.fund_account.holdings.length} 只 · 点击加载基金研究卡)
                  </div>
                  <div className={styles.holdingList}>
                    {workbench.fund_account.holdings.map((h) => {
                      const active = extractSubjectSixDigits(activeSubjectId) === h.fund_code;
                      return (
                        <button
                          key={h.fund_code}
                          type="button"
                          className={`${styles.holdingRow} ${active ? styles.holdingRowActive : ''}`}
                          onClick={() => handleSelectSubject(h.fund_code, 'fund')}
                        >
                          <div className={styles.holdingTop}>
                            <div className={styles.holdingTitle}>
                              <span>{h.fund_name}</span>
                              <span className={styles.holdingCode}>{h.fund_code}</span>
                            </div>
                            <span className={styles.assetTag}>{h.risk_bucket}</span>
                          </div>
                          <div className={styles.holdingMeta}>
                            <span>市值 ¥{formatNumber(h.asset_value)}</span>
                            <span>权重 {h.weight_pct.toFixed(2)}%</span>
                            <span>
                              持盈 {h.holding_pnl >= 0 ? '+' : ''}
                              {formatNumber(h.holding_pnl)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>

        {/* 右侧主舞台 */}
        <div className={styles.rightColumn}>
          {researchLoading ? (
            <Card>
              <Loading text={`正在装配 ${activeSubjectId} 的 PIT 证据与模型推演...`} />
            </Card>
          ) : researchError || !researchCard ? (
            <Card title={`研究加载失败: ${activeSubjectId}`}>
              <Empty description={researchError ?? '暂无数据'} />
            </Card>
          ) : (
            <>
              <Card>
                <div className={styles.subjectHeader}>
                  <div className={styles.subjectIdentity}>
                    <div className={styles.subjectNameLine}>
                      <h1 className={styles.subjectTitle}>
                        {researchCard.subject_id} · {researchCard.subject_name}
                      </h1>
                      <span className={styles.assetTag}>{researchCard.asset_type}</span>
                      <ActionDecisionPill action={researchCard.decision_packet.action} />
                    </div>
                    <ProvenancePill badge={researchCard.header_badge} />
                  </div>
                  <div className={styles.subjectActions}>
                    {stockRoute && (
                      <Button
                        size="md"
                        variant="secondary"
                        icon={<ArrowUpRight size={15} />}
                        onClick={() => navigate(stockRoute)}
                      >
                        原版实时行情
                      </Button>
                    )}
                    {!hideDesktopNativeControls && (
                      <Button
                        size="md"
                        variant="primary"
                        icon={<ExternalLink size={15} />}
                        onClick={handleLaunchNativeKline}
                      >
                        独立桌面 K 线窗 (PyWV)
                      </Button>
                    )}
                  </div>
                </div>
              </Card>

              <div className={styles.decisionSplit}>
                <Card
                  title="正交研究结论 & 证据天平"
                  extra={
                    <span className={styles.assetTag}>
                      PIT基准 {researchCard.as_of}
                      {researchCard.kline_as_of && researchCard.kline_as_of !== researchCard.as_of
                        ? ` · K线至 ${researchCard.kline_as_of}`
                        : ''}
                    </span>
                  }
                >
                  <div className={styles.convictionHero}>
                    <div>
                      <div className={styles.kpiLabel}>正交合成净信念得分</div>
                      <div className={styles.convictionNumber}>
                        {researchCard.decision_packet.composite_conviction_score > 0 ? '+' : ''}
                        {researchCard.decision_packet.composite_conviction_score.toFixed(1)}
                      </div>
                    </div>
                    <div className={styles.clusterCounts}>
                      <span>支持簇: {researchCard.decision_packet.supporting_clusters_count}/5</span>
                      <span>反对簇: {researchCard.decision_packet.contradicting_clusters_count}/5</span>
                      <span>未知簇: {researchCard.decision_packet.unknown_clusters_count}/5</span>
                    </div>
                  </div>

                  {(researchCard.decision_packet.red_flag_blockers.length > 0 ||
                    researchCard.decision_packet.unresolved_gaps.length > 0) && (
                      <div className={styles.clusterAccordion}>
                        {researchCard.decision_packet.red_flag_blockers.map((blocker) => (
                          <div key={blocker} className={styles.evidenceDanger}>
                            <strong>[红旗阻断]</strong> {blocker}
                          </div>
                        ))}
                        {researchCard.decision_packet.unresolved_gaps.map((gap) => (
                          <div key={gap} className={styles.evidenceDanger}>
                            <strong>[缺口阻断]</strong> {gap}
                          </div>
                        ))}
                      </div>
                    )}

                  <div className={styles.reasonGrid}>
                    <div className={styles.reasonCol}>
                      <div className={styles.reasonHeading}>支持核心证据 (独立去重)</div>
                      {researchCard.decision_packet.supporting_reasons.length === 0 ? (
                        <div className={styles.evidenceCard}>当前暂无净支持证据簇。</div>
                      ) : (
                        researchCard.decision_packet.supporting_reasons.map((r) => (
                          <div key={r} className={`${styles.evidenceCard} ${styles.evidenceSupport}`}>
                            {r}
                          </div>
                        ))
                      )}
                    </div>
                    <div className={styles.reasonCol}>
                      <div className={styles.reasonHeading}>反方证据 & 风险约束</div>
                      {researchCard.decision_packet.counter_reasons.map((r) => (
                        <div key={r} className={`${styles.evidenceCard} ${styles.evidenceCounter}`}>
                          {r}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={styles.subSectionTitle}>改变观点的量化触发器 (Change Triggers)</div>
                  <div className={styles.holdingList}>
                    {researchCard.decision_packet.change_triggers.map((t) => (
                      <div key={t} className={styles.evidenceCard}>
                        • {t}
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="五大正交证据簇独立投票 (共线抑制)">
                  <div className={styles.chartBox}>
                    <LazyEChart
                      option={clusterChartOption}
                      style={{ height: '100%', width: '100%' }}
                      notMerge
                    />
                  </div>
                  <div className={styles.clusterAccordion}>
                    {researchCard.decision_packet.cluster_votes.map((vote) => {
                      const open = Boolean(expandedClusters[vote.cluster]);
                      return (
                        <div key={vote.cluster} className={styles.clusterItem}>
                          <button
                            type="button"
                            className={styles.clusterHeaderBtn}
                            onClick={() => toggleCluster(vote.cluster)}
                          >
                            <span>
                              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{' '}
                              <strong>{CLUSTER_LABELS_ZH[vote.cluster] ?? vote.cluster}</strong>
                            </span>
                            <span className={styles.mono}>
                              得分 {vote.deduped_score.toFixed(1)} · 共线抑制 {vote.collinearity_suppressed_count}
                            </span>
                          </button>
                          {open && (
                            <div className={styles.clusterDetailBody}>
                              {vote.indicators.length === 0 ? (
                                <span className={styles.kpiLabel}>该正交簇暂无已入库指标。</span>
                              ) : (
                                vote.indicators.map((ind) => (
                                  <div key={ind.indicator_id} className={styles.indicatorRow}>
                                    <div className={styles.holdingTop}>
                                      <strong>
                                        {ind.name}：{ind.value_display}
                                      </strong>
                                      <span className={styles.mono}>[{ind.claim_kind}]</span>
                                    </div>
                                    <div>{ind.summary}</div>
                                    <ProvenancePill badge={ind.badge} />
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>

              <Card
                title={researchCard.asset_type === 'FUND' ? '基金单位净值实证走势' : '真实日线走势与策略标注'}
                extra={
                  <span className={styles.assetTag}>
                    {researchCard.kline_origin === 'money_fund_fixed_nav_1.0'
                      ? '货币基金净值恒定 1.0000（按万份收益/7日年化计息）'
                      : researchCard.kline_bars.length > 0
                        ? researchCard.asset_type === 'FUND'
                          ? `${researchCard.kline_bars[0]?.time} ~ ${researchCard.kline_bars[researchCard.kline_bars.length - 1]?.time} (${researchCard.kline_bars.length} 个净值日)`
                          : `${researchCard.kline_bars[0]?.time} ~ ${researchCard.kline_bars[researchCard.kline_bars.length - 1]?.time} (${researchCard.kline_bars.length} 根 · MA5/20/60)`
                        : '实盘日线不可用 (严禁模拟K线)'}
                  </span>
                }
              >
                {researchCard.kline_bars.length > 0 ? (
                  <div className={styles.klineBox}>
                    <LazyEChart
                      option={klineChartOption}
                      style={{ height: '100%', width: '100%' }}
                      notMerge
                    />
                  </div>
                ) : researchCard.kline_origin === 'money_fund_fixed_nav_1.0' ? (
                  <Empty description="货币基金单位净值恒定 1.0000（按日结转万份收益与7日年化，严禁伪造波动K线图）" />
                ) : (
                  <Empty description="暂无真实日线数据，严禁使用模拟 K 线替代（请检查网络连接或标的代号后重试）" />
                )}
              </Card>

              <Card
                title="深度定量分析与绩效内嵌区"
                extra={
                  <Tabs
                    items={DETAIL_TABS}
                    activeKey={detailTab}
                    onChange={setDetailTab}
                    size="md"
                  />
                }
              >
                {detailTab === 'valueinvest' && (
                  <div>
                    {researchCard.turnaround_report === null ? (
                      <div className={styles.isolationBanner}>
                        <strong>资产语义隔离生效：</strong>当前标的资产类型为{' '}
                        <span className={styles.mono}>{researchCard.asset_type}</span>，严禁混用企业财务排雷（F/Z/M-Score）或杜邦拆解指标，仅展示其专属资产透镜指标。
                      </div>
                    ) : (
                      <>
                        <div className={styles.kpiGrid4}>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>诊断分类</span>
                            <span className={styles.kpiVal}>
                              {researchCard.turnaround_report.classification}
                            </span>
                          </div>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>ValueInvest F-Score</span>
                            <span className={styles.kpiVal}>
                              {researchCard.turnaround_report.piotroski_f_score} / 9
                            </span>
                          </div>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>Altman Z-Score</span>
                            <span className={styles.kpiVal}>
                              {researchCard.turnaround_report.altman_z_score.toFixed(2)}
                            </span>
                          </div>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>Beneish M-Score</span>
                            <span className={styles.kpiVal}>
                              {researchCard.turnaround_report.beneish_m_score.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <div className={styles.reasonGrid}>
                          {researchCard.turnaround_report.dupont && (
                            <div className={styles.kpiTile}>
                              <span className={styles.kpiLabel}>
                                杜邦三步拆解 ({researchCard.turnaround_report.engine_provider})
                              </span>
                              <div className={styles.mono}>
                                ROE {researchCard.turnaround_report.dupont.computed_roe_pct.toFixed(2)}% =
                                净利率 {researchCard.turnaround_report.dupont.net_profit_margin_pct.toFixed(2)}% ×
                                周转 {researchCard.turnaround_report.dupont.asset_turnover.toFixed(2)} ×
                                杠杆 {researchCard.turnaround_report.dupont.equity_multiplier.toFixed(2)}
                              </div>
                              <span className={styles.kpiLabel}>
                                {researchCard.turnaround_report.dupont.driver_diagnosis}
                              </span>
                            </div>
                          )}

                          {researchCard.turnaround_report.reverse_dcf && (
                            <div className={styles.kpiTile}>
                              <span className={styles.kpiLabel}>逆向 DCF 市场隐含预期</span>
                              <div className={styles.mono}>
                                隐含 5Y FCF CAGR:{' '}
                                {researchCard.turnaround_report.reverse_dcf.implied_5y_cagr_pct !== null
                                  ? `${researchCard.turnaround_report.reverse_dcf.implied_5y_cagr_pct.toFixed(2)}%`
                                  : 'N/A'}
                              </div>
                              <span className={styles.kpiLabel}>
                                市值 {researchCard.turnaround_report.reverse_dcf.market_cap} 亿 · 标准化 FCF{' '}
                                {researchCard.turnaround_report.reverse_dcf.normalized_fcf} 亿 ·{' '}
                                {researchCard.turnaround_report.reverse_dcf.safety_margin_assessment}
                              </span>
                            </div>
                          )}
                        </div>

                        {researchCard.turnaround_report.red_flags.length > 0 && (
                          <div className={styles.clusterAccordion}>
                            <div className={styles.subSectionTitle}>会计排雷红旗清单</div>
                            {researchCard.turnaround_report.red_flags.map((rf) => (
                              <div key={rf.flag_id} className={styles.evidenceDanger}>
                                <strong>
                                  [{rf.severity}] {rf.flag_id} · {rf.title_zh}
                                </strong>
                                ：{rf.detail}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    <div className={styles.subSectionTitle}>资产专属结构化指标</div>
                    <div className={styles.tableWrap}>
                      <table className={styles.dataTable}>
                        <thead>
                          <tr>
                            <th>指标维度</th>
                            <th>实测值</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(researchCard.asset_specific_metrics).map(([k, v]) => (
                            <tr key={k}>
                              <td>{k}</td>
                              <td className={styles.mono}>{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {detailTab === 'opportunity' && (
                  <div>
                    <div className={styles.subSectionTitle}>跨资产替代机会成本对照矩阵 (含零仓位检验)</div>
                    {researchCard.opportunity_cost_matrix.length === 0 ? (
                      <Empty description="当前未配置替代机会对照样本" />
                    ) : (
                      <div className={styles.tableWrap}>
                        <table className={styles.dataTable}>
                          <thead>
                            <tr>
                              <th>替代标的</th>
                              <th>类型</th>
                              <th>逻辑质量</th>
                              <th>零仓位检验</th>
                              <th>入选可行性</th>
                              <th>治理原因 / 权衡摘要</th>
                            </tr>
                          </thead>
                          <tbody>
                            {researchCard.opportunity_cost_matrix.map((row) => (
                              <tr key={row.alternative_id}>
                                <td className={styles.mono}>
                                  {row.alternative_name} ({row.alternative_id})
                                </td>
                                <td>{row.alternative_kind}</td>
                                <td>{row.thesis_quality}</td>
                                <td className={styles.mono}>{row.zero_position_test}</td>
                                <td>{row.decision_eligible ? 'ELIGIBLE' : 'FILTERED'}</td>
                                <td>
                                  {[...row.governance_reasons, ...row.alternative_advantages]
                                    .slice(0, 2)
                                    .join('；')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {researchCard.portfolio_correlation.status === 'INSUFFICIENT_REAL_HISTORY' ||
                    researchCard.portfolio_correlation.price_source === 'real_kline_insufficient' ? (
                      <div className={styles.evidenceDanger}>
                        <strong>[PyPortfolioOpt 相关性与 MinVol 权重已阻断 (Fail-Closed)]</strong>{' '}
                        {researchCard.portfolio_correlation.reason ||
                          '目标标的或组合持仓缺少足够真实历史 K 线序列（严禁使用合成行情填充估算）。'}
                      </div>
                    ) : researchCard.portfolio_correlation.symbols &&
                      researchCard.portfolio_correlation.symbols.length > 0 ? (
                        <>
                          <div className={styles.subSectionTitle}>
                            <Sparkles size={13} /> PyPortfolioOpt 组合相关性矩阵 & MinVol 权重建议
                            （均相关 {researchCard.portfolio_correlation.avg_correlation_to_portfolio?.toFixed(2) ?? '--'} · MinVol{' '}
                            {researchCard.portfolio_correlation.target_min_vol_weight_pct ?? '--'}% vs 等权{' '}
                            {researchCard.portfolio_correlation.target_equal_weight_pct ?? '--'}%）
                          </div>
                          <div className={styles.decisionSplit}>
                            <div className={styles.heatmapBox}>
                              <LazyEChart
                                option={corrHeatmapOption}
                                style={{ height: '100%', width: '100%' }}
                                notMerge
                              />
                            </div>
                            <div className={styles.tableWrap}>
                              <table className={styles.dataTable}>
                                <thead>
                                  <tr>
                                    <th>标的</th>
                                    <th>MinVol 权重</th>
                                    <th>等权基线</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {researchCard.portfolio_correlation.symbols.map((sym) => (
                                    <tr key={sym}>
                                      <td>
                                        {researchCard.portfolio_correlation.names?.[sym] ?? sym} ({sym})
                                      </td>
                                      <td className={styles.mono}>
                                        {(
                                          researchCard.portfolio_correlation.weights?.[sym] ?? 0
                                        ).toFixed(2)}
                                        %
                                      </td>
                                      <td className={styles.mono}>
                                        {(
                                          researchCard.portfolio_correlation
                                            .equal_weight_baseline?.[sym] ?? 0
                                        ).toFixed(2)}
                                        %
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </>
                      ) : null}
                  </div>
                )}

                {detailTab === 'backtest' && (
                  <div>
                    {!researchCard.backtest_summary ? (
                      <Empty description="当前标的未运行回测序列" />
                    ) : (
                      <>
                        <div className={styles.kpiGrid4}>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>1x 基准摩擦收益</span>
                            <span className={styles.kpiVal}>
                              {formatPercent(researchCard.backtest_summary.total_return_1x_pct)}
                            </span>
                          </div>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>2x 高摩擦收益</span>
                            <span className={styles.kpiVal}>
                              {formatPercent(researchCard.backtest_summary.total_return_2x_pct)}
                            </span>
                          </div>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>1x 最大回撤 / Sharpe</span>
                            <span className={styles.kpiVal}>
                              {researchCard.backtest_summary.max_drawdown_1x_pct.toFixed(2)}% /{' '}
                              {researchCard.backtest_summary.sharpe_1x?.toFixed(2) ?? 'N/A'}
                            </span>
                          </div>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>胜率 / 成交次数</span>
                            <span className={styles.kpiVal}>
                              {researchCard.backtest_summary.win_rate_pct.toFixed(1)}% /{' '}
                              {researchCard.backtest_summary.trade_count}
                            </span>
                          </div>
                        </div>

                        <div className={styles.subSectionTitle}>
                          T+1 合规与防未来函数警示 ({researchCard.backtest_summary.strategy_name})
                        </div>
                        <div className={styles.clusterAccordion}>
                          {researchCard.backtest_summary.warnings.map((w) => (
                            <div key={w} className={styles.evidenceCard}>
                              • {w}
                            </div>
                          ))}
                        </div>

                        <div className={styles.subSectionTitle}>水下回撤曲线 (Underwater Drawdown)</div>
                        <div className={styles.chartBox}>
                          <LazyEChart
                            option={underwaterChartOption}
                            style={{ height: '100%', width: '100%' }}
                            notMerge
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {detailTab === 'quantstats' && (
                  <div>
                    <div className={styles.subjectHeader}>
                      <div className={styles.subSectionTitle}>
                        账户 {accountTab} QuantStats 绩效拆解
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <Button
                          size="md"
                          variant="primary"
                          icon={<Maximize2 size={15} />}
                          onClick={() => setQsModalOpen(true)}
                        >
                          窗口内全屏展开报告
                        </Button>
                        {!hideDesktopNativeControls && (
                          <Button
                            size="md"
                            variant="secondary"
                            icon={<ExternalLink size={15} />}
                            onClick={() => window.open(getQuantStatsHtmlUrl(accountTab), '_blank')}
                          >
                            新窗口打开全屏 Tear-Sheet
                          </Button>
                        )}
                      </div>
                    </div>
                    {qsLoading || !quantStats ? (
                      <Loading text="正在计算 QuantStats 机构级指标..." />
                    ) : (
                      <>
                        <div className={styles.kpiGrid4}>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>Sharpe / Sortino</span>
                            <span className={styles.kpiVal}>
                              {quantStats.metrics.sharpe.toFixed(2)} /{' '}
                              {quantStats.metrics.sortino.toFixed(2)}
                            </span>
                          </div>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>Max Drawdown / Calmar</span>
                            <span className={styles.kpiVal}>
                              {quantStats.metrics.max_drawdown_pct.toFixed(2)}% /{' '}
                              {quantStats.metrics.calmar.toFixed(2)}
                            </span>
                          </div>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>VaR 95% / CVaR 95%</span>
                            <span className={styles.kpiVal}>
                              {quantStats.metrics.var_95_pct.toFixed(2)}% /{' '}
                              {quantStats.metrics.cvar_95_pct.toFixed(2)}%
                            </span>
                          </div>
                          <div className={styles.kpiTile}>
                            <span className={styles.kpiLabel}>累计收益 / 超额收益</span>
                            <span className={styles.kpiVal}>
                              {formatPercent(quantStats.metrics.total_return_pct)} /{' '}
                              {formatPercent(quantStats.metrics.excess_return_pct)}
                            </span>
                          </div>
                        </div>

                        <div className={styles.klineBox}>
                          <LazyEChart
                            option={quantStatsChartOption}
                            style={{ height: '100%', width: '100%' }}
                            notMerge
                          />
                        </div>

                        {useAuthenticatedHtmlSrcDoc ? (
                          quantStatsHtml ? (
                            <iframe
                              id="quantstats-native-iframe"
                              title={`QuantStats TearSheet ${accountTab}`}
                              className={styles.tearFrame}
                              srcDoc={quantStatsHtml}
                            />
                          ) : quantStatsHtmlError ? (
                            <Empty description="当前处于离线或远程主机未连通状态，无法获取 QuantStats 完整 HTML 报告（上方指标仍可离线阅读）。" />
                          ) : (
                            <Loading text="正在通过加密通道加载 QuantStats HTML 报告..." />
                          )
                        ) : (
                          <iframe
                            id="quantstats-native-iframe"
                            title={`QuantStats TearSheet ${accountTab}`}
                            className={styles.tearFrame}
                            src={getQuantStatsHtmlUrl(accountTab)}
                          />
                        )}
                      </>
                    )}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      {qsModalOpen && (
        <div
          className={styles.tearModalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label={`QuantStats TearSheet ${accountTab} 全屏报告`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setQsModalOpen(false);
            }
          }}
        >
          <div className={styles.tearModal}>
            <div className={styles.tearModalHeader}>
              <span className={styles.tearModalTitle}>
                账户 {accountTab} · QuantStats 机构级绩效报告（只研不下单）
              </span>
              <Button
                size="sm"
                variant="secondary"
                icon={<X size={14} />}
                onClick={() => setQsModalOpen(false)}
              >
                关闭 (ESC)
              </Button>
            </div>
            {useAuthenticatedHtmlSrcDoc ? (
              quantStatsHtml ? (
                <iframe
                  title={`QuantStats TearSheet Fullscreen ${accountTab}`}
                  className={styles.tearModalFrame}
                  srcDoc={quantStatsHtml}
                />
              ) : quantStatsHtmlError ? (
                <div style={{ padding: 24 }}>
                  <Empty description="当前未连通桌面主机，暂无法加载 QuantStats HTML TearSheet。" />
                </div>
              ) : (
                <Loading text="正在加载完整 QuantStats TearSheet..." />
              )
            ) : (
              <iframe
                title={`QuantStats TearSheet Fullscreen ${accountTab}`}
                className={styles.tearModalFrame}
                src={getQuantStatsHtmlUrl(accountTab)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
