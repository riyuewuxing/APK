import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Grid3X3, Layers, RefreshCw } from 'lucide-react';
import { Empty, Loading, MarketSelectorBar } from '@/components/common';
import {
  GLOBAL_MARKET_LIST,
  fetchGlobalMarketOverview,
  getActiveGlobalMarket,
  saveActiveGlobalMarket,
  type GlobalMarketId,
  type GlobalMarketOverviewResponse,
  type GlobalSortBy,
  type OuterMarketId,
} from '@/services/globalMarketsApi';
import { Boards } from '@/pages/Boards';
import { Heatmap } from '@/pages/Heatmap';
import { Rankings } from '@/pages/Rankings';
import { MarketsBoardsView } from './MarketsBoardsView';
import { MarketsHeatmapView } from './MarketsHeatmapView';
import { MarketsRankingsView } from './MarketsRankingsView';
import styles from './MarketsHub.module.css';

export type MarketsViewType = 'heatmap' | 'rankings' | 'boards';

interface MarketsHubProps {
  defaultView?: MarketsViewType;
}

const VIEW_TABS: { key: MarketsViewType; label: string; icon: React.ReactNode }[] = [
  { key: 'heatmap', label: '热力图', icon: <Grid3X3 size={15} /> },
  { key: 'rankings', label: '双栏榜单', icon: <BarChart3 size={15} /> },
  { key: 'boards', label: '板块矩阵', icon: <Layers size={15} /> },
];

export function MarketsHub({ defaultView = 'heatmap' }: MarketsHubProps) {
  const [market, setMarket] = useState<GlobalMarketId>(getActiveGlobalMarket);
  const [view, setView] = useState<MarketsViewType>(defaultView);
  const [sortBy, setSortBy] = useState<GlobalSortBy>('market_cap');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSectorKey, setSelectedSectorKey] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [outerState, setOuterState] = useState<{
    key: string;
    data: GlobalMarketOverviewResponse | null;
    error: string | null;
  }>({ key: '', data: null, error: null });

  const handleMarketChange = useCallback((next: string) => {
    const valid = GLOBAL_MARKET_LIST.some((m) => m.id === next)
      ? (next as GlobalMarketId)
      : 'cn';
    setMarket(valid);
    saveActiveGlobalMarket(valid);
    setSelectedSectorKey(null);
  }, []);

  const reqKey = market === 'cn' ? '' : `${market}::${refreshTick}`;

  useEffect(() => {
    if (market === 'cn') return;
    const controller = new AbortController();
    const targetKey = `${market}::${refreshTick}`;
    fetchGlobalMarketOverview(market as OuterMarketId, 'market_cap', 200, controller.signal)
      .then((res) => setOuterState({ key: targetKey, data: res, error: null }))
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setOuterState({
          key: targetKey,
          data: null,
          error: err instanceof Error ? err.message : '外围行情拉取失败',
        });
      });
    return () => controller.abort();
  }, [market, refreshTick]);

  const outerData = reqKey && outerState.key === reqKey ? outerState.data : null;
  const outerError = reqKey && outerState.key === reqKey ? outerState.error : null;
  const outerLoading = Boolean(reqKey) && outerState.key !== reqKey && !outerError;

  const marketMeta = GLOBAL_MARKET_LIST.find((m) => m.id === market) ?? GLOBAL_MARKET_LIST[0];

  const handleSectorDrillDown = (sectorKey: string) => {
    setSelectedSectorKey(sectorKey);
    setView('boards');
  };

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.topDockLeft}>
          <MarketSelectorBar
            value={market}
            onChange={handleMarketChange}
            testIdPrefix="markets-selector"
          />
          <div className={styles.viewTabs} data-testid="markets-view-tabs">
            {VIEW_TABS.map((tab) => {
              const active = view === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  data-testid={`markets-view-${tab.key}`}
                  className={`${styles.viewTabBtn} ${active ? styles.viewTabBtnActive : ''}`}
                  onClick={() => setView(tab.key)}
                >
                  {active && (
                    <motion.span
                      layoutId="markets-view-pill"
                      className={styles.viewTabBg}
                      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    />
                  )}
                  <span className={styles.viewTabInner}>
                    {tab.icon}
                    <span>{tab.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.topDockRight}>
          <div className={styles.statusMeta}>
            <span className={styles.statusBadge}>
              {marketMeta.label} · {outerData?.session.label ?? (market === 'cn' ? 'A股全市场' : '同步中')} ·{' '}
              {outerData?.currency ?? marketMeta.currency}
            </span>
            {outerData?.as_of_bj && (
              <span className={styles.statusBadge}>更新 {outerData.as_of_bj}</span>
            )}
          </div>
          {market !== 'cn' && (
            <div className={styles.toolsRow}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder={`搜索${marketMeta.label}代码/中文名/行业...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                type="button"
                className={styles.refreshBtn}
                onClick={() => setRefreshTick((v) => v + 1)}
                title="刷新外围行情"
              >
                <RefreshCw size={14} />
                <span>刷新</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {market === 'cn' ? (
        <>
          {view === 'heatmap' && <Heatmap />}
          {view === 'rankings' && <Rankings />}
          {view === 'boards' && <Boards />}
        </>
      ) : outerLoading ? (
        <Loading text={`正在加载${marketMeta.label}行业与行情数据...`} />
      ) : outerError || !outerData || outerData.status === 'UNAVAILABLE' ? (
        <Empty
          title={`${marketMeta.label}实时数据暂不可用`}
          description={outerError ?? outerData?.warnings?.[0] ?? '网络受限或离线模式已启用'}
        />
      ) : (
        <>
          {outerData.warnings.length > 0 && (
            <div className={styles.warnBanner}>{outerData.warnings.join(' · ')}</div>
          )}
          {view === 'heatmap' && (
            <MarketsHeatmapView
              overview={outerData}
              onSelectSector={handleSectorDrillDown}
            />
          )}
          {view === 'rankings' && (
            <MarketsRankingsView
              overview={outerData}
              searchQuery={searchQuery}
              sortBy={sortBy}
              onSortChange={setSortBy}
              onSelectSector={handleSectorDrillDown}
            />
          )}
          {view === 'boards' && (
            <MarketsBoardsView
              overview={outerData}
              searchQuery={searchQuery}
              selectedSectorKey={selectedSectorKey}
              onSelectSector={setSelectedSectorKey}
            />
          )}
        </>
      )}
    </div>
  );
}
