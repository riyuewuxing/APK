import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatedNumber, Card, Empty, Loading, Tabs, triggerClickRipple } from '@/components/common';
import type { GlobalMarketOverviewResponse, GlobalSortBy } from '@/services/globalMarketsApi';
import {
  formatCurrencyPrice,
  formatMarketValueByCurrency,
  formatPercent,
  getChangeColorClass,
} from '@/utils/format';
import styles from './Dashboard.module.css';

interface DashboardOuterViewProps {
  overview: GlobalMarketOverviewResponse | null;
  loading: boolean;
  error: string | null;
  marketLabel: string;
}

export function DashboardOuterView({
  overview,
  loading,
  error,
  marketLabel,
}: DashboardOuterViewProps) {
  const navigate = useNavigate();
  const [rankTab, setRankTab] = useState<'change' | 'change_asc' | 'amount'>('change');

  const topStocks = useMemo(() => {
    if (!overview) return [];
    const list = [...overview.stocks];
    if (rankTab === 'change') {
      list.sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0));
    } else if (rankTab === 'change_asc') {
      list.sort((a, b) => (a.change_pct ?? 0) - (b.change_pct ?? 0));
    } else {
      list.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    }
    return list.slice(0, 10);
  }, [overview, rankTab]);

  if (loading && !overview) {
    return <Loading text={`正在加载${marketLabel}市场总览...`} />;
  }

  if (error || !overview || overview.status === 'UNAVAILABLE') {
    return (
      <Empty
        title={`${marketLabel}总览暂不可用`}
        description={error ?? overview?.warnings?.[0] ?? '网络受限或离线模式已启用'}
      />
    );
  }

  const { summary, sectors, stocks } = overview;
  const totalDist = Math.max(1, summary.rise_count + summary.fall_count + summary.flat_count);
  const advSectors = sectors.filter((s) => s.change_pct > 0).length;
  const decSectors = sectors.filter((s) => s.change_pct < 0).length;
  const topSector = sectors[0];
  const totalMarketCap = sectors.reduce((acc, s) => acc + (s.total_market_cap || 0), 0)
    || stocks.reduce((acc, st) => acc + (st.market_cap || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {summary.index_anchors.length > 0 && (
        <section className={styles.indices}>
          {summary.index_anchors.map((idx) => (
            <div
              key={idx.code}
              className={styles.indexCard}
              onClick={(e) => {
                triggerClickRipple(e);
                navigate('/markets');
              }}
            >
              <div className={styles.indexName}>{idx.name}</div>
              <div className={`${styles.indexPrice} ${getChangeColorClass(idx.change_pct)}`}>
                {idx.price != null ? (
                  <AnimatedNumber
                    value={idx.price}
                    format={(n) => Math.round(n).toLocaleString('en-US')}
                    flashOnChange
                  />
                ) : '--'}
              </div>
              <div className={styles.indexChange}>
                <span className={getChangeColorClass(idx.change_pct)}>
                  {formatPercent(idx.change_pct)}
                </span>
              </div>
              <div className={styles.indexAmount}>{overview.session.label}</div>
            </div>
          ))}
        </section>
      )}

      <section className={styles.outerStatsGrid}>
        <Card title={`${marketLabel}代表股涨跌分布`}>
          <div className={styles.statCard}>
            <div className={styles.statValueRow}>
              <span className="text-rise">
                <AnimatedNumber value={summary.rise_count} decimals={0} />
              </span>
              <span className={styles.statDivider}>/</span>
              <span className="text-fall">
                <AnimatedNumber value={summary.fall_count} decimals={0} />
              </span>
            </div>
            <div className={styles.statDesc}>
              涨 {summary.rise_count} 家 · 平 {summary.flat_count} 家 · 跌 {summary.fall_count} 家
            </div>
            <div
              style={{
                display: 'flex',
                height: 6,
                borderRadius: 999,
                overflow: 'hidden',
                marginTop: 8,
                background: 'var(--bg-tertiary)',
              }}
            >
              <div
                style={{
                  width: `${(summary.rise_count / totalDist) * 100}%`,
                  background: 'var(--color-rise)',
                }}
              />
              <div
                style={{
                  width: `${(summary.flat_count / totalDist) * 100}%`,
                  background: 'var(--text-tertiary)',
                }}
              />
              <div
                style={{
                  width: `${(summary.fall_count / totalDist) * 100}%`,
                  background: 'var(--color-fall)',
                }}
              />
            </div>
          </div>
        </Card>

        <Card title="活跃市值与成交">
          <div className={styles.statCard}>
            <div className={styles.statValueLarge}>
              {formatMarketValueByCurrency(summary.total_amount, overview.currency)}
            </div>
            <div className={styles.statDesc}>
              {overview.currency} · 代表覆盖 {summary.total_count} 只 · 盘态 {overview.session.label}
            </div>
          </div>
        </Card>

        <Card title="行业板块广度">
          <div className={styles.statCard}>
            <div className={styles.statValueRow}>
              <span className="text-rise">{advSectors}</span>
              <span className={styles.statDivider}>/</span>
              <span className="text-fall">{decSectors}</span>
            </div>
            <div className={styles.statDesc}>
              领涨行业：{topSector ? `${topSector.name} (${formatPercent(topSector.change_pct)})` : '--'}
            </div>
          </div>
        </Card>

        <Card title="样本总市值聚合">
          <div className={styles.statCard}>
            <div className={styles.statValueLarge}>
              {formatMarketValueByCurrency(totalMarketCap, overview.currency)}
            </div>
            <div className={styles.statDesc}>
              {sectors.length} 个主行业聚合 · 基准更新 {overview.as_of_bj || '--'}
            </div>
          </div>
        </Card>
      </section>

      <Card title={`${marketLabel}热门中文行业板块 (Top 6)`}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          {sectors.slice(0, 6).map((sec) => (
            <div
              key={sec.board_code}
              className={styles.indexCard}
              onClick={(e) => {
                triggerClickRipple(e);
                navigate('/markets');
              }}
            >
              <div className={styles.indexName}>{sec.name}</div>
              <div className={`${styles.indexPrice} ${getChangeColorClass(sec.change_pct)}`}>
                {formatPercent(sec.change_pct)}
              </div>
              <div className={styles.indexAmount}>
                领涨：{sec.leading_stock_name} ({formatPercent(sec.leading_stock_pct)})
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title={`${marketLabel}个股榜 Top 10`}
        extra={
          <Tabs
            items={[
              { key: 'change', label: '涨幅' },
              { key: 'change_asc', label: '跌幅' },
              { key: 'amount', label: '成交额' },
            ]}
            activeKey={rankTab}
            onChange={(k) => setRankTab(k as Exclude<GlobalSortBy, 'market_cap'>)}
          />
        }
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
                <th style={{ padding: '6px 8px' }}>#</th>
                <th style={{ padding: '6px 8px' }}>标的</th>
                <th style={{ padding: '6px 8px' }}>现价</th>
                <th style={{ padding: '6px 8px' }}>涨跌幅</th>
                <th style={{ padding: '6px 8px' }}>行业</th>
                <th style={{ padding: '6px 8px' }}>成交额</th>
              </tr>
            </thead>
            <tbody>
              {topStocks.map((st, idx) => (
                <tr
                  key={st.symbol}
                  style={{ borderTop: '1px solid var(--border-secondary)', cursor: 'pointer' }}
                  onClick={(e) => {
                    triggerClickRipple(e);
                    navigate(`/s/${st.symbol}`);
                  }}
                >
                  <td style={{ padding: '7px 8px' }}>{idx + 1}</td>
                  <td style={{ padding: '7px 8px' }}>
                    <strong>{st.name}</strong>{' '}
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{st.symbol}</span>
                  </td>
                  <td style={{ padding: '7px 8px' }}>
                    {formatCurrencyPrice(st.price, st.currency)}
                  </td>
                  <td style={{ padding: '7px 8px' }} className={getChangeColorClass(st.change_pct)}>
                    {formatPercent(st.change_pct)}
                  </td>
                  <td style={{ padding: '7px 8px' }}>{st.industry || st.sector}</td>
                  <td style={{ padding: '7px 8px' }}>
                    {formatMarketValueByCurrency(st.amount, st.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
