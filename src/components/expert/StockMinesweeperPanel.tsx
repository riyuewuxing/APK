import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import { Button, Card } from '@/components/common';
import {
  MINESWEEPER_OVERALL_LABELS,
  RULE_STATUS_LABELS,
  fetchFilingMinesweeper,
  type FilingMinesweeperReport,
  type MinesweeperCategoryKey,
  type MinesweeperRuleStatus,
} from '@/services/researchAdvApi';
import styles from './StockMinesweeperPanel.module.css';

interface StockMinesweeperPanelProps {
  stockCode: string;
}

interface FetchState {
  targetCode: string;
  report: FilingMinesweeperReport | null;
  errorMsg: string | null;
}

function statusPillClass(status: MinesweeperRuleStatus | FilingMinesweeperReport['overall_status']): string {
  if (status === 'RED_FLAG') return styles.pillRed;
  if (status === 'WARN') return styles.pillWarn;
  if (status === 'PASS' || status === 'CLEAN') return styles.pillPass;
  if (status === 'NOT_APPLICABLE') return styles.pillMuted;
  return styles.pillUnknown;
}

export function StockMinesweeperPanel({ stockCode }: StockMinesweeperPanelProps) {
  const location = useLocation();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<FetchState>({
    targetCode: '',
    report: null,
    errorMsg: null,
  });
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const [catFilter, setCatFilter] = useState<'ALL' | MinesweeperCategoryKey>('ALL');
  const [onlyRiskOrUnknown, setOnlyRiskOrUnknown] = useState(false);

  const isHashTarget = location.hash === '#minesweeper';
  const expanded = manualExpanded ?? isHashTarget;

  useEffect(() => {
    if (isHashTarget) {
      const timer = window.setTimeout(() => {
        anchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 180);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [isHashTarget]);

  useEffect(() => {
    const controller = new AbortController();
    fetchFilingMinesweeper(stockCode, controller.signal)
      .then((res) => {
        setState({ targetCode: stockCode, report: res, errorMsg: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          targetCode: stockCode,
          report: null,
          errorMsg: err instanceof Error ? err.message : '未能加载 30 条财报排雷体检',
        });
      });
    return () => controller.abort();
  }, [stockCode]);

  const loading = state.targetCode !== stockCode;
  const report = state.targetCode === stockCode ? state.report : null;
  const errorMsg = state.targetCode === stockCode ? state.errorMsg : null;

  const flaggedPreview = useMemo(() => {
    if (!report) return [];
    return report.rules
      .filter((r) => r.status === 'RED_FLAG' || r.status === 'WARN')
      .slice(0, 3);
  }, [report]);

  const filteredRules = useMemo(() => {
    if (!report) return [];
    return report.rules.filter((r) => {
      if (catFilter !== 'ALL' && r.category !== catFilter) return false;
      if (onlyRiskOrUnknown && r.status === 'PASS') return false;
      return true;
    });
  }, [report, catFilter, onlyRiskOrUnknown]);

  return (
    <div id="minesweeper" ref={anchorRef}>
      <Card
        title="财报排雷 30 条清单（M4a · 只读体检）"
      extra={
        report && !report.asset_semantic_isolated ? (
          <Button
            size="sm"
            variant="secondary"
            icon={expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            aria-expanded={expanded}
            data-testid="minesweeper-toggle-btn"
            onClick={() => setManualExpanded((prev) => !(prev ?? isHashTarget))}
          >
            {expanded ? '收起 30 条清单' : '展开全部 30 条'}
          </Button>
        ) : undefined
      }
    >
      <div className={styles.wrap} data-testid="stock-minesweeper-panel">
        {loading ? (
          <div className={styles.mutedHint}>正在核查近 90 天巨潮公告、质押解禁与财务三表 30 项排雷规则...</div>
        ) : errorMsg || !report ? (
          <div className={styles.mutedHint}>{errorMsg ?? '暂无财报排雷体检记录。'}</div>
        ) : report.asset_semantic_isolated ? (
          <div className={styles.noticeBanner}>
            <strong>资产语义隔离生效：</strong>
            {report.notice}
          </div>
        ) : (
          <>
            <div className={styles.summaryBar}>
              <div className={styles.statusRow}>
                <span className={statusPillClass(report.overall_status)}>
                  <ShieldAlert size={13} />
                  <span>{MINESWEEPER_OVERALL_LABELS[report.overall_status]}</span>
                </span>
                {report.report_name && (
                  <span className={styles.metaText}>
                    报告期：{report.report_name} ({report.report_date ?? '--'})
                  </span>
                )}
              </div>
              <span className={styles.metaText}>
                风险分：{report.risk_score !== null ? `${report.risk_score.toFixed(1)} / 100` : 'UNKNOWN'}
                {report.pledge_ratio_pct !== null && ` · 质押 ${report.pledge_ratio_pct.toFixed(2)}%`}
              </span>
            </div>

            <div className={styles.kpiStrip}>
              <div className={styles.kpiCell}>
                <span className={styles.kpiLabel}>高危红旗</span>
                <span className={styles.kpiVal}>{report.red_flag_count}</span>
              </div>
              <div className={styles.kpiCell}>
                <span className={styles.kpiLabel}>关注预警</span>
                <span className={styles.kpiVal}>{report.warn_count}</span>
              </div>
              <div className={styles.kpiCell}>
                <span className={styles.kpiLabel}>缺失未知 (Fail-Closed)</span>
                <span className={styles.kpiVal}>{report.unknown_count}</span>
              </div>
              <div className={styles.kpiCell}>
                <span className={styles.kpiLabel}>检验通过</span>
                <span className={styles.kpiVal}>{report.pass_count}</span>
              </div>
            </div>

            {!expanded && flaggedPreview.length > 0 && (
              <div className={styles.previewList}>
                {flaggedPreview.map((item) => (
                  <div
                    key={item.rule_id}
                    className={`${styles.previewItem} ${item.status === 'WARN' ? styles.previewWarn : ''}`}
                  >
                    <strong>
                      [{item.rule_id} {RULE_STATUS_LABELS[item.status]}] {item.title_zh}
                    </strong>{' '}
                    ({item.metric_display}) — {item.detail}
                  </div>
                ))}
              </div>
            )}

            <div className={styles.noticeBanner}>{report.notice}</div>

            {expanded && (
              <div data-testid="minesweeper-expanded-list" className={styles.wrap}>
                <div className={styles.filterRow}>
                  <div className={styles.chipGroup}>
                    <button
                      type="button"
                      className={`${styles.filterChip} ${catFilter === 'ALL' ? styles.filterChipActive : ''}`}
                      onClick={() => setCatFilter('ALL')}
                    >
                      全部 ({report.rules.length})
                    </button>
                    {report.categories.map((cat) => (
                      <button
                        key={cat.category}
                        type="button"
                        className={`${styles.filterChip} ${catFilter === cat.category ? styles.filterChipActive : ''}`}
                        onClick={() => setCatFilter(cat.category)}
                      >
                        {cat.label} ({cat.red_flag}红/{cat.warn}警/{cat.unknown}缺)
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={`${styles.filterChip} ${onlyRiskOrUnknown ? styles.filterChipActive : ''}`}
                    onClick={() => setOnlyRiskOrUnknown((prev) => !prev)}
                  >
                    {onlyRiskOrUnknown ? '显示全部项' : '仅看红旗 / 预警 / UNKNOWN'}
                  </button>
                </div>

                <div className={styles.rulesList}>
                  {filteredRules.length === 0 ? (
                    <div className={styles.mutedHint}>
                      当前筛选条件下无匹配规则（点击「显示全部项」可查看全部 {report.rules.length} 条）。
                    </div>
                  ) : (
                    filteredRules.map((rule) => (
                      <div key={rule.rule_id} className={styles.ruleCard}>
                        <div className={styles.ruleHead}>
                          <div className={styles.ruleTitleWrap}>
                            <span className={styles.ruleId}>{rule.rule_id}</span>
                            <span className={styles.ruleTitle}>{rule.title_zh}</span>
                          </div>
                          <span className={statusPillClass(rule.status)}>
                            {RULE_STATUS_LABELS[rule.status]} · {rule.metric_display}
                          </span>
                        </div>
                        <div className={styles.ruleMeta}>
                          <span>{rule.detail}</span>
                          <span>阈值：{rule.threshold_desc}</span>
                          <span>来源：{rule.evidence_source}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {report.recent_disclosures.length > 0 && (
                  <div className={styles.discList}>
                    <div className={styles.discTitle}>
                      近 90 天巨潮公开公告扫描样本 ({report.recent_disclosures.length} 条)
                    </div>
                    {report.recent_disclosures.slice(0, 6).map((disc, idx) => (
                      <div key={`${disc.date}-${idx}`} className={styles.discRow}>
                        <span className={styles.metaText}>{disc.date}</span>
                        <span>{disc.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
    </div>
  );
}
