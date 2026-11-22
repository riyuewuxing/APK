import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ExternalLink, Scale, ShieldAlert, Sparkles } from 'lucide-react';
import type { TodayTimelineResponse } from 'stock-sdk';
import { LazyEChart } from '@/components/charts/LazyEChart';
import { getChartColors } from '@/components/charts/chartTheme';
import { AnimatedNumber, Loading, triggerClickRipple } from '@/components/common';
import { useAppSettings } from '@/contexts';
import { useTheme } from '@/hooks';
import {
  getFullQuotes,
  getFundFlow,
  getKlineWithIndicators,
  getMinuteKline,
  getTodayTimeline,
} from '@/services/sdk';
import {
  fetchGlobalChart,
  fetchGlobalQuotes,
  type GlobalStockRow,
} from '@/services/globalMarketsApi';
import {
  detectAssetMarket,
  formatCurrencyPrice,
  formatMarketValueByCurrency,
  formatPercent,
  formatPrice,
  formatChange,
  formatTurnover,
  formatVolumeRatio,
  getChangeColorClass,
  normalizeStockCode,
  yearsAgoYmd,
} from '@/utils/format';
import {
  OUTER_MARKET_BADGE,
  globalRowToTerminalQuote,
  type TerminalQuote,
} from './watchlistGlobalAdapter';
import {
  buildCompactKlineOption,
  buildCompactTimelineOption,
  extractBareCode,
  formatSignedAmountWan,
  normalizeCompactKlineBars,
  type CompactKlineBar,
  type KlineWithMaLike,
} from './watchlistTerminalHelpers';
import styles from './WatchlistPreviewPane.module.css';

type PreviewKlinePeriod = 'daily' | 'weekly' | '60';

interface WatchlistPreviewPaneProps {
  code: string | null;
  fallbackName?: string;
  quote?: TerminalQuote;
  timelineIntervalMs: number;
  pollingEnabled: boolean;
}

function getPreviewStartDate(period: 'daily' | 'weekly'): string {
  return period === 'weekly' ? yearsAgoYmd(3) : yearsAgoYmd(1);
}

export function WatchlistPreviewPane({
  code,
  fallbackName,
  quote,
  timelineIntervalMs,
  pollingEnabled,
}: WatchlistPreviewPaneProps) {
  const navigate = useNavigate();
  const { theme, preset } = useTheme();
  const { settings } = useAppSettings();
  const colors = useMemo(
    () => getChartColors(theme, settings.colorMode, preset),
    [theme, settings.colorMode, preset]
  );

  const normalizedCode = useMemo(
    () => (code ? normalizeStockCode(code) : ''),
    [code]
  );
  const assetMarket = useMemo(
    () => (normalizedCode ? detectAssetMarket(normalizedCode) : 'cn'),
    [normalizedCode]
  );
  const isOuter = assetMarket !== 'cn';

  const [klinePeriod, setKlinePeriod] = useState<PreviewKlinePeriod>('daily');

  const [fallbackQuote, setFallbackQuote] = useState<{
    code: string;
    quote: TerminalQuote | null;
  }>({ code: '', quote: null });

  const [outerMeta, setOuterMeta] = useState<{
    code: string;
    row: GlobalStockRow | null;
  }>({ code: '', row: null });

  const [timelineState, setTimelineState] = useState<{
    code: string;
    data: TodayTimelineResponse | null;
    loading: boolean;
    error: boolean;
  }>({ code: '', data: null, loading: false, error: false });

  const [klineState, setKlineState] = useState<{
    key: string;
    bars: CompactKlineBar[];
    loading: boolean;
    error: boolean;
    notice: string | null;
  }>({ key: '', bars: [], loading: false, error: false, notice: null });

  const [fundFlowState, setFundFlowState] = useState<{
    code: string;
    mainNet: number | null;
    mainNetRatio: number | null;
  }>({ code: '', mainNet: null, mainNetRatio: null });

  const timelineSeqRef = useRef(0);
  const loadedTimelineCodeRef = useRef('');
  const klineSeqRef = useRef(0);
  const fundFlowSeqRef = useRef(0);
  const fallbackQuoteSeqRef = useRef(0);

  // 若选中标的来自底部 Dock 或缺失快照，按市场分流补充基础行情快照
  useEffect(() => {
    if (!normalizedCode || (quote && (!isOuter || quote.__currency))) {
      return;
    }
    const seq = ++fallbackQuoteSeqRef.current;
    const timer = window.setTimeout(() => {
      if (isOuter) {
        fetchGlobalQuotes([normalizedCode])
          .then((res) => {
            if (fallbackQuoteSeqRef.current !== seq) return;
            const row = res.items[0] ?? null;
            setOuterMeta({ code: normalizedCode, row });
            setFallbackQuote({
              code: normalizedCode,
              quote: row ? globalRowToTerminalQuote(row) : null,
            });
          })
          .catch(() => {
            if (fallbackQuoteSeqRef.current !== seq) return;
            setFallbackQuote({ code: normalizedCode, quote: null });
          });
      } else {
        getFullQuotes([normalizedCode], true)
          .then((rows) => {
            if (fallbackQuoteSeqRef.current !== seq) return;
            setFallbackQuote({ code: normalizedCode, quote: rows[0] ?? null });
          })
          .catch(() => {
            if (fallbackQuoteSeqRef.current !== seq) return;
            setFallbackQuote({ code: normalizedCode, quote: null });
          });
      }
    }, 80);
    return () => {
      fallbackQuoteSeqRef.current += 1;
      window.clearTimeout(timer);
    };
  }, [normalizedCode, quote, isOuter]);

  // 分时数据轮询（穿透 cache 保证实时刷新 + 序号防串号）
  useEffect(() => {
    if (!normalizedCode) {
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const loadTimeline = async (isInitial: boolean) => {
      const seq = ++timelineSeqRef.current;
      if (isInitial) {
        setTimelineState((prev) =>
          prev.code === normalizedCode
            ? { ...prev, loading: true, error: false }
            : { code: normalizedCode, data: null, loading: true, error: false }
        );
      }
      try {
        const res = isOuter
          ? await fetchGlobalChart(normalizedCode, 'timeline').then(
            (gc) =>
              ({
                code: normalizedCode,
                date: gc.date ?? '',
                preClose: gc.prevClose ?? undefined,
                data: (gc.data ?? []).map((p) => ({
                  time: p.time,
                  price: p.price,
                  avgPrice: p.avgPrice,
                  volume: p.volume,
                  amount: p.price * p.volume,
                })),
              }) as unknown as TodayTimelineResponse
          )
          : await getTodayTimeline(normalizedCode, false);
        if (cancelled || timelineSeqRef.current !== seq) return;
        loadedTimelineCodeRef.current = normalizedCode;
        setTimelineState({
          code: normalizedCode,
          data: res,
          loading: false,
          error: false,
        });
      } catch {
        if (cancelled || timelineSeqRef.current !== seq) return;
        setTimelineState((prev) => ({
          code: normalizedCode,
          data: prev.code === normalizedCode ? prev.data : null,
          loading: false,
          error: true,
        }));
      }
    };

    const scheduleNext = () => {
      if (cancelled || !pollingEnabled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      timerId = window.setTimeout(async () => {
        if (cancelled) return;
        await loadTimeline(false);
        scheduleNext();
      }, Math.max(3000, timelineIntervalMs));
    };

    if (loadedTimelineCodeRef.current === normalizedCode) {
      scheduleNext();
    } else {
      void loadTimeline(true).then(scheduleNext);
    }

    const handleVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        if (timerId !== null) {
          window.clearTimeout(timerId);
          timerId = null;
        }
      } else if (pollingEnabled) {
        if (timerId !== null) {
          window.clearTimeout(timerId);
          timerId = null;
        }
        void loadTimeline(false).then(scheduleNext);
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      cancelled = true;
      timelineSeqRef.current += 1;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [normalizedCode, timelineIntervalMs, pollingEnabled, isOuter]);

  // K 线预览加载（120ms 防抖 + 序号守卫 + 负价前复权截断保护）
  const klineKey = normalizedCode ? `${normalizedCode}:${klinePeriod}` : '';
  useEffect(() => {
    if (!normalizedCode || !klineKey) {
      return;
    }

    let cancelled = false;
    const seq = ++klineSeqRef.current;

    const timer = window.setTimeout(async () => {
      setKlineState((prev) =>
        prev.key === klineKey
          ? { ...prev, loading: true, error: false }
          : { key: klineKey, bars: [], loading: true, error: false, notice: null }
      );

      try {
        if (isOuter) {
          const gc = await fetchGlobalChart(normalizedCode, klinePeriod);
          if (cancelled || klineSeqRef.current !== seq) return;
          const bars: CompactKlineBar[] = (gc.bars ?? []).map((b) => ({
            label: b.time || b.date,
            open: b.open,
            close: b.close,
            high: b.high,
            low: b.low,
            volume: b.volume,
            ma5: b.ma?.ma5 ?? null,
            ma10: b.ma?.ma10 ?? null,
            ma20: b.ma?.ma20 ?? null,
          }));
          setKlineState({
            key: klineKey,
            bars: bars.slice(-90),
            loading: false,
            error: false,
            notice: gc.warnings?.[0] ?? null,
          });
          return;
        }

        if (klinePeriod === '60') {
          const rows = await getMinuteKline(normalizedCode, { period: '60', adjust: 'qfq' });
          if (cancelled || klineSeqRef.current !== seq) return;
          setKlineState({
            key: klineKey,
            bars: normalizeCompactKlineBars(Array.isArray(rows) ? rows : [], 90),
            loading: false,
            error: false,
            notice: null,
          });
          return;
        }

        const maOpts = { ma: { periods: [5, 10, 20] } };
        const raw = await getKlineWithIndicators(normalizedCode, {
          period: klinePeriod,
          adjust: 'qfq',
          startDate: getPreviewStartDate(klinePeriod),
          indicators: maOpts,
        });
        if (cancelled || klineSeqRef.current !== seq) return;

        const rawRows = Array.isArray(raw) ? (raw as KlineWithMaLike[]) : [];
        const lastNonPositiveIdx = rawRows.reduce((acc, row, idx) => {
          const minPrice = Math.min(
            Number(row.open),
            Number(row.close),
            Number(row.low)
          );
          return !Number.isFinite(minPrice) || minPrice <= 0 ? idx : acc;
        }, -1);

        if (lastNonPositiveIdx >= 0 && lastNonPositiveIdx + 1 < rawRows.length) {
          const firstValid = rawRows[lastNonPositiveIdx + 1];
          const safeStartDate = String(firstValid?.date ?? '').slice(0, 10);
          if (safeStartDate) {
            const positiveData = await getKlineWithIndicators(normalizedCode, {
              period: klinePeriod,
              adjust: 'qfq',
              startDate: safeStartDate,
              indicators: maOpts,
            });
            if (cancelled || klineSeqRef.current !== seq) return;
            const positiveRows = Array.isArray(positiveData)
              ? (positiveData as KlineWithMaLike[])
              : [];
            setKlineState({
              key: klineKey,
              bars: normalizeCompactKlineBars(positiveRows, 90),
              loading: false,
              error: false,
              notice: `已截断 ${safeStartDate} 前负价前复权区间`,
            });
            return;
          }
        }

        if (lastNonPositiveIdx >= 0 && lastNonPositiveIdx === rawRows.length - 1) {
          setKlineState({
            key: klineKey,
            bars: [],
            loading: false,
            error: false,
            notice: '前复权区间均非正值，请进完整详情查看后复权',
          });
          return;
        }

        setKlineState({
          key: klineKey,
          bars: normalizeCompactKlineBars(rawRows, 90),
          loading: false,
          error: false,
          notice: null,
        });
      } catch {
        if (cancelled || klineSeqRef.current !== seq) return;
        setKlineState({
          key: klineKey,
          bars: [],
          loading: false,
          error: true,
          notice: null,
        });
      }
    }, 120);

    return () => {
      cancelled = true;
      klineSeqRef.current += 1;
      window.clearTimeout(timer);
    };
  }, [normalizedCode, klineKey, klinePeriod, isOuter]);

  // 单股资金流（仅对 A 股标的拉取；外围标的严格不编造主力净流入）
  useEffect(() => {
    if (!normalizedCode || isOuter) {
      return;
    }

    let cancelled = false;
    const seq = ++fundFlowSeqRef.current;

    const timer = window.setTimeout(async () => {
      try {
        const rows = await getFundFlow([normalizedCode]);
        if (cancelled || fundFlowSeqRef.current !== seq) return;
        const first = rows[0];
        setFundFlowState({
          code: normalizedCode,
          mainNet: first && Number.isFinite(first.mainNet) ? first.mainNet : null,
          mainNetRatio:
            first && Number.isFinite(first.mainNetRatio) ? first.mainNetRatio : null,
        });
      } catch {
        if (cancelled || fundFlowSeqRef.current !== seq) return;
        setFundFlowState({ code: normalizedCode, mainNet: null, mainNetRatio: null });
      }
    }, 120);

    return () => {
      cancelled = true;
      fundFlowSeqRef.current += 1;
      window.clearTimeout(timer);
    };
  }, [normalizedCode, isOuter]);

  const activeQuote =
    quote ?? (fallbackQuote.code === normalizedCode ? fallbackQuote.quote ?? undefined : undefined);

  const activeTimeline =
    timelineState.code === normalizedCode ? timelineState.data : null;

  const activeKlineBars = useMemo(
    () => (klineState.key === klineKey ? klineState.bars : []),
    [klineState, klineKey]
  );

  const activeFundFlow =
    fundFlowState.code === normalizedCode
      ? fundFlowState
      : { code: normalizedCode, mainNet: null, mainNetRatio: null };

  const timelineOption = useMemo(
    () =>
      buildCompactTimelineOption({
        timeline: activeTimeline,
        prevClose: activeQuote?.prevClose,
        colors,
      }),
    [activeTimeline, activeQuote?.prevClose, colors]
  );

  const klineOption = useMemo(
    () =>
      buildCompactKlineOption({
        bars: activeKlineBars,
        colors,
      }),
    [activeKlineBars, colors]
  );

  const latestKlineBar = activeKlineBars.at(-1);

  if (!normalizedCode) {
    return (
      <section className={styles.pane} data-testid="watchlist-preview-pane">
        <div className={styles.emptyState}>
          <span>选择左侧自选或下方研究记录，即可联动预览当日分时与 K 线</span>
        </div>
      </section>
    );
  }

  const displayName = activeQuote?.name || fallbackName || extractBareCode(normalizedCode);
  const activeCurrency =
    activeQuote?.__currency ||
    (outerMeta.code === normalizedCode ? outerMeta.row?.currency : undefined) ||
    'CNY';
  const activeSector =
    activeQuote?.__sector ||
    (outerMeta.code === normalizedCode ? outerMeta.row?.industry || outerMeta.row?.sector : undefined);
  const displayPrice =
    activeQuote?.price && activeQuote.price > 0
      ? activeQuote.price
      : activeTimeline?.data?.at(-1)?.price;
  const displayChangePct = activeQuote?.changePercent;
  const displayChange = activeQuote?.change;
  const colorClass = getChangeColorClass(displayChangePct);
  const latestTimelineAvg = activeTimeline?.data?.at(-1)?.avgPrice;
  const displayAvgPrice =
    activeQuote?.avgPrice && activeQuote.avgPrice > 0
      ? activeQuote.avgPrice
      : latestTimelineAvg && latestTimelineAvg > 0
        ? latestTimelineAvg
        : null;

  const fmtVal = (v: number | null | undefined) =>
    isOuter ? formatCurrencyPrice(v, activeCurrency) : formatPrice(v);

  return (
    <section className={styles.pane} data-testid="watchlist-preview-pane">
      {/* 顶部摘要与专家研究直达条 */}
      <div className={styles.headerCard}>
        <div className={styles.titleRow}>
          <div className={styles.symbolBlock}>
            <span className={styles.symbolName} title={displayName}>
              {displayName}
            </span>
            <span className={styles.symbolCode}>
              {isOuter
                ? `${OUTER_MARKET_BADGE[assetMarket]} · ${normalizedCode}`
                : extractBareCode(normalizedCode)}
            </span>
          </div>
          <div className={styles.priceBlock}>
            <span className={`${styles.priceValue} ${colorClass}`}>
              {displayPrice != null && Number.isFinite(displayPrice) ? (
                <AnimatedNumber value={displayPrice} format={fmtVal} flashOnChange />
              ) : (
                fmtVal(displayPrice)
              )}
            </span>
            <span className={`${styles.changeBadge} ${colorClass}`}>
              {formatPercent(displayChangePct)}
            </span>
            <span className={`${styles.changeValue} ${colorClass}`}>
              {formatChange(displayChange)}
            </span>
          </div>
        </div>

        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.shortcutBtn}
            onClick={() => navigate(`/s/${normalizedCode}`)}
          >
            <ExternalLink size={12} />
            <span>完整详情</span>
          </button>
          {!isOuter && (
            <>
              <button
                type="button"
                className={styles.shortcutBtn}
                onClick={() => navigate(`/expert?symbol=${normalizedCode}&tab=debate`)}
              >
                <Scale size={12} />
                <span>多空对抗</span>
              </button>
              <button
                type="button"
                className={styles.shortcutBtn}
                onClick={() => navigate(`/s/${normalizedCode}#minesweeper`)}
              >
                <ShieldAlert size={12} />
                <span>财报排雷</span>
              </button>
              <button
                type="button"
                className={`${styles.shortcutBtn} ${styles.shortcutAccent}`}
                onClick={() => navigate(`/expert?symbol=${normalizedCode}`)}
              >
                <Sparkles size={12} />
                <span>专家深研</span>
              </button>
            </>
          )}
        </div>

        {isOuter ? (
          <div className={`${styles.metaGrid} ${styles.metaGridOuter}`}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>币种</span>
              <span className={styles.metaVal}>{activeCurrency}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>行业</span>
              <span className={styles.metaVal}>{activeSector || '--'}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>总市值</span>
              <span className={styles.metaVal}>
                {formatMarketValueByCurrency(activeQuote?.totalMarketCap, activeCurrency)}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>成交额</span>
              <span className={styles.metaVal}>
                {formatMarketValueByCurrency(activeQuote?.amount, activeCurrency)}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>市盈(动)</span>
              <span className={styles.metaVal}>
                {activeQuote?.peDynamic != null ? activeQuote.peDynamic.toFixed(2) : '--'}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>均价</span>
              <span className={styles.metaVal}>{fmtVal(displayAvgPrice)}</span>
            </div>
          </div>
        ) : (
          <div className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>今开</span>
              <span className={styles.metaVal}>{formatPrice(activeQuote?.open)}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>最高</span>
              <span className={styles.metaVal}>{formatPrice(activeQuote?.high)}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>最低</span>
              <span className={styles.metaVal}>{formatPrice(activeQuote?.low)}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>均价</span>
              <span className={styles.metaVal}>{formatPrice(displayAvgPrice)}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>量比</span>
              <span className={styles.metaVal}>{formatVolumeRatio(activeQuote?.volumeRatio)}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>换手</span>
              <span className={styles.metaVal}>{formatTurnover(activeQuote?.turnoverRate)}</span>
            </div>
            <div className={styles.metaItemWide}>
              <span className={styles.metaLabel}>主力净流</span>
              <span
                className={`${styles.metaVal} ${getChangeColorClass(activeFundFlow.mainNet)}`}
              >
                {formatSignedAmountWan(activeFundFlow.mainNet)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 上半区：当日分时图 */}
      <div className={styles.chartCard} data-testid="watchlist-preview-timeline">
        <div className={styles.chartHeader}>
          <span className={styles.chartTitle}>当日分时</span>
          <span className={styles.chartMeta}>
            {activeTimeline?.date ? `${activeTimeline.date} · ` : ''}
            昨收 {fmtVal(activeTimeline?.preClose ?? activeQuote?.prevClose)}
          </span>
        </div>
        <div className={styles.chartWrap}>
          {timelineState.loading && !activeTimeline ? (
            <Loading size="sm" text="加载分时..." />
          ) : activeTimeline?.data?.length ? (
            <LazyEChart
              key={`tl-${normalizedCode}`}
              option={timelineOption}
              notMerge
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <div className={styles.chartEmpty}>
              <span>{timelineState.error ? '分时加载失败（将自动重试）' : '暂无当日分时数据'}</span>
            </div>
          )}
        </div>
      </div>

      {/* 下半区：K 线预览图 */}
      <div className={styles.chartCard} data-testid="watchlist-preview-kline">
        <div className={styles.chartHeader}>
          <div className={styles.maReadout}>
            <span className={styles.chartTitle}>K线预览</span>
            <span className={styles.maItem} style={{ color: 'var(--chart-ma5)' }}>
              MA5 {latestKlineBar?.ma5?.toFixed(2) ?? '--'}
            </span>
            <span className={styles.maItem} style={{ color: 'var(--chart-ma10)' }}>
              MA10 {latestKlineBar?.ma10?.toFixed(2) ?? '--'}
            </span>
            <span className={styles.maItem} style={{ color: 'var(--chart-ma20)' }}>
              MA20 {latestKlineBar?.ma20?.toFixed(2) ?? '--'}
            </span>
          </div>
          <div className={styles.periodPills} role="tablist" aria-label="K线周期切换">
            {(
              [
                { key: 'daily', label: '日K' },
                { key: 'weekly', label: '周K' },
                { key: '60', label: '60分' },
              ] as const
            ).map((tab) => {
              const isActive = klinePeriod === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`${styles.periodPill} ${isActive ? styles.periodPillActive : ''}`}
                  onClick={(e) => {
                    triggerClickRipple(e);
                    setKlinePeriod(tab.key);
                  }}
                >
                  {isActive && (
                    <motion.span
                      layoutId="preview-period-pill"
                      className={styles.periodPillBg}
                      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    />
                  )}
                  <span className={styles.periodPillLabel}>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        {klineState.key === klineKey && klineState.notice && (
          <div className={styles.klineNotice}>{klineState.notice}</div>
        )}
        <div className={styles.chartWrap}>
          {klineState.loading && activeKlineBars.length === 0 ? (
            <Loading size="sm" text="加载 K 线..." />
          ) : activeKlineBars.length > 0 ? (
            <LazyEChart
              key={`kl-${normalizedCode}-${klinePeriod}`}
              option={klineOption}
              notMerge
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <div className={styles.chartEmpty}>
              <span>{klineState.error ? 'K线加载失败，请稍后重试' : '暂无可用K线序列'}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
