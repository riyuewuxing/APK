import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Empty, Loading, triggerClickRipple, useToast } from '@/components/common';
import {
  fetchGlobalBoardConstituents,
  type GlobalBoardConstituentsResponse,
  type GlobalMarketOverviewResponse,
} from '@/services/globalMarketsApi';
import { selectAllCodes, watchlistActions, watchlistStore } from '@/services/watchlistStore';
import {
  formatCurrencyPrice,
  formatMarketValueByCurrency,
  formatPercent,
  getChangeColorClass,
} from '@/utils/format';
import styles from './MarketsHub.module.css';

interface MarketsBoardsViewProps {
  overview: GlobalMarketOverviewResponse;
  searchQuery: string;
  selectedSectorKey: string | null;
  onSelectSector: (sectorKey: string | null) => void;
}

export function MarketsBoardsView({
  overview,
  searchQuery,
  selectedSectorKey,
  onSelectSector,
}: MarketsBoardsViewProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const snapshot = useSyncExternalStore(watchlistStore.subscribe, watchlistStore.getSnapshot);
  const watchSet = useMemo(() => new Set(selectAllCodes(snapshot)), [snapshot]);

  const [boardDetail, setBoardDetail] = useState<{
    key: string;
    data: GlobalBoardConstituentsResponse | null;
    loading: boolean;
    error: string | null;
  }>({ key: '', data: null, loading: false, error: null });

  const activeSectorKey = selectedSectorKey ?? overview.sectors[0]?.board_code ?? null;

  useEffect(() => {
    if (!activeSectorKey) return;
    const reqKey = `${overview.market}::${activeSectorKey}`;
    const controller = new AbortController();
    fetchGlobalBoardConstituents(overview.market, activeSectorKey, 'market_cap', 100, controller.signal)
      .then((res) => setBoardDetail({ key: reqKey, data: res, loading: false, error: null }))
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setBoardDetail({
          key: reqKey,
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : '成分股加载失败',
        });
      });
    return () => controller.abort();
  }, [overview.market, activeSectorKey]);

  const filteredSectors = useMemo(() => {
    const kw = searchQuery.trim().toLowerCase();
    if (!kw) return overview.sectors;
    return overview.sectors.filter(
      (s) => s.name.toLowerCase().includes(kw) || s.leading_stock_name.toLowerCase().includes(kw)
    );
  }, [overview.sectors, searchQuery]);

  const reqKey = activeSectorKey ? `${overview.market}::${activeSectorKey}` : '';
  const detailData = boardDetail.key === reqKey ? boardDetail.data : null;
  const detailError = boardDetail.key === reqKey ? boardDetail.error : null;
  const detailLoading = Boolean(reqKey) && boardDetail.key !== reqKey && !detailError;

  const toggleWatch = (symbol: string, name: string) => {
    if (watchSet.has(symbol)) {
      watchlistActions.remove(symbol);
      toast.info(`已移出自选：${name}`);
    } else {
      watchlistActions.add(symbol);
      toast.success(`已加入自选：${name}`);
    }
  };

  if (filteredSectors.length === 0) {
    return <Empty title="未找到匹配的行业板块" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className={styles.boardGrid}>
        {filteredSectors.map((sec) => {
          const active = sec.board_code === activeSectorKey;
          return (
            <div
              key={sec.board_code}
              className={`${styles.boardCard} ${active ? styles.boardCardActive : ''}`}
              onClick={(e) => {
                triggerClickRipple(e);
                onSelectSector(sec.board_code);
              }}
            >
              <div className={styles.boardTop}>
                <span className={styles.boardName}>{sec.name}</span>
                <span className={getChangeColorClass(sec.change_pct)}>
                  {formatPercent(sec.change_pct)}
                </span>
              </div>
              <div className={styles.boardMeta}>
                <span>领涨：{sec.leading_stock_name}</span>
                <span className={getChangeColorClass(sec.leading_stock_pct)}>
                  {formatPercent(sec.leading_stock_pct)}
                </span>
              </div>
              <div className={styles.boardMeta}>
                <span>
                  <span className="text-rise">{sec.rise_count}涨</span> /{' '}
                  <span className="text-fall">{sec.fall_count}跌</span> ({sec.constituent_count}家)
                </span>
                <span>{formatMarketValueByCurrency(sec.total_market_cap, overview.currency)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {activeSectorKey && (
        <Card
          title={`板块成分股下钻：${detailData?.sector_name ?? activeSectorKey}`}
          padding="sm"
          extra={
            detailData ? (
              <span className={styles.nameSub}>共 {detailData.total_count} 只代表成分股</span>
            ) : undefined
          }
        >
          {detailLoading ? (
            <Loading text="正在加载行业成分股..." />
          ) : detailError ? (
            <Empty title="成分股加载失败" description={detailError} />
          ) : !detailData || detailData.items.length === 0 ? (
            <Empty title="该板块暂无成分股" />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>代码 / 名称</th>
                    <th>现价</th>
                    <th>涨跌幅</th>
                    <th className={styles.hideOnMobile}>细分行业</th>
                    <th>总市值</th>
                    <th className={styles.hideOnMobile}>PE(TTM)</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {detailData.items.map((st) => {
                    const added = watchSet.has(st.symbol);
                    return (
                      <tr
                        key={st.symbol}
                        className={styles.rowClickable}
                        onClick={() => navigate(`/s/${st.symbol}`)}
                      >
                        <td>
                          <div className={styles.nameMain}>{st.name}</div>
                          <div className={styles.nameSub}>
                            {st.symbol} · {st.en_name}
                          </div>
                        </td>
                        <td>{formatCurrencyPrice(st.price, st.currency)}</td>
                        <td className={getChangeColorClass(st.change_pct)}>
                          {formatPercent(st.change_pct)}
                        </td>
                        <td className={styles.hideOnMobile}>{st.industry}</td>
                        <td>{formatMarketValueByCurrency(st.market_cap, st.currency)}</td>
                        <td className={styles.hideOnMobile}>{st.pe_ttm != null ? st.pe_ttm.toFixed(1) : '--'}</td>
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
          )}
        </Card>
      )}
    </div>
  );
}
