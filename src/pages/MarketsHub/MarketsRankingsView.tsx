import { useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Empty, Tabs, triggerClickRipple, useToast } from '@/components/common';
import type { GlobalMarketOverviewResponse, GlobalSortBy } from '@/services/globalMarketsApi';
import { selectAllCodes, watchlistActions, watchlistStore } from '@/services/watchlistStore';
import {
  formatCurrencyPrice,
  formatMarketValueByCurrency,
  formatPercent,
  getChangeColorClass,
} from '@/utils/format';
import styles from './MarketsHub.module.css';

interface MarketsRankingsViewProps {
  overview: GlobalMarketOverviewResponse;
  searchQuery: string;
  sortBy: GlobalSortBy;
  onSortChange: (sort: GlobalSortBy) => void;
  onSelectSector?: (sectorKey: string) => void;
}

export function MarketsRankingsView({
  overview,
  searchQuery,
  sortBy,
  onSortChange,
  onSelectSector,
}: MarketsRankingsViewProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [rightTab, setRightTab] = useState<'stocks' | 'sub'>('stocks');
  const snapshot = useSyncExternalStore(watchlistStore.subscribe, watchlistStore.getSnapshot);
  const watchSet = useMemo(() => new Set(selectAllCodes(snapshot)), [snapshot]);

  const kw = searchQuery.trim().toLowerCase();

  const filteredSectors = useMemo(() => {
    const base = [...overview.sectors];
    if (sortBy === 'change') base.sort((a, b) => b.change_pct - a.change_pct);
    else if (sortBy === 'change_asc') base.sort((a, b) => a.change_pct - b.change_pct);
    else if (sortBy === 'amount') base.sort((a, b) => b.total_amount - a.total_amount);
    else base.sort((a, b) => b.total_market_cap - a.total_market_cap);
    if (!kw) return base;
    return base.filter(
      (s) => s.name.toLowerCase().includes(kw) || s.leading_stock_name.toLowerCase().includes(kw)
    );
  }, [overview.sectors, sortBy, kw]);

  const filteredStocks = useMemo(() => {
    const base = [...overview.stocks];
    if (sortBy === 'change') base.sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0));
    else if (sortBy === 'change_asc') base.sort((a, b) => (a.change_pct ?? 0) - (b.change_pct ?? 0));
    else if (sortBy === 'amount') base.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    else base.sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0));
    if (!kw) return base.slice(0, 80);
    return base
      .filter(
        (s) =>
          s.name.toLowerCase().includes(kw) ||
          s.en_name.toLowerCase().includes(kw) ||
          s.symbol.toLowerCase().includes(kw) ||
          s.sector.toLowerCase().includes(kw)
      )
      .slice(0, 80);
  }, [overview.stocks, sortBy, kw]);

  const toggleWatch = (symbol: string, name: string) => {
    if (watchSet.has(symbol)) {
      watchlistActions.remove(symbol);
      toast.info(`已移出自选：${name}`);
    } else {
      watchlistActions.add(symbol);
      toast.success(`已加入自选：${name}`);
    }
  };

  return (
    <div className={styles.dualGrid}>
      <Card
        title="行业板块榜（市值加权）"
        padding="sm"
        className={styles.rankCard}
        extra={
          <Tabs
            items={[
              { key: 'change', label: '涨幅' },
              { key: 'change_asc', label: '跌幅' },
              { key: 'amount', label: '成交额' },
              { key: 'market_cap', label: '总市值' },
            ]}
            activeKey={sortBy}
            onChange={(k) => onSortChange(k as GlobalSortBy)}
          />
        }
      >
        {filteredSectors.length === 0 ? (
          <Empty title="暂无匹配行业" />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>行业板块</th>
                  <th>涨跌幅</th>
                  <th>领涨股</th>
                  <th>涨/跌</th>
                  <th>总市值</th>
                </tr>
              </thead>
              <tbody>
                {filteredSectors.map((sec, idx) => (
                  <tr
                    key={sec.board_code}
                    className={styles.rowClickable}
                    onClick={(e) => {
                      triggerClickRipple(e);
                      onSelectSector?.(sec.board_code);
                    }}
                  >
                    <td>{idx + 1}</td>
                    <td className={styles.nameMain}>{sec.name}</td>
                    <td
                      className={`${styles.pctHeatCell} ${getChangeColorClass(sec.change_pct)}`}
                      style={{
                        '--pct-fill': `${Math.min(100, (Math.abs(sec.change_pct) / 8) * 100).toFixed(1)}%`,
                        '--pct-color': sec.change_pct >= 0 ? 'var(--color-rise)' : 'var(--color-fall)',
                      } as React.CSSProperties}
                    >
                      <span className={styles.pctHeatText}>{formatPercent(sec.change_pct)}</span>
                    </td>
                    <td>
                      <div className={styles.nameMain}>{sec.leading_stock_name}</div>
                      <div className={getChangeColorClass(sec.leading_stock_pct)}>
                        {formatPercent(sec.leading_stock_pct)}
                      </div>
                    </td>
                    <td>
                      <span className="text-rise">{sec.rise_count}</span>/
                      <span className="text-fall">{sec.fall_count}</span>
                    </td>
                    <td>{formatMarketValueByCurrency(sec.total_market_cap, overview.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title={rightTab === 'stocks' ? '全市场代表个股榜' : '细分行业榜'}
        padding="sm"
        className={styles.rankCard}
        extra={
          <Tabs
            items={[
              { key: 'stocks', label: '个股榜' },
              { key: 'sub', label: '细分行业' },
            ]}
            activeKey={rightTab}
            onChange={(k) => setRightTab(k as 'stocks' | 'sub')}
          />
        }
      >
        {rightTab === 'stocks' ? (
          filteredStocks.length === 0 ? (
            <Empty title="暂无匹配个股" />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>标的</th>
                    <th>现价</th>
                    <th>涨跌幅</th>
                    <th className={styles.hideOnMobile}>行业</th>
                    <th>成交额/市值</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStocks.map((st) => {
                    const added = watchSet.has(st.symbol);
                    return (
                      <tr
                        key={st.symbol}
                        className={styles.rowClickable}
                        onClick={(e) => {
                          triggerClickRipple(e);
                          navigate(`/s/${st.symbol}`);
                        }}
                      >
                        <td>
                          <div className={styles.nameMain}>{st.name}</div>
                          <div className={styles.nameSub}>{st.symbol}</div>
                        </td>
                        <td>{formatCurrencyPrice(st.price, st.currency)}</td>
                        <td
                          className={`${styles.pctHeatCell} ${getChangeColorClass(st.change_pct)}`}
                          style={{
                            '--pct-fill': `${Math.min(100, (Math.abs(st.change_pct ?? 0) / 10) * 100).toFixed(1)}%`,
                            '--pct-color': (st.change_pct ?? 0) >= 0 ? 'var(--color-rise)' : 'var(--color-fall)',
                          } as React.CSSProperties}
                        >
                          <span className={styles.pctHeatText}>{formatPercent(st.change_pct)}</span>
                        </td>
                        <td className={styles.hideOnMobile}>{st.industry || st.sector}</td>
                        <td>
                          <div>{formatMarketValueByCurrency(st.amount, st.currency)}</div>
                          <div className={styles.nameSub}>
                            {formatMarketValueByCurrency(st.market_cap, st.currency)}
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className={`${styles.watchBtn} ${added ? styles.watchBtnAdded : ''}`}
                            onClick={() => toggleWatch(st.symbol, st.name)}
                          >
                            {added ? '已自选' : '+自选'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>细分行业</th>
                  <th>涨跌幅</th>
                  <th>领涨股</th>
                  <th>成分数</th>
                </tr>
              </thead>
              <tbody>
                {overview.sub_industries.map((sub) => (
                  <tr key={sub.board_code}>
                    <td className={styles.nameMain}>{sub.name}</td>
                    <td className={getChangeColorClass(sub.change_pct)}>
                      {formatPercent(sub.change_pct)}
                    </td>
                    <td>{sub.leading_stock_name}</td>
                    <td>{sub.constituent_count} 家</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
