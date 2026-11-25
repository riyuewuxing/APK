import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrainCircuit, ExternalLink } from 'lucide-react';
import { Button, Card, useToast } from '@/components/common';
import {
  fetchResearchCard,
  openNativeKlineWindow,
  type DeepResearchCard,
} from '@/services/expertApi';
import { ActionDecisionPill, ProvenancePill } from './ExpertBadges';
import styles from './StockExpertEvidenceCard.module.css';

interface StockExpertEvidenceCardProps {
  stockCode: string;
}

interface CardFetchState {
  targetCode: string;
  card: DeepResearchCard | null;
  errorMsg: string | null;
}

export function StockExpertEvidenceCard({ stockCode }: StockExpertEvidenceCardProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState<CardFetchState>({
    targetCode: '',
    card: null,
    errorMsg: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchResearchCard(stockCode, controller.signal)
      .then((res) => {
        setState({ targetCode: stockCode, card: res, errorMsg: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : '未能连接投资专家研究后端';
        setState({ targetCode: stockCode, card: null, errorMsg: msg });
      });
    return () => controller.abort();
  }, [stockCode]);

  const loading = state.targetCode !== stockCode;
  const card = state.targetCode === stockCode ? state.card : null;
  const errorMsg = state.targetCode === stockCode ? state.errorMsg : null;

  const handleNativeKline = async () => {
    try {
      const res = await openNativeKlineWindow(stockCode, true);
      toast.success(`已拉起原生 TradingView 窗口 (${res.payload_summary.symbol})`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '桌面窗口启动失败');
    }
  };

  return (
    <Card
      title="投资专家证据卡（PIT 研判）"
      extra={
        card ? (
          <ActionDecisionPill action={card.decision_packet.admission_state === 'ADMITTED' ? card.decision_packet.action : card.decision_packet.action === 'INSUFFICIENT_EVIDENCE' ? 'INSUFFICIENT_EVIDENCE' : 'WAIT'} showZh={false} />
        ) : undefined
      }
    >
      {loading ? (
        <div className={styles.mutedHint}>正在加载本地 ClaimLedger / PIT 证据...</div>
      ) : errorMsg || !card ? (
        <div className={styles.mutedHint}>
          {errorMsg ?? '暂未命中本地投资专家研究快照（只研不下单）。'}
        </div>
      ) : (
        <div className={styles.expertWrap}>
          <div className={styles.topRow}>
            <ActionDecisionPill action={card.decision_packet.admission_state === 'ADMITTED' ? card.decision_packet.action : card.decision_packet.action === 'INSUFFICIENT_EVIDENCE' ? 'INSUFFICIENT_EVIDENCE' : 'WAIT'} />
            {card.decision_packet.admission_state !== 'ADMITTED' && (
              <span className={styles.mutedHint}>未准入 · 研究方向：{card.decision_packet.research_action ?? '未验证'}（非正式建议）</span>
            )}
            <div className={styles.convictionBox}>
              <span className={styles.convictionLabel}>正交净信念</span>
              <span className={styles.convictionScore}>
                {card.decision_packet.composite_conviction_score > 0 ? '+' : ''}
                {card.decision_packet.composite_conviction_score.toFixed(1)}
              </span>
            </div>
          </div>

          <ProvenancePill badge={card.header_badge} />

          {card.turnaround_report && (
            <div className={styles.fzmRow}>
              <div className={styles.fzmTile}>
                <span className={styles.fzmLabel}>ValueInvest F</span>
                <span className={styles.fzmValue}>
                  {card.turnaround_report.piotroski_f_score} / 9
                </span>
              </div>
              <div className={styles.fzmTile}>
                <span className={styles.fzmLabel}>Altman Z</span>
                <span className={styles.fzmValue}>
                  {card.turnaround_report.altman_z_score.toFixed(2)}
                </span>
              </div>
              <div className={styles.fzmTile}>
                <span className={styles.fzmLabel}>Beneish M</span>
                <span className={styles.fzmValue}>
                  {card.turnaround_report.beneish_m_score.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {(card.decision_packet.red_flag_blockers.length > 0 ||
            card.decision_packet.unresolved_gaps.length > 0) && (
            <div className={styles.listBlock}>
              <div className={styles.listTitle}>阻断红旗 / 未解决缺口 (Fail-Closed)</div>
              <div className={styles.bulletList}>
                {card.decision_packet.red_flag_blockers.map((rf) => (
                  <div key={rf} className={`${styles.bulletItem} ${styles.bulletBlocker}`}>
                    {rf}
                  </div>
                ))}
                {card.decision_packet.unresolved_gaps.map((gap) => (
                  <div key={gap} className={`${styles.bulletItem} ${styles.bulletBlocker}`}>
                    {gap}
                  </div>
                ))}
              </div>
            </div>
          )}

          {card.decision_packet.supporting_reasons.length > 0 && (
            <div className={styles.listBlock}>
              <div className={styles.listTitle}>支持依据 (正交去重)</div>
              <div className={styles.bulletList}>
                {card.decision_packet.supporting_reasons.slice(0, 2).map((reason) => (
                  <div key={reason} className={styles.bulletItem}>
                    {reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          {card.decision_packet.counter_reasons.length > 0 && (
            <div className={styles.listBlock}>
              <div className={styles.listTitle}>反方证据与风险</div>
              <div className={styles.bulletList}>
                {card.decision_packet.counter_reasons.slice(0, 2).map((reason) => (
                  <div key={reason} className={`${styles.bulletItem} ${styles.bulletCounter}`}>
                    {reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          {card.decision_packet.change_triggers.length > 0 && (
            <div className={styles.mutedHint}>
              观点触发器：{card.decision_packet.change_triggers[0]}
            </div>
          )}

          <div className={styles.actionsRow}>
            <Button
              size="sm"
              variant="primary"
              icon={<BrainCircuit size={14} />}
              onClick={() => navigate(`/expert?symbol=${encodeURIComponent(card.subject_id)}`)}
            >
              进入专家工作台深研
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<ExternalLink size={14} />}
              onClick={handleNativeKline}
            >
              独立K线窗
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
