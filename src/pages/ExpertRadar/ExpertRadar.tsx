import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button, Card, Empty, Loading, Tabs } from '@/components/common';
import { GovernanceBanner, ProvenancePill } from '@/components/expert';
import {
  fetchAudit,
  fetchRadar,
  toStockDetailRoute,
  triggerPitSync,
  type AuditState,
  type RadarState,
  type RadarStockEntry,
} from '@/services/expertApi';
import styles from './ExpertRadar.module.css';

const RADAR_TABS = [
  { key: 'stock_radar', label: 'A股困境反转 & 价值陷阱' },
  { key: 'etf_fund_radar', label: 'ETF 与公募基金专属透镜' },
  { key: 'audit_ledger', label: 'ClaimLedger & 数据源审计' },
];

const LENS_LABEL_ZH: Record<string, string> = {
  VALUATION: '估值透镜',
  REVERSAL_LIQUIDITY: '反转/流动性',
  MOMENTUM_DIFFUSION: '动量扩散',
  QUALITY_COMPOUNDER: '质量复利',
  FUNDAMENTAL: '基本面',
};

const TURNAROUND_CLASS_ZH: Record<string, string> = {
  TRUE_TURNAROUND: '真·困境反转',
  VALUE_TRAP_WARNING: '价值陷阱告警',
  NEUTRAL_OBSERVE: '中性观察',
};

const RADAR_STATE_ZH: Record<string, string> = {
  HOLDING_REVIEW: '持仓复核',
  TURNAROUND_WATCH: '反转观察',
  TRAP_BLOCKED: '陷阱拦截',
  REJECTED: '未入围研究',
  CLOSED: '已闭环',
  WATCHLIST: '观察池',
};

export function ExpertRadar() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>('stock_radar');
  const [radar, setRadar] = useState<RadarState | null>(null);
  const [audit, setAudit] = useState<AuditState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [claimStatusFilter, setClaimStatusFilter] = useState<string>('ALL');
  const [showAllDiscovery, setShowAllDiscovery] = useState<boolean>(false);
  const [syncingPit, setSyncingPit] = useState<boolean>(false);

  const handleSyncPit = async () => {
    setSyncingPit(true);
    try {
      await triggerPitSync();
      const [rData, aData] = await Promise.all([fetchRadar(), fetchAudit()]);
      setRadar(rData);
      setAudit(aData);
      setErrorMsg(null);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '同步零Key PIT快照失败');
    } finally {
      setSyncingPit(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchRadar(controller.signal), fetchAudit(controller.signal)])
      .then(([rData, aData]) => {
        setRadar(rData);
        setAudit(aData);
        setErrorMsg(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setErrorMsg(err instanceof Error ? err.message : '加载雷达与审计状态失败');
      });
    return () => controller.abort();
  }, []);

  const filteredClaims = useMemo(() => {
    if (!audit) return [];
    if (claimStatusFilter === 'ALL') return audit.claims;
    return audit.claims.filter((c) => c.verification_status === claimStatusFilter);
  }, [audit, claimStatusFilter]);

  const renderStockRows = (rows: RadarStockEntry[], showRedFlags: boolean) => {
    if (!rows.length) return <Empty description="暂无标的记录" />;
    return (
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>代码 / 名称</th>
              <th>主透镜 / 诊断分类</th>
              <th>研究优先级分</th>
              <th>反转 / 陷阱评分</th>
              <th>ValueInvest F / Z / M</th>
              {showRedFlags && <th>触发红旗</th>}
              <th>核心依据与溯源</th>
              <th>联动操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              const marketRoute = toStockDetailRoute(entry.symbol);
              return (
                <tr key={`${entry.symbol}-${entry.security_id}`}>
                  <td>
                    <div className={styles.primaryCell}>
                      {entry.symbol} {entry.name}
                    </div>
                    <div className={styles.subMeta} title={entry.state}>
                      {RADAR_STATE_ZH[entry.state] ?? entry.state}
                    </div>
                  </td>
                  <td>
                    <div className={styles.tagStack}>
                      <span className={styles.tag} title={entry.primary_lens}>
                        {LENS_LABEL_ZH[entry.primary_lens] ?? entry.primary_lens}
                      </span>
                      <span
                        className={`${styles.tag} ${
                          entry.turnaround_classification === 'VALUE_TRAP_WARNING'
                            ? styles.tagDanger
                            : entry.turnaround_classification === 'TRUE_TURNAROUND'
                              ? styles.tagSuccess
                              : ''
                        }`}
                        title={entry.turnaround_classification}
                      >
                        {TURNAROUND_CLASS_ZH[entry.turnaround_classification] ??
                          entry.turnaround_classification}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className={styles.scoreHighlight}>
                      {entry.research_priority_score.toFixed(1)}
                    </div>
                    <div className={styles.subMeta} title={entry.ranking_semantics}>
                      优先级 · 非预测
                    </div>
                  </td>
                  <td>
                    <div className={styles.stackedMetric}>
                      <span>反转 {entry.turnaround_score.toFixed(1)}</span>
                      <span>陷阱 {entry.trap_risk_score.toFixed(1)}</span>
                    </div>
                  </td>
                  <td className={styles.noWrapMono}>
                    F {entry.piotroski_f_score}/9 · Z {entry.altman_z_score.toFixed(2)} · M{' '}
                    {entry.beneish_m_score.toFixed(2)}
                  </td>
                  {showRedFlags && (
                    <td>
                      {entry.red_flag_titles.length > 0 ? (
                        <div className={styles.flagStack}>
                          {entry.red_flag_titles.map((rf) => (
                            <span key={rf} className={`${styles.tag} ${styles.tagDanger}`}>
                              {rf}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span>--</span>
                      )}
                    </td>
                  )}
                  <td>
                    <div className={styles.summaryText}>{entry.summary}</div>
                    <ProvenancePill badge={entry.badge} compact variant="subtle" />
                  </td>
                  <td>
                    <div className={styles.linkActions}>
                      <Button
                        size="md"
                        variant="primary"
                        onClick={() =>
                          navigate(`/expert?symbol=${encodeURIComponent(entry.symbol)}`)
                        }
                      >
                        工作台深研
                      </Button>
                      {marketRoute && (
                        <Button
                          size="md"
                          variant="secondary"
                          icon={<ArrowUpRight size={14} />}
                          onClick={() => navigate(marketRoute)}
                        >
                          实时行情
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  if ((!radar || !audit) && !errorMsg) {
    return <Loading fullScreen text="正在加载多资产雷达与 ClaimLedger 契约审计..." />;
  }

  return (
    <div className={styles.page}>
      {audit && <GovernanceBanner governance={audit.governance} />}

      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <h1 className={styles.pageTitle}>多资产机会雷达与数据源审计 (Expert Radar)</h1>
          <span className={styles.pageSubtitle}>
            严格资产语义隔离：STOCK 财务排雷 ≠ INDEX_ETF 被动跟踪 ≠ ACTIVE_ETF 策略超额 ≠ PUBLIC_FUND 基金经理任期
          </span>
        </div>
        <Tabs items={RADAR_TABS} activeKey={activeTab} onChange={setActiveTab} />
      </div>

      {errorMsg && (
        <Card title="数据加载异常">
          <Empty description={errorMsg} />
        </Card>
      )}

      {activeTab === 'stock_radar' && radar && (
        <div className={styles.sectionStack}>
          <div className={styles.semanticsBanner}>
            <span>
              <strong>排名语义声明：RESEARCH_PRIORITY_NOT_RETURN_FORECAST</strong> —— 以下分值仅代表「值得投入深度研究的时间优先级」，绝非未来涨跌预测或自动下单指令。
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <span className={styles.tag}>PIT Snapshot Store: {radar.snapshot_store_count} 份</span>
              <Button
                size="md"
                variant="secondary"
                icon={<RefreshCw size={13} />}
                disabled={syncingPit}
                onClick={handleSyncPit}
              >
                {syncingPit ? '同步中...' : '同步零Key PIT数据'}
              </Button>
            </div>
          </div>

          <Card title={`真·困境反转观察 (${radar.turnaround_candidates.length})`}>
            {renderStockRows(radar.turnaround_candidates, false)}
          </Card>

          <Card
            title={`价值陷阱排雷告警 (${radar.value_trap_warnings.length})`}
            extra={
              <span className={`${styles.tag} ${styles.tagDanger}`}>
                <AlertTriangle size={12} /> 红旗样本拦截
              </span>
            }
          >
            {renderStockRows(radar.value_trap_warnings, true)}
          </Card>

          <Card
            title={`CN_A_STOCK 全市场发现池 (${radar.stock_discovery.length})`}
            extra={
              radar.stock_discovery.length > 5 ? (
                <Button
                  size="md"
                  variant="secondary"
                  onClick={() => setShowAllDiscovery((prev) => !prev)}
                >
                  {showAllDiscovery
                    ? '收起至前 5 条'
                    : `展开全部 (${radar.stock_discovery.length})`}
                </Button>
              ) : undefined
            }
          >
            {renderStockRows(
              showAllDiscovery ? radar.stock_discovery : radar.stock_discovery.slice(0, 5),
              false
            )}
            {radar.stock_discovery.length > 5 && (
              <div className={styles.collapseBar}>
                <span>
                  当前展示{' '}
                  {showAllDiscovery ? radar.stock_discovery.length : 5} /{' '}
                  {radar.stock_discovery.length} 条发现样本（按研究优先级排序）
                </span>
                <Button
                  size="md"
                  variant="secondary"
                  onClick={() => setShowAllDiscovery((prev) => !prev)}
                >
                  {showAllDiscovery
                    ? '收起列表'
                    : `展开剩余 ${radar.stock_discovery.length - 5} 条`}
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'etf_fund_radar' && radar && (
        <div className={styles.sectionStack}>
          <div className={styles.semanticsBanner}>
            <span>
              <strong>Round 3 多资产硬边界：</strong>INDEX_ETF（跟踪误差 / 折溢价 / IOPV / 流动性价差）与
              ACTIVE_ETF（业绩基准超额 / 策略风控）及 PUBLIC_FUND（基金经理任期 / 滚动超额 / 申赎规则）严格分表评价。
            </span>
            <span className={styles.tag}>as_of {radar.as_of}</span>
          </div>

          <Card title={`被动指数 ETF · INDEX_ETF (${radar.index_etfs.length})`}>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>代码 / 名称</th>
                    <th>跟踪指数</th>
                    <th>市价 / IOPV参考</th>
                    <th>实时折溢价</th>
                    <th>跟踪偏离/误差</th>
                    <th>价差 / 费率</th>
                    <th>质量状态 / Lens分</th>
                    <th>溯源与深研</th>
                  </tr>
                </thead>
                <tbody>
                  {radar.index_etfs.map((etf) => (
                    <tr key={etf.listed_security_id}>
                      <td className={styles.mono}>
                        <strong>{etf.symbol}</strong> {etf.name}
                      </td>
                      <td>{etf.benchmark_or_index}</td>
                      <td className={styles.mono}>
                        {etf.market_price.toFixed(3)} / {etf.reference_value.toFixed(3)}
                      </td>
                      <td className={styles.mono}>
                        {etf.premium_discount_pct !== null
                          ? `${etf.premium_discount_pct > 0 ? '+' : ''}${etf.premium_discount_pct.toFixed(3)}%`
                          : '--'}
                      </td>
                      <td>{etf.tracking_error_or_excess}</td>
                      <td className={styles.mono}>
                        {etf.liquidity_spread_bps.toFixed(1)} bps / {etf.fee_bps.toFixed(0)} bps
                      </td>
                      <td className={styles.mono}>
                        {etf.quality_status} ({etf.lens_score.toFixed(1)})
                      </td>
                      <td>
                        <div className={styles.summaryText}>{etf.summary}</div>
                        <div className={styles.linkActions}>
                          <ProvenancePill badge={etf.badge} compact variant="subtle" />
                          <Button
                            size="md"
                            variant="primary"
                            onClick={() =>
                              navigate(`/expert?symbol=${encodeURIComponent(etf.symbol)}`)
                            }
                          >
                            深研
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`主动策略 ETF · ACTIVE_ETF (${radar.active_etfs.length} · 禁止套用被动跟踪误差)`}>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>代码 / 名称</th>
                    <th>正式业绩基准</th>
                    <th>策略超额表现</th>
                    <th>市价 / 参考净值</th>
                    <th>价差 / 费率</th>
                    <th>Lens 评分</th>
                    <th>溯源与深研</th>
                  </tr>
                </thead>
                <tbody>
                  {radar.active_etfs.map((etf) => (
                    <tr key={etf.listed_security_id}>
                      <td className={styles.mono}>
                        <strong>{etf.symbol}</strong> {etf.name}
                      </td>
                      <td>{etf.benchmark_or_index}</td>
                      <td>{etf.tracking_error_or_excess}</td>
                      <td className={styles.mono}>
                        {etf.market_price.toFixed(3)} / {etf.reference_value.toFixed(3)}
                      </td>
                      <td className={styles.mono}>
                        {etf.liquidity_spread_bps.toFixed(1)} bps / {etf.fee_bps.toFixed(0)} bps
                      </td>
                      <td className={styles.mono}>
                        {etf.quality_status} ({etf.lens_score.toFixed(1)})
                      </td>
                      <td>
                        <div className={styles.summaryText}>{etf.summary}</div>
                        <div className={styles.linkActions}>
                          <ProvenancePill badge={etf.badge} compact variant="subtle" />
                          <Button
                            size="md"
                            variant="primary"
                            onClick={() =>
                              navigate(`/expert?symbol=${encodeURIComponent(etf.symbol)}`)
                            }
                          >
                            深研
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`公募基金专属透镜 · PUBLIC_FUND (${radar.public_funds.length})`}>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>代码 / 名称</th>
                    <th>类别</th>
                    <th>经理任期</th>
                    <th>1年滚动超额</th>
                    <th>最大回撤修复</th>
                    <th>风格一致性 / 费率</th>
                    <th>申赎状态</th>
                    <th>溯源与深研</th>
                  </tr>
                </thead>
                <tbody>
                  {radar.public_funds.map((f) => (
                    <tr key={f.fund_code}>
                      <td className={styles.mono}>
                        <strong>{f.fund_code}</strong> {f.fund_name}
                      </td>
                      <td>{f.category}</td>
                      <td className={styles.mono}>{f.manager_tenure_years.toFixed(1)} 年</td>
                      <td className={styles.mono}>
                        {f.rolling_excess_1y_pct > 0 ? '+' : ''}
                        {f.rolling_excess_1y_pct.toFixed(2)}%
                      </td>
                      <td className={styles.mono}>{f.max_drawdown_recovery_days} 天</td>
                      <td>
                        {f.style_consistency} ({f.fee_rate_pct.toFixed(2)}%)
                      </td>
                      <td>
                        <span className={styles.tag}>{f.subscription_state}</span>
                      </td>
                      <td>
                        <div className={styles.summaryText}>{f.summary}</div>
                        <div className={styles.linkActions}>
                          <ProvenancePill badge={f.badge} compact variant="subtle" />
                          <Button
                            size="md"
                            variant="primary"
                            onClick={() =>
                              navigate(`/expert?symbol=${encodeURIComponent(f.fund_code)}`)
                            }
                          >
                            深研
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'audit_ledger' && audit && (
        <div className={styles.sectionStack}>
          <Card title="ClaimLedger 完整性密封核验">
            <div className={styles.kpiGrid4}>
              <div className={styles.kpiTile}>
                <span className={styles.kpiLabel}>Manifest / Internal Seal</span>
                <span className={styles.kpiVal}>
                  {audit.manifest_ledger_match && audit.internal_seal_match ? (
                    <span className={`${styles.tag} ${styles.tagSuccess}`}>
                      <ShieldCheck size={12} /> SEALED & VERIFIED
                    </span>
                  ) : (
                    <span className={`${styles.tag} ${styles.tagDanger}`}>HASH_MISMATCH</span>
                  )}
                </span>
              </div>
              <div className={styles.kpiTile}>
                <span className={styles.kpiLabel}>Ledger ID / as_of</span>
                <span className={styles.kpiVal}>
                  {audit.ledger_id} · {audit.ledger_as_of}
                </span>
              </div>
              <div className={styles.kpiTile}>
                <span className={styles.kpiLabel}>EvidenceGraph 图谱规模</span>
                <span className={styles.kpiVal}>
                  {audit.graph_node_count} 节点 · {audit.graph_relation_count} 关系
                </span>
              </div>
              <div className={styles.kpiTile}>
                <span className={styles.kpiLabel}>已入库 Claims / Gaps</span>
                <span className={styles.kpiVal}>
                  {audit.claims.length} 条 Claims · {audit.gap_items.length} 条 Gaps
                </span>
              </div>
            </div>
            <div className={styles.kpiLabel}>SHA-256: {audit.raw_ledger_sha256}</div>
            <div className={styles.kpiLabel}>{audit.hash_note}</div>
          </Card>

          <Card title="数据源契约状态 (data_source_contracts.yml)">
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>数据源</th>
                    <th>类别</th>
                    <th>运行状态</th>
                    <th>交叉校验模式</th>
                    <th>详细说明</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.source_health.map((src) => (
                    <tr key={src.source_name}>
                      <td className={styles.mono}>{src.source_name}</td>
                      <td>{src.category}</td>
                      <td>
                        <span className={`${styles.tag} ${styles.tagSuccess}`}>{src.status}</span>
                      </td>
                      <td className={styles.mono}>{src.crosscheck_mode}</td>
                      <td>{src.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`PIT 数据快照 Manifest (${audit.snapshots.length})`}>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>数据集 ID</th>
                    <th>Snapshot ID</th>
                    <th>资产类型</th>
                    <th>PIT 基准日</th>
                    <th>行数</th>
                    <th>SHA-256 / 核验</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.snapshots.map((snap) => (
                    <tr key={`${snap.dataset_id}-${snap.snapshot_id}`}>
                      <td className={styles.mono}>{snap.dataset_id}</td>
                      <td className={styles.mono}>{snap.snapshot_id}</td>
                      <td>{snap.dataset_kind}</td>
                      <td className={styles.mono}>{snap.research_as_of}</td>
                      <td className={styles.mono}>{snap.row_count}</td>
                      <td className={styles.mono}>
                        {snap.verified ? 'VERIFIED' : 'UNVERIFIED'} ({snap.content_sha256.slice(0, 12)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`GapAnalysis 缺口处置记录 (${audit.gap_items.length})`}>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Requirement ID</th>
                    <th>处置状态</th>
                    <th>关联 Claims</th>
                    <th>论证理由</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.gap_items.map((g) => (
                    <tr key={g.requirement_id}>
                      <td className={styles.mono}>{g.requirement_id}</td>
                      <td>
                        <span className={styles.tag}>{g.disposition}</span>
                      </td>
                      <td className={styles.mono}>{g.resolved_claim_ids.join(', ') || '--'}</td>
                      <td>{g.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`ClaimLedger 证据切片 (${filteredClaims.length} / ${audit.claims.length})`}>
            <div className={styles.filterRow}>
              {['ALL', 'SUPPORTED', 'CONFLICTED', 'UNVERIFIED', 'STALE', 'UNKNOWN', 'REJECTED'].map(
                (st) => {
                  const cnt =
                    st === 'ALL' ? audit.claims.length : (audit.status_counts[st] ?? 0);
                  if (st !== 'ALL' && cnt === 0) return null;
                  return (
                    <button
                      key={st}
                      type="button"
                      className={`${styles.filterChip} ${
                        claimStatusFilter === st ? styles.filterActive : ''
                      }`}
                      onClick={() => setClaimStatusFilter(st)}
                    >
                      {st} ({cnt})
                    </button>
                  );
                }
              )}
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Claim ID</th>
                    <th>标的</th>
                    <th>域 / 类型</th>
                    <th>核验状态 / 可信度</th>
                    <th>证据内容与来源</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.map((claim) => (
                    <tr key={claim.claim_id}>
                      <td className={styles.mono}>{claim.claim_id}</td>
                      <td className={styles.mono}>{claim.subject_ids.join(', ')}</td>
                      <td>
                        {claim.domain} · <span className={styles.tag}>{claim.kind}</span>
                      </td>
                      <td className={styles.mono}>
                        {claim.verification_status} / {claim.confidence}
                      </td>
                      <td>
                        <div className={styles.summaryText}>{claim.claim_text}</div>
                        <div className={styles.kpiLabel}>
                          Sources: {claim.source_ids.join(', ') || '--'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

