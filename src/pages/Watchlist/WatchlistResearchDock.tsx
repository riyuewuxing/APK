import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Plus, Check, Sparkles, RefreshCw } from 'lucide-react';
import { fetchEodJournal, type EodJournalResponse } from '@/services/eodApi';
import {
  fetchRadar,
  fetchWorkbench,
  type RadarState,
  type RadarStockEntry,
  type WorkbenchState,
} from '@/services/expertApi';
import {
  fetchGlobalPulse,
  formatPulseChangePct,
  formatPulsePrice,
  type GlobalPulsePayload,
  type GlobalPulseRegion,
} from '@/services/globalPulseApi';
import { getWatchlistDockOpen, saveWatchlistDockOpen } from '@/services/storage';
import { formatPercent, formatPrice, getChangeColorClass, normalizeStockCode } from '@/utils/format';
import { extractBareCode } from './watchlistTerminalHelpers';
import styles from './WatchlistResearchDock.module.css';

type DockTab = 'radar' | 'eod' | 'portfolio' | 'global';

const GLOBAL_DOCK_REGIONS: Array<{ key: GlobalPulseRegion; label: string }> = [
  { key: 'US', label: '美洲' },
  { key: 'APAC', label: '亚太' },
  { key: 'EU', label: '欧洲' },
  { key: 'MACRO', label: '汇率·大宗·利率' },
];

interface WatchlistResearchDockProps {
  activeWatchlistCodes: readonly string[];
  onAddWatchlist: (code: string, name?: string) => void;
  onSelectSymbol: (code: string, name?: string) => void;
}

function getInitialDockOpen(): boolean {
  const stored = getWatchlistDockOpen();
  if (stored !== null) return stored;
  if (typeof window !== 'undefined') {
    return window.innerHeight >= 980;
  }
  return false;
}

function formatFiniteFixed(value: number | null | undefined, digits: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '--';
}

function getClassificationLabel(classification: RadarStockEntry['turnaround_classification']): {
  label: string;
  tone: 'rise' | 'warning' | 'accent' | 'muted';
} {
  switch (classification) {
    case 'TRUE_TURNAROUND':
      return { label: '困境反转', tone: 'rise' };
    case 'QUALITY_COMPOUNDER':
      return { label: '质量复利', tone: 'accent' };
    case 'VALUE_TRAP_WARNING':
      return { label: '价值陷阱预警', tone: 'warning' };
    default:
      return { label: '研究候选', tone: 'muted' };
  }
}

function getRegimeBadge(regime: string): { label: string; tone: 'rise' | 'fall' | 'warning' | 'muted' } {
  switch (regime) {
    case 'GREEN':
      return { label: '情绪偏强 GREEN', tone: 'rise' };
    case 'YELLOW':
      return { label: '情绪中性 YELLOW', tone: 'warning' };
    case 'RED':
      return { label: '情绪谨慎 RED', tone: 'fall' };
    default:
      return { label: '情绪未知 UNKNOWN', tone: 'muted' };
  }
}

export function WatchlistResearchDock({
  activeWatchlistCodes,
  onAddWatchlist,
  onSelectSymbol,
}: WatchlistResearchDockProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState<boolean>(getInitialDockOpen);
  const [activeTab, setActiveTab] = useState<DockTab>('radar');

  const [radarData, setRadarData] = useState<RadarState | null>(null);
  const [eodData, setEodData] = useState<EodJournalResponse | null>(null);
  const [workbenchData, setWorkbenchData] = useState<WorkbenchState | null>(null);
  const [globalData, setGlobalData] = useState<GlobalPulsePayload | null>(null);

  const [loadingTab, setLoadingTab] = useState<DockTab | null>(null);
  const [errorTab, setErrorTab] = useState<Partial<Record<DockTab, boolean>>>({});

  const watchlistCodeSet = useMemo(
    () => new Set(activeWatchlistCodes.map((c) => normalizeStockCode(c)).filter(Boolean)),
    [activeWatchlistCodes]
  );

  const loadTabData = useCallback(
    async (tab: DockTab, force = false, signal?: AbortSignal) => {
      if (tab === 'radar' && radarData && !force) return;
      if (tab === 'eod' && eodData && !force) return;
      if (tab === 'portfolio' && workbenchData && !force) return;
      if (tab === 'global' && globalData && !force) return;

      setLoadingTab(tab);
      setErrorTab((prev) => ({ ...prev, [tab]: false }));
      try {
        if (tab === 'radar') {
          const res = await fetchRadar(signal);
          if (!signal?.aborted) setRadarData(res);
        } else if (tab === 'eod') {
          const res = await fetchEodJournal(signal);
          if (!signal?.aborted) setEodData(res);
        } else if (tab === 'portfolio') {
          const res = await fetchWorkbench(signal);
          if (!signal?.aborted) setWorkbenchData(res);
        } else {
          const res = await fetchGlobalPulse(force, signal);
          if (!signal?.aborted) setGlobalData(res);
        }
      } catch {
        if (!signal?.aborted) {
          setErrorTab((prev) => ({ ...prev, [tab]: true }));
        }
      } finally {
        if (!signal?.aborted) {
          setLoadingTab((prev) => (prev === tab ? null : prev));
        }
      }
    },
    [radarData, eodData, workbenchData, globalData]
  );

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    void loadTabData(activeTab, false, controller.signal);
    return () => controller.abort();
  }, [isOpen, activeTab, loadTabData]);

  const handleToggleOpen = () => {
    setIsOpen((prev) => {
      const next = !prev;
      saveWatchlistDockOpen(next);
      return next;
    });
  };

  const radarItems = useMemo(() => {
    if (!radarData) return [];
    const seen = new Set<string>();
    const combined = [
      ...(radarData.turnaround_candidates ?? []),
      ...(radarData.stock_discovery ?? []),
    ];
    const out: Array<RadarStockEntry & { normalizedCode: string }> = [];
    for (const item of combined) {
      const norm = normalizeStockCode(item.symbol);
      const key = norm || item.symbol;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...item, normalizedCode: norm });
    }
    return out;
  }, [radarData]);

  const latestEodSnapshot = eodData?.snapshots?.[0] ?? null;
  const portfolioPositions = workbenchData?.stock_account?.positions ?? [];

  const renderRowActions = (rawCode: string, name?: string) => {
    const norm = normalizeStockCode(rawCode);
    const isValidStock = /^(sh|sz|bj)\d{6}$/i.test(norm);
    const inWatchlist = isValidStock && watchlistCodeSet.has(norm);

    return (
      <div className={styles.rowActions} onClick={(e) => e.stopPropagation()}>
        {isValidStock && (
          <button
            type="button"
            className={`${styles.rowBtn} ${inWatchlist ? styles.rowBtnAdded : ''}`}
            disabled={inWatchlist}
            onClick={() => onAddWatchlist(norm, name)}
            title={inWatchlist ? '已在当前自选分组' : '加入当前自选分组'}
          >
            {inWatchlist ? <Check size={11} /> : <Plus size={11} />}
            <span>{inWatchlist ? '已在自选' : '+自选'}</span>
          </button>
        )}
        <button
          type="button"
          className={styles.rowBtn}
          onClick={() => navigate(`/expert?symbol=${encodeURIComponent(norm || rawCode)}`)}
        >
          <Sparkles size={11} />
          <span>深研</span>
        </button>
      </div>
    );
  };

  return (
    <section className={styles.dock} data-testid="watchlist-research-dock">
      <div className={styles.headerBar}>
        <div className={styles.headerLeft}>
          <button
            type="button"
            className={styles.toggleBtn}
            onClick={handleToggleOpen}
            data-testid="watchlist-dock-toggle"
            aria-expanded={isOpen}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            <span className={styles.dockTitle}>研究机会与持仓 Dock</span>
          </button>

          <div className={styles.tabs} role="tablist" aria-label="研究机会与持仓视图">
            {(
              [
                { key: 'radar', label: '雷达机会池' },
                { key: 'eod', label: '尾盘 2.0 记录' },
                { key: 'portfolio', label: '实证持仓对照' },
                { key: 'global', label: '外围定价锚' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`${styles.tabBtn} ${activeTab === tab.key && isOpen ? styles.tabBtnActive : ''}`}
                onClick={() => {
                  setActiveTab(tab.key);
                  if (!isOpen) {
                    setIsOpen(true);
                    saveWatchlistDockOpen(true);
                  }
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.headerRight}>
          <span className={styles.complianceTag}>
            RESEARCH_ONLY · 研究优先级/观察记录，非买卖指令
          </span>
          {isOpen && (
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={() => void loadTabData(activeTab, true)}
              title="刷新当前研究面板"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className={styles.body}>
          {loadingTab === activeTab ? (
            <div className={styles.statusRow}>正在加载只读研究数据...</div>
          ) : errorTab[activeTab] ? (
            <div className={styles.statusRow}>
              <span>研究服务暂不可用（桌面行情盯盘不受影响）</span>
              <button
                type="button"
                className={styles.retryBtn}
                onClick={() => void loadTabData(activeTab, true)}
              >
                重试
              </button>
            </div>
          ) : activeTab === 'radar' ? (
            radarItems.length === 0 ? (
              <div className={styles.statusRow}>暂无雷达股票候选</div>
            ) : (
              <div className={styles.list}>
                {radarItems.map((item) => {
                  const badge = getClassificationLabel(item.turnaround_classification);
                  const selectable = /^(sh|sz|bj)\d{6}$/i.test(item.normalizedCode);
                  return (
                    <div
                      key={item.security_id || item.symbol}
                      className={styles.row}
                      onClick={() => selectable && onSelectSymbol(item.normalizedCode, item.name)}
                    >
                      <span className={styles.codeCell}>{extractBareCode(item.symbol)}</span>
                      <span className={styles.nameCell}>{item.name}</span>
                      <span className={`${styles.pill} ${styles[`tone_${badge.tone}`]}`}>
                        {badge.label}
                      </span>
                      <span className={styles.monoCell}>
                        优先 {formatFiniteFixed(item.research_priority_score, 0)} · F
                        {formatFiniteFixed(item.piotroski_f_score, 0)} Z
                        {formatFiniteFixed(item.altman_z_score, 1)} M
                        {formatFiniteFixed(item.beneish_m_score, 1)}
                      </span>
                      <span className={styles.summaryCell} title={item.summary}>
                        {item.summary}
                      </span>
                      {renderRowActions(item.symbol, item.name)}
                    </div>
                  );
                })}
              </div>
            )
          ) : activeTab === 'eod' ? (
            !latestEodSnapshot || latestEodSnapshot.candidates.length === 0 ? (
              <div className={styles.statusRow}>
                <span>暂无尾盘 2.0 记录快照</span>
                <button
                  type="button"
                  className={styles.retryBtn}
                  onClick={() => navigate('/eod-picker')}
                >
                  前往尾盘选股
                </button>
              </div>
            ) : (
              <div className={styles.list}>
                <div className={styles.subBanner}>
                  {(() => {
                    const regime = getRegimeBadge(latestEodSnapshot.market_regime);
                    return (
                      <span className={`${styles.pill} ${styles[`tone_${regime.tone}`]}`}>
                        {regime.label}
                      </span>
                    );
                  })()}
                  <span>{latestEodSnapshot.trade_date}</span>
                  <span className={styles.bannerScheme}>{latestEodSnapshot.scheme_name}</span>
                </div>
                {latestEodSnapshot.candidates.map((cand) => {
                  const norm = normalizeStockCode(cand.code);
                  const selectable = /^(sh|sz|bj)\d{6}$/i.test(norm);
                  const vettingTone =
                    cand.vetting_status === 'CLEAN'
                      ? 'accent'
                      : cand.vetting_status === 'TRAP_FLAGGED'
                        ? 'fall'
                        : 'warning';
                  const settleText =
                    cand.settlement?.status === 'SETTLED'
                      ? `T+1开盘 ${formatPercent(cand.settlement.t1_open_premium_pct)}`
                      : cand.settlement?.status === 'PARTIAL'
                        ? 'T+1 部分结算'
                        : '待 T+1 结算';

                  return (
                    <div
                      key={`${latestEodSnapshot.snapshot_id}-${cand.code}`}
                      className={styles.row}
                      onClick={() => selectable && onSelectSymbol(norm, cand.name)}
                    >
                      <span className={styles.codeCell}>{extractBareCode(cand.code)}</span>
                      <span className={styles.nameCell}>{cand.name}</span>
                      <span className={`${styles.pill} ${styles[`tone_${vettingTone}`]}`}>
                        {cand.vetting_status || 'UNKNOWN'}
                      </span>
                      <span className={styles.monoCell}>
                        入选 {formatPrice(cand.pick_price)} · 尾30分{' '}
                        {formatPercent(cand.tail_30m_return_pct)} · 额占{' '}
                        {typeof cand.tail_30m_amount_share_pct === 'number' &&
                        Number.isFinite(cand.tail_30m_amount_share_pct)
                          ? `${cand.tail_30m_amount_share_pct.toFixed(1)}%`
                          : '--'}
                      </span>
                      <span className={styles.summaryCell}>{settleText}</span>
                      {renderRowActions(cand.code, cand.name)}
                    </div>
                  );
                })}
              </div>
            )
          ) : activeTab === 'global' ? (
            !globalData || globalData.items.length === 0 ? (
              <div className={styles.statusRow}>暂无外围定价锚快照</div>
            ) : (
              <div className={styles.globalPane} data-testid="watchlist-global-pulse-pane">
                <div className={styles.crossBorderBanner}>
                  <span className={styles.crossBorderTitle}>跨境 ETF 隔夜定价参照</span>
                  <div className={styles.crossBorderMetrics}>
                    <span>
                      纳指100{' '}
                      <strong className={getChangeColorClass(globalData.cross_border_anchors.ndx_pct)}>
                        {formatPercent(globalData.cross_border_anchors.ndx_pct)}
                      </strong>
                    </span>
                    <span>
                      恒生科技{' '}
                      <strong className={getChangeColorClass(globalData.cross_border_anchors.hstech_pct)}>
                        {formatPercent(globalData.cross_border_anchors.hstech_pct)}
                      </strong>
                    </span>
                    <span>
                      日经225{' '}
                      <strong className={getChangeColorClass(globalData.cross_border_anchors.n225_pct)}>
                        {formatPercent(globalData.cross_border_anchors.n225_pct)}
                      </strong>
                    </span>
                    <span>
                      离岸人民币{' '}
                      {globalData.cross_border_anchors.usdcnh_price !== null
                        ? globalData.cross_border_anchors.usdcnh_price.toFixed(4)
                        : '--'}{' '}
                      <span className={getChangeColorClass(globalData.cross_border_anchors.usdcnh_pct)}>
                        ({formatPercent(globalData.cross_border_anchors.usdcnh_pct)})
                      </span>
                    </span>
                  </div>
                  <span className={styles.crossBorderHint}>
                    辅助观察场内 QDII / 跨境 ETF 折溢价合理性 · 更新于{' '}
                    {globalData.as_of_bj.slice(11, 16)}
                  </span>
                </div>
                <div className={styles.globalGroupsGrid}>
                  {GLOBAL_DOCK_REGIONS.map((region) => {
                    const groupItems = globalData.items.filter((it) => it.region === region.key);
                    return (
                      <div key={region.key} className={styles.globalGroupCard}>
                        <div className={styles.globalGroupTitle}>{region.label}</div>
                        {groupItems.map((item) => {
                          const colorCls =
                            item.status !== 'UNAVAILABLE' && item.change_pct !== null
                              ? getChangeColorClass(item.change_pct)
                              : styles.globalMuted;
                          return (
                            <div key={item.code} className={styles.globalItemRow}>
                              <span className={styles.globalItemName}>
                                {item.short_name}
                                <span className={styles.globalSession}>
                                  {item.status === 'UNAVAILABLE' ? '暂不可用' : item.session_label}
                                </span>
                              </span>
                              <span className={styles.globalItemNums}>
                                <span className={styles.globalPrice}>{formatPulsePrice(item)}</span>
                                <span className={`${styles.globalPct} ${colorCls}`}>
                                  {formatPulseChangePct(item)}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          ) : portfolioPositions.length === 0 ? (
            <div className={styles.statusRow}>暂无实证持仓记录</div>
          ) : (
            <div className={styles.list}>
              {portfolioPositions.map((pos) => {
                const norm = normalizeStockCode(pos.symbol);
                const selectable = /^(sh|sz|bj)\d{6}$/i.test(norm);
                return (
                  <div
                    key={pos.symbol}
                    className={styles.row}
                    onClick={() => selectable && onSelectSymbol(norm, pos.name)}
                  >
                    <span className={styles.codeCell}>{extractBareCode(pos.symbol)}</span>
                    <span className={styles.nameCell}>{pos.name}</span>
                    <span className={`${styles.pill} ${styles.tone_accent}`}>
                      {pos.action_label_zh || pos.action}
                    </span>
                    <span className={styles.monoCell}>
                      权重 {formatFiniteFixed(pos.weight_pct, 1)}% · {pos.zero_position_test}
                    </span>
                    <span className={styles.summaryCell} title={pos.trigger_summary}>
                      触发器: {pos.trigger_summary}
                    </span>
                    {renderRowActions(pos.symbol, pos.name)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
