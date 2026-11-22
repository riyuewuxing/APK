import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import {
  fetchGlobalPulse,
  formatPulseChangePct,
  formatPulsePrice,
  type GlobalPulseItem,
  type GlobalPulsePayload,
  type GlobalPulseRegion,
} from '@/services/globalPulseApi';
import { usePolling } from '@/hooks';
import { getGlobalPulseExpanded, saveGlobalPulseExpanded } from '@/services/storage';
import { getChangeColorClass } from '@/utils/format';
import type { GlobalMarketId } from '@/services/globalMarketsApi';
import styles from './GlobalPulseStrip.module.css';

const PULSE_TO_MARKET: Record<string, GlobalMarketId> = {
  NDX: 'us',
  SPX: 'us',
  DJIA: 'us',
  HSI: 'hk',
  HSTECH: 'hk',
  N225: 'jp',
  KS11: 'kr',
  GDAXI: 'eu',
  SX5E: 'eu',
  FTSE: 'eu',
};

const REGION_META: Array<{ key: GlobalPulseRegion; label: string; count: number }> = [
  { key: 'US', label: '美洲市场', count: 3 },
  { key: 'APAC', label: '亚太日盘', count: 5 },
  { key: 'EU', label: '欧洲缩影', count: 3 },
  { key: 'MACRO', label: '汇率·大宗·利率', count: 5 },
];

function getCollapsedName(item: GlobalPulseItem): string {
  return item.code === 'HSI' ? item.name : item.short_name;
}

function getShortStatusTag(item: GlobalPulseItem): string {
  if (item.status === 'UNAVAILABLE' || item.price === null) return '暂不可用';
  if (item.status === 'STALE') return '缓存';
  if (item.session_state === 'TRADING') return '盘中';
  if (item.session_state === '24H') return '连续';
  if (item.session_state === 'DAILY') return '日频';
  if (item.session_label.includes('午')) return '午休';
  if (item.session_label.includes('周末')) return '周末休市';
  return '昨收';
}

function getDotClass(item: GlobalPulseItem): string {
  if (item.status === 'UNAVAILABLE' || item.price === null) return styles.dotMuted;
  if (item.status === 'STALE') return styles.dotWarn;
  if (item.session_state === 'TRADING' || item.session_state === '24H') return styles.dotLive;
  return styles.dotClosed;
}

interface GlobalPulseStripProps {
  onSelectMarket?: (market: GlobalMarketId) => void;
}

export function GlobalPulseStrip({ onSelectMarket }: GlobalPulseStripProps = {}) {
  const [expanded, setExpanded] = useState<boolean>(getGlobalPulseExpanded);
  const [payload, setPayload] = useState<GlobalPulsePayload | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updateRestricted, setUpdateRestricted] = useState(false);

  const loadPulse = useCallback(async (force = false) => {
    try {
      const data = await fetchGlobalPulse(force);
      setPayload(data);
      const allUnavailable =
        Array.isArray(data.items)
        && data.items.length > 0
        && data.items.every((it) => it.status === 'UNAVAILABLE');
      setUpdateRestricted(Boolean(data.stale || allUnavailable));
    } catch {
      setUpdateRestricted(true);
    }
  }, []);

  const pollPulse = useCallback(async () => {
    await loadPulse(false);
  }, [loadPulse]);

  usePolling(pollPulse, {
    interval: 60000,
    pauseOnHidden: true,
    immediate: true,
  });

  const handleToggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      saveGlobalPulseExpanded(next);
      return next;
    });
  };

  const handleManualRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await loadPulse(true);
    } finally {
      setIsRefreshing(false);
    }
  };

  const coreItems = useMemo(() => {
    if (!payload?.items?.length) return [];
    const cores = payload.items.filter((it) => it.core8);
    return cores.length > 0 ? cores : payload.items.slice(0, 8);
  }, [payload]);

  const itemsByRegion = useMemo(() => {
    const grouped: Record<GlobalPulseRegion, GlobalPulseItem[]> = {
      US: [],
      APAC: [],
      EU: [],
      MACRO: [],
    };
    for (const item of payload?.items ?? []) {
      grouped[item.region]?.push(item);
    }
    return grouped;
  }, [payload]);

  const asOfHHMM = payload?.as_of_bj ? payload.as_of_bj.slice(11, 16) : '--:--';

  return (
    <section
      className={styles.wrapper}
      data-testid="global-pulse-strip"
      aria-label="全球宏观定价锚与外围市场脉搏"
    >
      <div className={styles.compactRow}>
        <div className={styles.leftTitleGroup}>
          <span className={styles.stripTitle}>全球脉搏</span>
          {updateRestricted && payload && (
            <span className={styles.restrictedTag} title="部分外盘更新受限，已保留最近有效快照">
              更新受限
            </span>
          )}
        </div>

        <div className={styles.coreScrollTrack}>
          {coreItems.length === 0 ? (
            <span className={styles.placeholderText}>
              {updateRestricted ? '外围定价锚暂不可用' : '正在同步全球定价锚...'}
            </span>
          ) : (
            coreItems.map((item) => {
              const pctText = formatPulseChangePct(item);
              const colorClass =
                item.status !== 'UNAVAILABLE' && item.change_pct !== null
                  ? getChangeColorClass(item.change_pct)
                  : styles.mutedText;
              const targetMarket = PULSE_TO_MARKET[item.code];
              return (
                <div
                  key={item.code}
                  className={styles.coreChip}
                  style={targetMarket && onSelectMarket ? { cursor: 'pointer' } : undefined}
                  onClick={() => targetMarket && onSelectMarket?.(targetMarket)}
                  title={`${item.name} · 现价 ${formatPulsePrice(item)} · ${item.session_label}${targetMarket && onSelectMarket ? '（点击切换总览市场）' : ''}`}
                >
                  <span className={`${styles.statusDot} ${getDotClass(item)}`} aria-hidden="true" />
                  <span className={styles.chipName}>{getCollapsedName(item)}</span>
                  <span className={`${styles.chipPct} ${colorClass}`}>{pctText}</span>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.toggleBtn}
            onClick={handleToggleExpanded}
            data-testid="global-pulse-toggle"
            aria-expanded={expanded}
          >
            <span>{expanded ? '收起' : '展开全部(16)'}</span>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => void handleManualRefresh()}
            title="手动刷新全球脉搏（服务端 15 秒防抖）"
            aria-label="刷新全球脉搏"
          >
            <RefreshCw size={12} className={isRefreshing ? styles.spin : ''} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className={styles.expandedPanel} data-testid="global-pulse-matrix">
          <div className={styles.matrixHeader}>
            <span className={styles.matrixNotice}>
              全球宏观定价参考（非交易指令）· 更新于 {asOfHHMM}
            </span>
            {payload?.warnings?.length ? (
              <span className={styles.matrixWarn}>{payload.warnings[0]}</span>
            ) : null}
          </div>

          <div className={styles.quadrantGrid}>
            {REGION_META.map((group) => {
              const list = itemsByRegion[group.key] ?? [];
              return (
                <div key={group.key} className={styles.regionCard}>
                  <div className={styles.regionCardHeader}>
                    <span className={styles.regionLabel}>{group.label}</span>
                    <span className={styles.regionCount}>
                      {list.length || group.count} 项
                    </span>
                  </div>
                  <div className={styles.regionItems}>
                    {list.map((item) => {
                      const pctText = formatPulseChangePct(item);
                      const priceText = formatPulsePrice(item);
                      const colorClass =
                        item.status !== 'UNAVAILABLE' && item.change_pct !== null
                          ? getChangeColorClass(item.change_pct)
                          : styles.mutedText;
                      const spreadBps = item.meta?.spread_bps;
                      const cn10y = item.meta?.cn10y_yield;
                      const targetMarket = PULSE_TO_MARKET[item.code];
                      return (
                        <div
                          key={item.code}
                          className={styles.itemBlock}
                          style={targetMarket && onSelectMarket ? { cursor: 'pointer' } : undefined}
                          onClick={() => targetMarket && onSelectMarket?.(targetMarket)}
                        >
                          <div className={styles.itemRow}>
                            <div className={styles.itemIdentity}>
                              <span className={`${styles.statusDot} ${getDotClass(item)}`} />
                              <span className={styles.itemName}>{item.name}</span>
                              <span
                                className={`${styles.sessionTag} ${
                                  item.session_state === 'TRADING' || item.session_state === '24H'
                                    ? styles.sessionTagLive
                                    : styles.sessionTagMuted
                                }`}
                              >
                                {getShortStatusTag(item)}
                              </span>
                            </div>
                            <div className={styles.itemMetrics}>
                              <span className={styles.itemPrice}>{priceText}</span>
                              <span className={`${styles.itemPct} ${colorClass}`}>{pctText}</span>
                            </div>
                          </div>
                          {item.code === 'US10Y' &&
                            typeof spreadBps === 'number' &&
                            Number.isFinite(spreadBps) && (
                              <div className={styles.rateSpreadRow}>
                                中美10Y利差 {spreadBps > 0 ? '+' : ''}
                                {spreadBps.toFixed(0)}bps
                                {typeof cn10y === 'number' && Number.isFinite(cn10y)
                                  ? ` (中 ${cn10y.toFixed(2)}% / 美 ${priceText})`
                                  : ''}
                              </div>
                            )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
