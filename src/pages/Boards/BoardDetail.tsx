/**
 * 板块详情页
 */

import { useState, useEffect, useEffectEvent, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Plus, Check } from 'lucide-react';
import { Card, Tabs, Loading, Button, Empty, useToast } from '@/components/common';
import {
  getIndustryConstituents,
  getConceptConstituents,
  getBoardKlineWithMeta,
  getBoardSummary,
  getBoardFundFlow,
  normalizeBoardCode,
  type BoardFundFlowResult,
  type BoardSummaryMeta,
} from '@/services/sdk';
import { watchlistActions } from '@/services/watchlistStore';
import { useBoardData, useAppSettings } from '@/contexts';
import { useIsInWatchlist, useTheme } from '@/hooks';
import {
  buildAxisPointerLabel,
  buildCrosshairAxisPointer,
  getChartColors,
} from '@/components/charts/chartTheme';
import {
  formatPrice,
  formatPercent,
  formatAmount,
  formatMarketCap,
  formatTurnover,
  formatYuanAmount,
  getChangeColorClass,
} from '@/utils/format';
import type {
  IndustryBoardConstituent,
  ConceptBoardConstituent,
  IndustryBoardKline,
  ConceptBoardKline,
  IndustryBoardSpot,
  ConceptBoardSpot,
} from 'stock-sdk';
import { LazyEChart } from '@/components/charts/LazyEChart';
import styles from './BoardDetail.module.css';

// K线周期
const KLINE_PERIODS = [
  { key: 'daily', label: '日K' },
  { key: 'weekly', label: '周K' },
  { key: 'monthly', label: '月K' },
];

export function BoardDetail() {
  const { type, code } = useParams<{ type: 'industry' | 'concept'; code: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { industryList, conceptList, loading: boardLoading } = useBoardData();
  const { theme, preset } = useTheme();
  const { settings } = useAppSettings();
  const chartColors = useMemo(
    () => getChartColors(theme, settings.colorMode, preset),
    [theme, settings.colorMode, preset]
  );

  // 数据状态
  const [constituents, setConstituents] = useState<(IndustryBoardConstituent | ConceptBoardConstituent)[]>([]);
  const [klineData, setKlineData] = useState<(IndustryBoardKline | ConceptBoardKline)[]>([]);
  const [klineSourceLabel, setKlineSourceLabel] = useState<string | null>(null);
  const [spotData, setSpotData] = useState<(IndustryBoardSpot | ConceptBoardSpot)[]>([]);
  const [summaryMeta, setSummaryMeta] = useState<BoardSummaryMeta | null>(null);
  const [fundFlowState, setFundFlowState] = useState<BoardFundFlowResult | null>(null);

  // UI 状态
  const [loading, setLoading] = useState(true);
  const [klinePeriod, setKlinePeriod] = useState('daily');
  const [showAllConstituents, setShowAllConstituents] = useState(false);

  const boardType: 'industry' | 'concept' = type === 'industry' ? 'industry' : 'concept';
  const isIndustry = boardType === 'industry';
  const normalizedCode = useMemo(() => (code ? normalizeBoardCode(code) : ''), [code]);

  const boardInfo = useMemo(() => {
    if (!normalizedCode) return null;
    const list = isIndustry ? industryList : conceptList;
    return list.find((item) => normalizeBoardCode(item.code) === normalizedCode) ?? null;
  }, [conceptList, industryList, isIndustry, normalizedCode]);

  const displayBoard = useMemo<BoardSummaryMeta | null>(() => {
    if (!boardInfo && !summaryMeta) return null;
    return {
      ...(boardInfo ?? {}),
      ...(summaryMeta ?? {}),
      name: summaryMeta?.name ?? boardInfo?.name,
      code: summaryMeta?.code ?? boardInfo?.code,
    };
  }, [boardInfo, summaryMeta]);

  const fundFlowHistory = useMemo(
    () => (fundFlowState?.dailyHistory ?? []).slice(-30),
    [fundFlowState]
  );
  const periodFlows = useMemo(() => fundFlowState?.periods ?? [], [fundFlowState]);

  // 加载成分股
  const fetchConstituents = useCallback(async () => {
    if (!normalizedCode) return;
    try {
      const data = isIndustry
        ? await getIndustryConstituents(normalizedCode)
        : await getConceptConstituents(normalizedCode);
      setConstituents(data);
    } catch (error) {
      console.error('Fetch constituents error:', error);
    }
  }, [isIndustry, normalizedCode]);

  // 加载 K 线（含官方指数 / 成分股合成标识）
  const fetchKline = useCallback(async () => {
    if (!normalizedCode) return;
    try {
      const res = await getBoardKlineWithMeta(boardType, normalizedCode, {
        period: klinePeriod as 'daily' | 'weekly' | 'monthly',
      });
      setKlineData(res.items.slice(-60));
      setKlineSourceLabel(res.klineSourceLabel);
    } catch (error) {
      console.error('Fetch kline error:', error);
    }
  }, [boardType, klinePeriod, normalizedCode]);

  // 加载板块聚合摘要与 Spot 指标
  const fetchSummaryAndSpot = useCallback(async () => {
    if (!normalizedCode) return;
    try {
      const res = await getBoardSummary(boardType, normalizedCode);
      setSummaryMeta(res.meta);
      setSpotData(res.spot);
    } catch (error) {
      console.error('Fetch summary/spot error:', error);
    }
  }, [boardType, normalizedCode]);

  const fetchFundFlowHistory = useCallback(async () => {
    if (!normalizedCode) return;
    try {
      const res = await getBoardFundFlow(boardType, normalizedCode);
      setFundFlowState(res);
    } catch (error) {
      console.error('Fetch board fund flow error:', error);
    }
  }, [boardType, normalizedCode]);

  // 初始加载（只在板块代码变化时触发）
  const loadAll = useEffectEvent(async () => {
    setLoading(true);
    setShowAllConstituents(false);
    await Promise.all([
      fetchConstituents(),
      fetchSummaryAndSpot(),
      fetchFundFlowHistory(),
      fetchKline(),
    ]);
    setLoading(false);
  });

  useEffect(() => {
    loadAll();
  }, [normalizedCode, isIndustry]);

  // 周期变化时重新加载 K 线（不触发全页 loading）
  const reloadKline = useEffectEvent(() => {
    if (!loading && code) {
      fetchKline();
    }
  });

  useEffect(() => {
    reloadKline();
  }, [klinePeriod]);

  // K线图配置
  const klineChartOption = useMemo(() => {
    if (!klineData.length) return {};

    const {
      rise: riseColor,
      fall: fallColor,
      borderPrimary,
      borderSecondary,
      textTertiary,
      tooltipBg,
      textPrimary,
    } = chartColors;

    const dates = klineData.map((d) => d.date);
    const ohlc = klineData.map((d) => [d.open, d.close, d.low, d.high]);

    return {
      animation: false,
      grid: { left: 60, right: 20, top: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: borderPrimary } },
        axisLabel: { color: textTertiary, fontSize: 10 },
        axisPointer: buildAxisPointerLabel(chartColors),
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { show: false },
        axisLabel: {
          color: textTertiary,
          fontSize: 10,
          formatter: (value: number) => value.toFixed(2),
        },
        axisPointer: buildAxisPointerLabel(chartColors, (p) => Number(p.value).toFixed(2)),
        splitLine: { lineStyle: { color: borderSecondary, type: 'dashed' } },
      },
      series: [
        {
          type: 'candlestick',
          data: ohlc,
          itemStyle: {
            color: riseColor,
            color0: fallColor,
            borderColor: riseColor,
            borderColor0: fallColor,
          },
        },
      ],
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: buildCrosshairAxisPointer(chartColors),
        backgroundColor: tooltipBg,
        borderColor: borderPrimary,
        borderWidth: 1,
        textStyle: { color: textPrimary, fontSize: 12 },
        extraCssText:
          'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 8px; box-shadow: 0 10px 26px rgba(0,0,0,0.32);',
      },
      dataZoom: [
        { type: 'inside', start: 70, end: 100 },
        { type: 'slider', start: 70, end: 100, height: 20, bottom: 0 },
      ],
    };
  }, [klineData, chartColors]);

  const latestFundFlow = fundFlowHistory.at(-1) ?? null;

  const fundFlowChartOption = useMemo(() => {
    if (!fundFlowHistory.length) return {};

    const {
      rise: riseColor,
      fall: fallColor,
      borderPrimary,
      borderSecondary,
      textTertiary,
      tooltipBg,
      textPrimary,
    } = chartColors;

    return {
      animation: false,
      grid: { left: 60, right: 56, top: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: fundFlowHistory.map((item) => item.date),
        axisLine: { lineStyle: { color: borderPrimary } },
        axisLabel: { color: textTertiary, fontSize: 10 },
        axisPointer: buildAxisPointerLabel(chartColors),
      },
      yAxis: [
        {
          type: 'value',
          axisLine: { show: false },
          axisLabel: {
            color: textTertiary,
            fontSize: 10,
            formatter: (value: number) => `${value.toFixed(1)}亿`,
          },
          axisPointer: buildAxisPointerLabel(chartColors, (p) => `${Number(p.value).toFixed(1)}亿`),
          splitLine: { lineStyle: { color: borderSecondary, type: 'dashed' } },
        },
        {
          type: 'value',
          axisLine: { show: false },
          axisLabel: {
            color: textTertiary,
            fontSize: 10,
            formatter: (value: number) => `${value.toFixed(1)}%`,
          },
          axisPointer: buildAxisPointerLabel(chartColors, (p) => `${Number(p.value).toFixed(1)}%`),
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '主力净流入',
          type: 'bar',
          data: fundFlowHistory.map((item) =>
            item.mainNetInflow === null ? null : item.mainNetInflow / 100000000
          ),
          itemStyle: {
            color: (params: { value: number }) => (params.value >= 0 ? riseColor : fallColor),
          },
          barMaxWidth: 18,
        },
        {
          name: '净占比',
          type: 'line',
          yAxisIndex: 1,
          data: fundFlowHistory.map((item) => item.mainNetInflowPercent),
          symbol: 'none',
          lineStyle: { width: 1.5, color: chartColors.accent },
        },
      ],
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: buildCrosshairAxisPointer(chartColors),
        backgroundColor: tooltipBg,
        borderColor: borderPrimary,
        borderWidth: 1,
        textStyle: { color: textPrimary, fontSize: 12 },
        extraCssText:
          'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 8px; box-shadow: 0 10px 26px rgba(0,0,0,0.32);',
      },
    };
  }, [fundFlowHistory, chartColors]);

  // 跳转个股
  const handleStockClick = (stockCode: string) => {
    navigate(`/s/${stockCode}`);
  };

  // 加入自选
  const handleAddWatchlist = (stockCode: string, stockName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (checkIsAdded(stockCode)) return;
    watchlistActions.add(stockCode);
    toast.success(`已将 ${stockName} 加入自选`);
  };

  // 检查是否已加自选
  const checkIsAdded = useIsInWatchlist();

  if (loading || (boardLoading && !displayBoard)) {
    return <Loading fullScreen text="加载板块数据..." />;
  }

  if (!displayBoard) {
    return (
      <div className={styles.notFound}>
        <p>未找到板块 {normalizedCode || code}</p>
        <Button onClick={() => navigate(-1)}>返回</Button>
      </div>
    );
  }

  const visibleConstituents = showAllConstituents ? constituents : constituents.slice(0, 50);

  return (
    <div className={styles.detail}>
      {/* 头部 */}
      <motion.header
        className={styles.header}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </button>

        <div className={styles.boardHeader}>
          <h1 className={styles.boardName}>{displayBoard.name}</h1>
          <span className={styles.boardType}>
            {isIndustry ? '行业板块' : '概念板块'}
          </span>
        </div>

        <div className={`${styles.boardChange} ${getChangeColorClass(displayBoard.changePercent)}`}>
          {formatPercent(displayBoard.changePercent)}
        </div>

        <div className={styles.boardMeta}>
          {displayBoard.price != null && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>
                {displayBoard.priceLabel ?? (displayBoard.priceScale === 'index' ? '板块指数(点)' : '成分均价(元)')}
              </span>
              <span>{displayBoard.price.toFixed(2)}</span>
            </div>
          )}
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>
              总市值{displayBoard.derivedFields?.totalMarketCap ? '·成分' : ''}
            </span>
            <span>{formatMarketCap(displayBoard.totalMarketCap)}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>
              换手率{displayBoard.derivedFields?.turnoverRate ? '·均' : ''}
            </span>
            <span>{formatTurnover(displayBoard.turnoverRate)}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>涨/跌</span>
            <span>
              <span className="text-rise">{displayBoard.riseCount ?? '--'}</span>
              {' / '}
              <span className="text-fall">{displayBoard.fallCount ?? '--'}</span>
            </span>
          </div>
        </div>
      </motion.header>

      <div className={styles.content}>
        {/* K线图 */}
        <Card
          title="K线走势"
          extra={
            <Tabs
              items={KLINE_PERIODS}
              activeKey={klinePeriod}
              onChange={setKlinePeriod}
              size="sm"
            />
          }
        >
          {klineSourceLabel && (
            <div className={styles.cardSourceTag}>{klineSourceLabel}</div>
          )}
          <div className={styles.chartContainer}>
            {klineData.length > 0 ? (
              <LazyEChart
                option={klineChartOption}
                style={{ height: '100%', width: '100%' }}
                notMerge
              />
            ) : (
              <Empty title="暂无K线数据" />
            )}
          </div>
        </Card>

        {/* Spot 指标 */}
        {spotData.length > 0 && (
          <Card title="实时指标">
            <div className={styles.spotGrid}>
              {spotData.map((spot) => (
                <div key={spot.item} className={styles.spotItem}>
                  <span className={styles.spotLabel}>{spot.item}</span>
                  <span className={styles.spotValue}>
                    {spot.value?.toLocaleString() ?? '--'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {(periodFlows.length > 0 || (fundFlowHistory.length > 0 && latestFundFlow)) && (
          <Card title="板块资金流">
            {fundFlowState?.flowSourceLabel && (
              <div className={styles.cardSourceTag}>{fundFlowState.flowSourceLabel}</div>
            )}
            {periodFlows.length > 0 && (
              <div className={styles.periodFlowGrid}>
                {periodFlows.map((pf) => (
                  <div key={pf.period} className={styles.periodFlowItem}>
                    <span className={styles.periodFlowLabel}>{pf.label}净流入</span>
                    <span className={`${styles.periodFlowValue} ${getChangeColorClass(pf.netInflowYi)}`}>
                      {pf.netInflowYi != null ? `${pf.netInflowYi > 0 ? '+' : ''}${pf.netInflowYi.toFixed(2)}亿` : '--'}
                    </span>
                    <span className={`${styles.periodFlowSub} ${getChangeColorClass(pf.changePercent)}`}>
                      {pf.changePercent != null ? `涨跌 ${formatPercent(pf.changePercent)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {fundFlowHistory.length > 0 && latestFundFlow && (
              <>
                <div className={styles.flowSummary}>
                  <div className={styles.flowSummaryItem}>
                    <span className={styles.flowSummaryLabel}>最近日线主力净流</span>
                    <span
                      className={`${styles.flowSummaryValue} ${getChangeColorClass(
                        latestFundFlow.mainNetInflow
                      )}`}
                    >
                      {formatYuanAmount(latestFundFlow.mainNetInflow)}
                    </span>
                  </div>
                  <div className={styles.flowSummaryItem}>
                    <span className={styles.flowSummaryLabel}>净占比</span>
                    <span
                      className={`${styles.flowSummaryValue} ${getChangeColorClass(
                        latestFundFlow.mainNetInflowPercent
                      )}`}
                    >
                      {formatPercent(latestFundFlow.mainNetInflowPercent)}
                    </span>
                  </div>
                  <div className={styles.flowSummaryItem}>
                    <span className={styles.flowSummaryLabel}>超大单净流入</span>
                    <span
                      className={`${styles.flowSummaryValue} ${getChangeColorClass(
                        latestFundFlow.superLargeNetInflow
                      )}`}
                    >
                      {formatYuanAmount(latestFundFlow.superLargeNetInflow)}
                    </span>
                  </div>
                  <div className={styles.flowSummaryItem}>
                    <span className={styles.flowSummaryLabel}>小单净流入</span>
                    <span
                      className={`${styles.flowSummaryValue} ${getChangeColorClass(
                        latestFundFlow.smallNetInflow
                      )}`}
                    >
                      {formatYuanAmount(latestFundFlow.smallNetInflow)}
                    </span>
                  </div>
                </div>
                <div className={styles.flowChart}>
                  <LazyEChart
                    option={fundFlowChartOption}
                    style={{ height: '100%', width: '100%' }}
                    notMerge
                  />
                </div>
              </>
            )}
          </Card>
        )}

        {/* 成分股 */}
        <Card title={`成分股 (${constituents.length})`}>
          <div className={styles.stockTable}>
            <div className={styles.tableHeader}>
              <span className={styles.colRank}>排名</span>
              <span className={styles.colName}>名称/代码</span>
              <span className={styles.colPrice}>现价</span>
              <span className={styles.colChangePercent}>涨跌幅</span>
              <span className={styles.colAmount}>成交额</span>
              <span className={styles.colTurnover}>换手</span>
              <span className={styles.colPe}>PE</span>
              <span className={styles.colAction}>操作</span>
            </div>
            <div className={styles.tableBody}>
              {visibleConstituents.map((stock) => (
                <div
                  key={stock.code}
                  className={styles.tableRow}
                  onClick={() => handleStockClick(stock.code)}
                >
                  <span className={styles.colRank}>
                    <span className={`${styles.rankNum} ${stock.rank <= 3 ? styles.top3 : ''}`}>
                      {stock.rank}
                    </span>
                  </span>
                  <div className={styles.colName}>
                    <span className={styles.stockName}>{stock.name}</span>
                    <span className={styles.stockCode}>{stock.code}</span>
                  </div>
                  <span className={`${styles.colPrice} ${getChangeColorClass(stock.changePercent)}`}>
                    {formatPrice(stock.price)}
                  </span>
                  <span className={`${styles.colChangePercent} ${getChangeColorClass(stock.changePercent)}`}>
                    {formatPercent(stock.changePercent)}
                  </span>
                  <span className={styles.colAmount}>
                    {formatAmount(stock.amount)}
                  </span>
                  <span className={styles.colTurnover}>
                    {formatTurnover(stock.turnoverRate)}
                  </span>
                  <span className={styles.colPe}>
                    {stock.pe != null ? stock.pe.toFixed(2) : '--'}
                  </span>
                  <div className={styles.colAction}>
                    <button
                      className={`${styles.addBtn} ${checkIsAdded(stock.code) ? styles.added : ''}`}
                      onClick={(e) => handleAddWatchlist(stock.code, stock.name, e)}
                      disabled={checkIsAdded(stock.code)}
                    >
                      {checkIsAdded(stock.code) ? <Check size={14} /> : <Plus size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {constituents.length > 50 && (
            <div className={styles.expandBar}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowAllConstituents((prev) => !prev)}
              >
                {showAllConstituents ? '收起至前 50 只' : `展开全部 ${constituents.length} 只成分股`}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
