/**
 * 个股详情页
 */

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Star, StarOff, Bell, Trash2 } from 'lucide-react';
import { addIndicators } from 'stock-sdk';
import type {
  DividendDetail,
  FundFlow,
  FullQuote,
  HistoryKline,
  PanelLargeOrder,
  TodayTimelineResponse,
} from 'stock-sdk';
import {
  fetchGlobalChart,
  fetchGlobalQuotes,
  type GlobalStockRow,
} from '@/services/globalMarketsApi';
import {
  OUTER_MARKET_BADGE,
  globalRowToTerminalQuote,
} from '@/pages/Watchlist/watchlistGlobalAdapter';
import { LazyEChart } from '@/components/charts/LazyEChart';
import {
  buildAxisPointerLabel,
  buildCrosshairAxisPointer,
  buildCrosshairGlobalAxisPointer,
  getChartColors,
  withAlpha,
  type ChartColors,
} from '@/components/charts/chartTheme';
import { Button, Card, Loading, Tabs, triggerClickRipple, useToast } from '@/components/common';
import { StockExpertEvidenceCard, StockMinesweeperPanel } from '@/components/expert';
import { useAppSettings } from '@/contexts';
import { useAlertRules, useIsInWatchlist, usePolling, useTheme } from '@/hooks';
import {
  getDividendDetail,
  getFullQuotes,
  getFundFlow,
  getIndividualFundFlow,
  getKlineWithIndicators,
  getMinuteKline,
  getNorthboundIndividual,
  getPanelLargeOrder,
  getTodayTimeline,
} from '@/services/sdk';
import { watchlistActions } from '@/services/watchlistStore';
import type { AdjustType, AlertType, KlinePeriod } from '@/types';
import type { IndicatorConfig } from '@/types';
import {
  detectAssetMarket,
  formatAmount,
  formatChange,
  formatCompactNumber,
  formatCurrencyPrice,
  formatMarketCap,
  formatMarketValueByCurrency,
  formatPercent,
  formatPrice,
  formatRatio,
  formatTurnover,
  normalizeLargeOrderRatios,
  formatVolume,
  formatVolumeRatio,
  formatYuanAmount,
  getChangeColorClass,
  normalizeStockCode,
  yearsAgoYmd,
} from '@/utils/format';
import styles from './StockDetail.module.css';

type IndividualFundFlowRows = Awaited<ReturnType<typeof getIndividualFundFlow>>;
type NorthboundIndividualRows = Awaited<ReturnType<typeof getNorthboundIndividual>>;

const KLINE_PERIODS = [
  { key: 'daily', label: '日K' },
  { key: 'weekly', label: '周K' },
  { key: 'monthly', label: '月K' },
];

const KLINE_ADJUST_OPTIONS: ReadonlyArray<{ key: AdjustType; label: string }> = [
  { key: 'qfq', label: '前复权' },
  { key: 'hfq', label: '后复权' },
  { key: '', label: '不复权' },
];

const DAILY_KLINE_WINDOW_YEARS = 3;

function getKlineStartDate(period: KlinePeriod): string | undefined {
  return period === 'daily' ? yearsAgoYmd(DAILY_KLINE_WINDOW_YEARS) : undefined;
}

const MINUTE_PERIODS = [
  { key: '1', label: '分时' },
  { key: '5', label: '5分' },
  { key: '15', label: '15分' },
  { key: '30', label: '30分' },
  { key: '60', label: '60分' },
];

const OVERLAY_OPTIONS = [
  { key: 'ma', label: 'MA' },
  { key: 'boll', label: 'BOLL' },
  { key: 'sar', label: 'SAR' },
  { key: 'kc', label: 'KC' },
] as const;

const OSCILLATOR_OPTIONS = [
  { key: 'macd', label: 'MACD' },
  { key: 'kdj', label: 'KDJ' },
  { key: 'rsi', label: 'RSI' },
  { key: 'obv', label: 'OBV' },
  { key: 'roc', label: 'ROC' },
  { key: 'dmi', label: 'DMI-ADX' },
] as const;

const ALERT_TYPE_OPTIONS: Array<{ key: AlertType; label: string }> = [
  { key: 'price_gte', label: '价格 >= ' },
  { key: 'price_lte', label: '价格 <= ' },
  { key: 'change_percent_gte', label: '涨幅 >= ' },
  { key: 'change_percent_lte', label: '涨幅 <= ' },
  { key: 'amount_gte', label: '成交额 >= ' },
];

type OverlayIndicatorKey = (typeof OVERLAY_OPTIONS)[number]['key'];
type OscillatorIndicatorKey = (typeof OSCILLATOR_OPTIONS)[number]['key'];

interface MinuteKlineItem {
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

interface KlineDataItem extends HistoryKline {
  ma?: Record<string, number>;
  macd?: { dif?: number; dea?: number; macd?: number };
  boll?: { upper?: number; mid?: number; lower?: number };
  kdj?: { k?: number; d?: number; j?: number };
  rsi?: Record<string, number>;
  obv?: { obv: number | null; obvMa: number | null };
  roc?: { roc: number | null; signal: number | null };
  dmi?: { pdi: number | null; mdi: number | null; adx: number | null };
  sar?: { sar: number | null; trend: 1 | -1 | null };
  kc?: { upper: number | null; mid: number | null; lower: number | null };
}

function formatMaybeDate(value: string | null | undefined) {
  return value || '--';
}

function formatYield(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }

  return `${value.toFixed(2)}%`;
}

function buildTimelineOption(args: {
  minutePeriod: string;
  timeline: TodayTimelineResponse | null;
  minuteKline: MinuteKlineItem[];
  prevClose: number | undefined;
  colors: ChartColors;
}) {
  const { minutePeriod, timeline, minuteKline, prevClose, colors } = args;

  if (minutePeriod === '1') {
    if (!timeline?.data?.length) {
      return {};
    }

    const times = timeline.data.map((item) => item.time);
    const prices = timeline.data.map((item) => item.price);
    const avgPrices = timeline.data.map((item) => item.avgPrice);
    const basePrice = prevClose ?? prices[0];
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = Math.max(maxPrice - basePrice, basePrice - minPrice) * 1.1;

    return {
      animation: false,
      grid: { left: 60, right: 56, top: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: times,
        axisLine: { lineStyle: { color: colors.borderPrimary } },
        axisLabel: { color: colors.textTertiary, fontSize: 10 },
        axisPointer: buildAxisPointerLabel(colors),
      },
      yAxis: [
        {
          type: 'value',
          min: basePrice - range,
          max: basePrice + range,
          axisLine: { show: false },
          axisLabel: {
            color: colors.textTertiary,
            fontSize: 10,
            formatter: (value: number) => value.toFixed(2),
          },
          axisPointer: buildAxisPointerLabel(colors, (p) => Number(p.value).toFixed(2)),
          splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
        },
        {
          type: 'value',
          position: 'right',
          min: basePrice - range,
          max: basePrice + range,
          axisLine: { show: false },
          axisLabel: {
            color: colors.textTertiary,
            fontSize: 10,
            formatter: (value: number) => {
              if (!basePrice || basePrice <= 0) return '0.00%';
              const pct = ((value - basePrice) / basePrice) * 100;
              return `${pct > 0.005 ? '+' : ''}${pct.toFixed(2)}%`;
            },
          },
          axisPointer: buildAxisPointerLabel(colors, (p) => {
            const val = Number(p.value);
            if (!basePrice || basePrice <= 0 || !Number.isFinite(val)) return '0.00%';
            const pct = ((val - basePrice) / basePrice) * 100;
            return `${pct > 0.005 ? '+' : ''}${pct.toFixed(2)}%`;
          }),
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '价格',
          type: 'line',
          data: prices,
          symbol: 'none',
          lineStyle: { width: 1.6, color: colors.accent },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(colors.accent, 0.28) },
                { offset: 1, color: withAlpha(colors.accent, 0.01) },
              ],
            },
          },
        },
        {
          name: '均价',
          type: 'line',
          data: avgPrices,
          symbol: 'none',
          lineStyle: { width: 1.1, color: colors.accent2, type: 'dashed' },
        },
      ],
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: buildCrosshairAxisPointer(colors),
        backgroundColor: colors.tooltipBg,
        borderColor: colors.borderPrimary,
        borderWidth: 1,
        textStyle: { color: colors.textPrimary, fontSize: 12 },
        extraCssText:
          'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 8px; box-shadow: 0 10px 26px rgba(0,0,0,0.32);',
      },
    };
  }

  if (!minuteKline.length) {
    return {};
  }

  const times = minuteKline.map((item) => item.time);
  const ohlc = minuteKline.map((item) => [item.open, item.close, item.low, item.high]);

  return {
    animation: false,
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { lineStyle: { color: colors.borderPrimary } },
      axisLabel: { color: colors.textTertiary, fontSize: 10 },
      axisPointer: buildAxisPointerLabel(colors),
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { show: false },
      axisLabel: {
        color: colors.textTertiary,
        fontSize: 10,
        formatter: (value: number) => value.toFixed(2),
      },
      axisPointer: buildAxisPointerLabel(colors, (p) => Number(p.value).toFixed(2)),
      splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
    },
    series: [
      {
        name: `${minutePeriod}分K`,
        type: 'candlestick',
        data: ohlc,
        itemStyle: {
          color: colors.rise,
          color0: colors.fall,
          borderColor: colors.rise,
          borderColor0: colors.fall,
        },
      },
    ],
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: buildCrosshairAxisPointer(colors),
      backgroundColor: colors.tooltipBg,
      borderColor: colors.borderPrimary,
      borderWidth: 1,
      textStyle: { color: colors.textPrimary, fontSize: 12 },
      extraCssText:
        'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 8px; box-shadow: 0 10px 26px rgba(0,0,0,0.32);',
    },
  };
}

function buildKlineOption(args: {
  data: KlineDataItem[];
  overlays: OverlayIndicatorKey[];
  oscillator: OscillatorIndicatorKey;
  indicatorConfig: IndicatorConfig;
  colors: ChartColors;
}) {
  const { data, overlays, oscillator, indicatorConfig, colors } = args;

  if (!data.length) {
    return {};
  }

  const dates = data.map((item) => item.date);
  const ohlc = data.map((item) => [
    item.open ?? 0,
    item.close ?? 0,
    item.low ?? 0,
    item.high ?? 0,
  ]);
  const volumes = data.map((item) => ({
    value: item.volume ?? 0,
    itemStyle: {
      color: (item.close ?? 0) >= (item.open ?? 0) ? colors.rise : colors.fall,
    },
  }));

  const startPercent =
    data.length > 60 ? Math.max(0, ((data.length - 60) / data.length) * 100) : 0;

  const series: unknown[] = [
    {
      name: 'K线',
      type: 'candlestick',
      data: ohlc,
      itemStyle: {
        color: colors.rise,
        color0: colors.fall,
        borderColor: colors.rise,
        borderColor0: colors.fall,
      },
    },
    {
      name: '成交量',
      type: 'bar',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: volumes,
    },
  ];

  if (overlays.includes('ma')) {
    const maColors = ['#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];
    indicatorConfig.ma.forEach((period, index) => {
      series.push({
        name: `MA${period}`,
        type: 'line',
        data: data.map((item) => item.ma?.[`ma${period}`] ?? null),
        symbol: 'none',
        lineStyle: { width: 1, color: maColors[index % maColors.length] },
      });
    });
  }

  if (overlays.includes('boll')) {
    series.push(
      {
        name: 'BOLL上轨',
        type: 'line',
        data: data.map((item) => item.boll?.upper ?? null),
        symbol: 'none',
        lineStyle: { width: 1, color: '#f59e0b', type: 'dashed' },
      },
      {
        name: 'BOLL中轨',
        type: 'line',
        data: data.map((item) => item.boll?.mid ?? null),
        symbol: 'none',
        lineStyle: { width: 1, color: '#8b5cf6' },
      },
      {
        name: 'BOLL下轨',
        type: 'line',
        data: data.map((item) => item.boll?.lower ?? null),
        symbol: 'none',
        lineStyle: { width: 1, color: '#f59e0b', type: 'dashed' },
      }
    );
  }

  if (overlays.includes('sar')) {
    series.push({
      name: 'SAR',
      type: 'scatter',
      data: data.map((item) => item.sar?.sar ?? null),
      symbolSize: 5,
      itemStyle: { color: '#22d3ee' },
    });
  }

  if (overlays.includes('kc')) {
    series.push(
      {
        name: 'KC上轨',
        type: 'line',
        data: data.map((item) => item.kc?.upper ?? null),
        symbol: 'none',
        lineStyle: { width: 1, color: '#10b981' },
      },
      {
        name: 'KC中轨',
        type: 'line',
        data: data.map((item) => item.kc?.mid ?? null),
        symbol: 'none',
        lineStyle: { width: 1, color: '#06b6d4' },
      },
      {
        name: 'KC下轨',
        type: 'line',
        data: data.map((item) => item.kc?.lower ?? null),
        symbol: 'none',
        lineStyle: { width: 1, color: '#10b981' },
      }
    );
  }

  switch (oscillator) {
    case 'kdj':
      series.push(
        {
          name: 'K',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.kdj?.k ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: '#f59e0b' },
        },
        {
          name: 'D',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.kdj?.d ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: '#3b82f6' },
        },
        {
          name: 'J',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.kdj?.j ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: '#ec4899' },
        }
      );
      break;
    case 'rsi':
      indicatorConfig.rsi.forEach((period, index) => {
        const colors = ['#f59e0b', '#3b82f6', '#ec4899', '#14b8a6'];
        series.push({
          name: `RSI${period}`,
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.rsi?.[`rsi${period}`] ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: colors[index % colors.length] },
        });
      });
      break;
    case 'obv':
      series.push(
        {
          name: 'OBV',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.obv?.obv ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: '#60a5fa' },
        },
        {
          name: 'OBV MA',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.obv?.obvMa ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: '#f59e0b' },
        }
      );
      break;
    case 'roc':
      series.push(
        {
          name: 'ROC',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.roc?.roc ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: colors.fall },
        },
        {
          name: 'ROC Signal',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.roc?.signal ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: '#f59e0b' },
        }
      );
      break;
    case 'dmi':
      series.push(
        {
          name: '+DI',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.dmi?.pdi ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: colors.fall },
        },
        {
          name: '-DI',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.dmi?.mdi ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: colors.rise },
        },
        {
          name: 'ADX',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.dmi?.adx ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: '#3b82f6' },
        }
      );
      break;
    case 'macd':
    default:
      series.push(
        {
          name: 'MACD',
          type: 'bar',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => ({
            value: item.macd?.macd ?? 0,
            itemStyle: { color: (item.macd?.macd ?? 0) >= 0 ? colors.rise : colors.fall },
          })),
        },
        {
          name: 'DIF',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.macd?.dif ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: '#f59e0b' },
        },
        {
          name: 'DEA',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: data.map((item) => item.macd?.dea ?? null),
          symbol: 'none',
          lineStyle: { width: 1, color: '#3b82f6' },
        }
      );
      break;
  }

  const latest = data[data.length - 1];
  const oscillatorSummary =
    oscillator === 'macd'
      ? `MACD ${latest.macd?.dif?.toFixed(2) ?? '-'} / ${latest.macd?.dea?.toFixed(2) ?? '-'}`
      : oscillator === 'kdj'
        ? `KDJ ${latest.kdj?.k?.toFixed(2) ?? '-'} / ${latest.kdj?.d?.toFixed(2) ?? '-'} / ${latest.kdj?.j?.toFixed(2) ?? '-'}`
        : oscillator === 'rsi'
          ? `RSI ${indicatorConfig.rsi
            .map((period) => `${period}:${latest.rsi?.[`rsi${period}`]?.toFixed(2) ?? '-'}`)
            .join(' ')}`
          : oscillator === 'obv'
            ? `OBV ${latest.obv?.obv?.toFixed(0) ?? '-'}`
            : oscillator === 'roc'
              ? `ROC ${latest.roc?.roc?.toFixed(2) ?? '-'}`
              : `DMI ${latest.dmi?.pdi?.toFixed(2) ?? '-'} / ${latest.dmi?.mdi?.toFixed(2) ?? '-'} / ${latest.dmi?.adx?.toFixed(2) ?? '-'}`;

  return {
    animation: false,
    axisPointer: buildCrosshairGlobalAxisPointer(colors),
    grid: [
      { left: 70, right: 30, top: 42, height: '40%' },
      { left: 70, right: 30, top: '62%', height: '10%' },
      { left: 70, right: 30, top: '78%', height: '12%' },
    ],
    graphic: [
      {
        type: 'text',
        left: 80,
        top: 10,
        style: {
          text: oscillatorSummary,
          fill: colors.textTertiary,
          fontSize: 11,
        },
      },
    ],
    xAxis: [
      {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: colors.borderPrimary } },
        axisLabel: { show: false },
        axisPointer: { show: true, label: { show: false } },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: dates,
        axisLine: { lineStyle: { color: colors.borderPrimary } },
        axisLabel: { show: false },
        axisPointer: { show: true, label: { show: false } },
      },
      {
        type: 'category',
        gridIndex: 2,
        data: dates,
        axisLine: { lineStyle: { color: colors.borderPrimary } },
        axisLabel: { color: colors.textTertiary, fontSize: 10 },
        axisPointer: buildAxisPointerLabel(colors),
      },
    ],
    yAxis: [
      {
        type: 'value',
        scale: true,
        axisLine: { show: false },
        axisLabel: { color: colors.textTertiary, fontSize: 10 },
        axisPointer: buildAxisPointerLabel(colors, (p) => Number(p.value).toFixed(2)),
        splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
      },
      {
        type: 'value',
        gridIndex: 1,
        axisLine: { show: false },
        axisLabel: { show: false },
        axisPointer: { show: false },
        splitLine: { show: false },
      },
      {
        type: 'value',
        gridIndex: 2,
        axisLine: { show: false },
        axisLabel: { color: colors.textTertiary, fontSize: 9 },
        axisPointer: { show: false },
        splitLine: { show: false },
      },
    ],
    series,
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: buildCrosshairAxisPointer(colors),
      backgroundColor: colors.tooltipBg,
      borderColor: colors.borderPrimary,
      borderWidth: 1,
      textStyle: { color: colors.textPrimary, fontSize: 12 },
      extraCssText:
        'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 8px; box-shadow: 0 10px 26px rgba(0,0,0,0.32);',
      formatter: (params: unknown[]) => {
        if (!Array.isArray(params) || params.length === 0) {
          return '';
        }

        const firstParam = params[0] as { axisValue?: string; dataIndex?: number };
        const dataIndex = firstParam.dataIndex ?? 0;
        const item = data[dataIndex];

        if (!item) {
          return '';
        }

        const overlayTexts: string[] = [];

        if (overlays.includes('ma')) {
          overlayTexts.push(
            ...indicatorConfig.ma.map(
              (period) => `MA${period}: ${item.ma?.[`ma${period}`]?.toFixed(2) ?? '--'}`
            )
          );
        }

        if (overlays.includes('boll')) {
          overlayTexts.push(
            `BOLL: ${item.boll?.upper?.toFixed(2) ?? '--'} / ${item.boll?.mid?.toFixed(2) ?? '--'} / ${item.boll?.lower?.toFixed(2) ?? '--'}`
          );
        }

        if (overlays.includes('sar')) {
          overlayTexts.push(`SAR: ${item.sar?.sar?.toFixed(2) ?? '--'}`);
        }

        if (overlays.includes('kc')) {
          overlayTexts.push(
            `KC: ${item.kc?.upper?.toFixed(2) ?? '--'} / ${item.kc?.mid?.toFixed(2) ?? '--'} / ${item.kc?.lower?.toFixed(2) ?? '--'}`
          );
        }

        let oscillatorText = '';
        switch (oscillator) {
          case 'kdj':
            oscillatorText = `KDJ: ${item.kdj?.k?.toFixed(2) ?? '--'} / ${item.kdj?.d?.toFixed(2) ?? '--'} / ${item.kdj?.j?.toFixed(2) ?? '--'}`;
            break;
          case 'rsi':
            oscillatorText = indicatorConfig.rsi
              .map((period) => `RSI${period}: ${item.rsi?.[`rsi${period}`]?.toFixed(2) ?? '--'}`)
              .join('<br/>');
            break;
          case 'obv':
            oscillatorText = `OBV: ${item.obv?.obv?.toFixed(0) ?? '--'} / MA: ${item.obv?.obvMa?.toFixed(0) ?? '--'}`;
            break;
          case 'roc':
            oscillatorText = `ROC: ${item.roc?.roc?.toFixed(2) ?? '--'} / Signal: ${item.roc?.signal?.toFixed(2) ?? '--'}`;
            break;
          case 'dmi':
            oscillatorText = `+DI: ${item.dmi?.pdi?.toFixed(2) ?? '--'}<br/>-DI: ${item.dmi?.mdi?.toFixed(2) ?? '--'}<br/>ADX: ${item.dmi?.adx?.toFixed(2) ?? '--'}`;
            break;
          case 'macd':
          default:
            oscillatorText = `DIF: ${item.macd?.dif?.toFixed(2) ?? '--'} / DEA: ${item.macd?.dea?.toFixed(2) ?? '--'} / MACD: ${item.macd?.macd?.toFixed(2) ?? '--'}`;
            break;
        }

        return `
          <div style="font-weight:500;margin-bottom:8px;">${firstParam.axisValue ?? ''}</div>
          <div>开: ${(item.open ?? 0).toFixed(2)} 收: ${(item.close ?? 0).toFixed(2)}</div>
          <div>高: ${(item.high ?? 0).toFixed(2)} 低: ${(item.low ?? 0).toFixed(2)}</div>
          <div>量: ${((item.volume ?? 0) / 10000).toFixed(2)}万手</div>
          ${overlayTexts.length > 0 ? `<div style="margin-top:6px;border-top:1px solid ${colors.borderPrimary};padding-top:6px;">${overlayTexts.join('<br/>')}</div>` : ''}
          <div style="margin-top:6px;border-top:1px solid ${colors.borderPrimary};padding-top:6px;">${oscillatorText}</div>
        `;
      },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2], start: startPercent, end: 100 },
      {
        type: 'slider',
        xAxisIndex: [0, 1, 2],
        start: startPercent,
        end: 100,
        bottom: 10,
        height: 20,
        borderColor: colors.borderPrimary,
        backgroundColor: colors.borderSecondary,
        fillerColor: 'rgba(88, 166, 255, 0.2)',
        handleStyle: { color: '#58a6ff' },
        textStyle: { color: colors.textTertiary, fontSize: 10 },
      },
    ],
  };
}

export function StockDetail() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings, getRefreshInterval } = useAppSettings();
  const { theme, preset } = useTheme();
  const chartColors = useMemo(
    () => getChartColors(theme, settings.colorMode, preset),
    [theme, settings.colorMode, preset]
  );
  const normalizedCode = normalizeStockCode(code || '');
  const assetMarket = detectAssetMarket(normalizedCode);
  const isOuter = assetMarket !== 'cn';

  const [outerRow, setOuterRow] = useState<GlobalStockRow | null>(null);
  const [quote, setQuote] = useState<FullQuote | null>(null);
  const [timeline, setTimeline] = useState<TodayTimelineResponse | null>(null);
  const [minuteKline, setMinuteKline] = useState<MinuteKlineItem[]>([]);
  const [klineData, setKlineData] = useState<KlineDataItem[]>([]);
  const [fundFlow, setFundFlow] = useState<FundFlow | null>(null);
  const [largeOrder, setLargeOrder] = useState<PanelLargeOrder | null>(null);
  const [individualFundFlowHistory, setIndividualFundFlowHistory] =
    useState<IndividualFundFlowRows>([]);
  const [northboundHoldings, setNorthboundHoldings] =
    useState<NorthboundIndividualRows>([]);
  const [dividends, setDividends] = useState<DividendDetail[]>([]);
  const alerts = useAlertRules(normalizedCode);

  const [loading, setLoading] = useState(true);
  const isInWatchlist = useIsInWatchlist();
  const inWatchlist = isInWatchlist(normalizedCode);
  const [minutePeriod, setMinutePeriod] = useState('1');
  const [klinePeriod, setKlinePeriod] = useState('daily');
  const [klineAdjust, setKlineAdjust] = useState<AdjustType>('qfq');
  const [klineAdjustManual, setKlineAdjustManual] = useState(false);
  const [klineAdjustNotice, setKlineAdjustNotice] = useState<string | null>(null);
  const [selectedOverlays, setSelectedOverlays] = useState<OverlayIndicatorKey[]>(['ma']);
  const [selectedOscillator, setSelectedOscillator] =
    useState<OscillatorIndicatorKey>('macd');
  const [alertType, setAlertType] = useState<AlertType>('price_gte');
  const [alertValue, setAlertValue] = useState('');

  const detailRefreshInterval = getRefreshInterval('detail');
  const fundRefreshInterval = Math.max(detailRefreshInterval * 6, 30000);

  // 每个 alertType 只预填一次：quote 随轮询高频更新，无守卫会持续覆写用户正在输入的阈值
  const [prefilledAlertType, setPrefilledAlertType] = useState<AlertType | null>(null);

  if (quote && prefilledAlertType !== alertType) {
    setPrefilledAlertType(alertType);
    setAlertValue(
      alertType === 'change_percent_gte' || alertType === 'change_percent_lte'
        ? quote.changePercent.toFixed(2)
        : alertType === 'amount_gte'
          ? Math.max(quote.amount, 1).toFixed(2)
          : quote.price.toFixed(2)
    );
  }

  const fetchQuote = useCallback(async () => {
    if (!normalizedCode) {
      return;
    }

    try {
      if (isOuter) {
        const res = await fetchGlobalQuotes([normalizedCode]);
        const row = res.items[0];
        if (row) {
          setOuterRow(row);
          setQuote(globalRowToTerminalQuote(row));
        }
        return;
      }
      const [quoteData] = await getFullQuotes([normalizedCode]);
      if (quoteData) {
        setQuote(quoteData);
      }
    } catch (error) {
      console.error('Fetch quote error:', error);
    }
  }, [normalizedCode, isOuter]);

  // 周期或复权切换后旧请求的慢响应可能后到，比对最新组合丢弃过期数据
  const minutePeriodRef = useRef(minutePeriod);
  const klineRequestKeyRef = useRef(`${normalizedCode}:${klinePeriod}:${klineAdjust}`);

  useEffect(() => {
    minutePeriodRef.current = minutePeriod;
    klineRequestKeyRef.current = `${normalizedCode}:${klinePeriod}:${klineAdjust}`;
  }, [minutePeriod, normalizedCode, klinePeriod, klineAdjust]);

  const fetchTimeline = useCallback(async () => {
    if (!normalizedCode) {
      return;
    }

    const requestPeriod = minutePeriod;
    try {
      if (isOuter) {
        if (requestPeriod === '1') {
          const gc = await fetchGlobalChart(normalizedCode, 'timeline');
          if (minutePeriodRef.current !== requestPeriod) return;
          setTimeline({
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
          } as unknown as TodayTimelineResponse);
          setMinuteKline([]);
        } else {
          const minPeriod =
            requestPeriod === '5' || requestPeriod === '15' || requestPeriod === '30'
              ? requestPeriod
              : '60';
          const gc = await fetchGlobalChart(normalizedCode, minPeriod);
          if (minutePeriodRef.current !== requestPeriod) return;
          setMinuteKline(
            (gc.bars ?? []).map((b) => ({
              time: b.time || b.date,
              open: b.open,
              close: b.close,
              high: b.high,
              low: b.low,
              volume: b.volume,
              amount: b.close * b.volume,
            }))
          );
          setTimeline(null);
        }
        return;
      }

      if (requestPeriod === '1') {
        const data = await getTodayTimeline(normalizedCode);
        if (minutePeriodRef.current !== requestPeriod) return;
        setTimeline(data);
        setMinuteKline([]);
        return;
      }

      const data = await getMinuteKline(normalizedCode, {
        period: requestPeriod as '5' | '15' | '30' | '60',
      });
      if (minutePeriodRef.current !== requestPeriod) return;
      setMinuteKline(data as MinuteKlineItem[]);
      setTimeline(null);
    } catch (error) {
      console.error('Fetch timeline error:', error);
    }
  }, [minutePeriod, normalizedCode, isOuter]);

  const handleKlinePeriodChange = useCallback(
    (nextPeriod: string) => {
      setKlinePeriod(nextPeriod);
      if (!klineAdjustManual) {
        setKlineAdjust(nextPeriod === 'daily' ? 'qfq' : 'hfq');
      }
    },
    [klineAdjustManual]
  );

  const handleKlineAdjustChange = useCallback((nextAdjust: AdjustType) => {
    setKlineAdjust(nextAdjust);
    setKlineAdjustManual(true);
  }, []);

  const fetchKline = useCallback(async () => {
    if (!normalizedCode) {
      return;
    }

    const requestPeriod = klinePeriod as KlinePeriod;
    const requestAdjust = klineAdjust;
    const requestKey = `${normalizedCode}:${requestPeriod}:${requestAdjust}`;
    const indicatorOpts = {
      ma: { periods: settings.indicatorConfig.ma },
      macd: settings.indicatorConfig.macd,
      boll: settings.indicatorConfig.boll,
      kdj: settings.indicatorConfig.kdj,
      rsi: { periods: settings.indicatorConfig.rsi },
      obv: { maPeriod: settings.indicatorConfig.ma[1] ?? 10 },
      roc: { period: 12, signalPeriod: 6 },
      dmi: settings.indicatorConfig.dmi,
      sar: settings.indicatorConfig.sar,
      kc: settings.indicatorConfig.kc,
    };
    try {
      if (isOuter) {
        const outerPeriod = requestPeriod === 'weekly' ? 'weekly' : 'daily';
        const gc = await fetchGlobalChart(normalizedCode, outerPeriod);
        if (klineRequestKeyRef.current !== requestKey) return;
        const baseBars = (gc.bars ?? []).map((b) => ({
          date: b.date,
          open: b.open,
          close: b.close,
          high: b.high,
          low: b.low,
          volume: b.volume,
          amount: b.close * b.volume,
        })) as HistoryKline[];
        const withInd = addIndicators(baseBars, indicatorOpts);
        setKlineData(withInd as unknown as KlineDataItem[]);
        setKlineAdjustNotice(
          requestPeriod === 'monthly' ? '外围市场暂展示日/周频序列（已启用全套技术指标）' : null
        );
        return;
      }

      const data = await getKlineWithIndicators(normalizedCode, {
        period: requestPeriod,
        adjust: requestAdjust,
        startDate: getKlineStartDate(requestPeriod),
        indicators: indicatorOpts,
      });
      if (klineRequestKeyRef.current !== requestKey) return;

      const rawRows = Array.isArray(data) ? data : [];
      if (requestAdjust === 'qfq') {
        const lastNonPositiveIdx = rawRows.reduce((acc, row, idx) => {
          const item = row as unknown as Record<string, unknown>;
          const minPrice = Math.min(Number(item.open), Number(item.close), Number(item.low));
          return !Number.isFinite(minPrice) || minPrice <= 0 ? idx : acc;
        }, -1);

        if (lastNonPositiveIdx >= 0 && lastNonPositiveIdx + 1 < rawRows.length) {
          const firstValidRow = rawRows[lastNonPositiveIdx + 1] as unknown as Record<string, unknown>;
          const safeStartDate = String(firstValidRow.date ?? '').slice(0, 10);
          if (safeStartDate) {
            const positiveData = await getKlineWithIndicators(normalizedCode, {
              period: requestPeriod,
              adjust: 'qfq',
              startDate: safeStartDate,
              indicators: indicatorOpts,
            });
            if (klineRequestKeyRef.current !== requestKey) return;
            setKlineData(positiveData as unknown as KlineDataItem[]);
            setKlineAdjustNotice(
              `已自动跳过 ${safeStartDate} 前分红扣减产生的负价前复权区间；查看全历史可切换「后复权」或「不复权」。`
            );
            return;
          }
        }
        if (lastNonPositiveIdx >= 0 && lastNonPositiveIdx === rawRows.length - 1) {
          setKlineData([]);
          setKlineAdjustNotice('该标的当前前复权序列全部为非正值，请切换「后复权」或「不复权」查看真实走势。');
          return;
        }
      }

      setKlineData(rawRows as unknown as KlineDataItem[]);
      setKlineAdjustNotice(
        requestAdjust === 'hfq' && requestPeriod !== 'daily'
          ? '周K / 月K 默认使用后复权以保持全历史连续无负价；可按需切换「前复权」或「不复权」。'
          : null
      );
    } catch (error) {
      console.error('Fetch kline error:', error);
    }
  }, [klinePeriod, klineAdjust, normalizedCode, settings.indicatorConfig, isOuter]);

  const fetchFundData = useCallback(async () => {
    if (!normalizedCode || isOuter) {
      return;
    }

    const results = await Promise.allSettled([
      getFundFlow([normalizedCode]),
      getPanelLargeOrder([normalizedCode]),
      getIndividualFundFlow(normalizedCode, { period: 'daily' }),
      getNorthboundIndividual(normalizedCode),
    ]);
    const labels = ['fundFlow', 'largeOrder', 'individualFundFlow', 'northbound'];
    results.forEach((res, idx) => {
      if (res.status === 'rejected') {
        console.warn(`Fetch fund partial failure (${labels[idx]}):`, res.reason);
      }
    });

    if (results[0].status === 'fulfilled' && results[0].value[0]) {
      setFundFlow(results[0].value[0]);
    }
    if (results[1].status === 'fulfilled' && results[1].value[0]) {
      setLargeOrder(results[1].value[0]);
    }
    if (results[2].status === 'fulfilled') {
      setIndividualFundFlowHistory(results[2].value.slice(-8));
    }
    if (results[3].status === 'fulfilled') {
      setNorthboundHoldings(results[3].value.slice(-8));
    }
  }, [normalizedCode, isOuter]);

  const fetchDividendData = useCallback(async () => {
    if (!normalizedCode || isOuter) {
      return;
    }

    try {
      const data = await getDividendDetail(normalizedCode);
      setDividends(data.slice(0, 6));
    } catch (error) {
      console.error('Fetch dividend error:', error);
    }
  }, [normalizedCode, isOuter]);

  // 整载只跑一次（换股由路由 key 重挂载触发）；周期/指标变化走下面的专属增量 effect，
  // 若把 fetch 回调放进依赖，切个 tab 就会全屏 loading + 五个接口全部重拉
  const loadInitial = useEffectEvent(async () => {
    setLoading(true);
    await Promise.all([
      fetchQuote(),
      fetchTimeline(),
      fetchKline(),
      fetchFundData(),
      fetchDividendData(),
    ]);
    setLoading(false);
  });

  useEffect(() => {
    loadInitial();
  }, [normalizedCode]);

  // 跳过挂载首轮（loadInitial 已拉过），只响应周期/复权/指标变化，避免首屏加载未完成时误吞切换操作
  const didMountTimelineRef = useRef(false);
  const reloadTimeline = useEffectEvent(() => {
    void fetchTimeline();
  });

  useEffect(() => {
    if (!didMountTimelineRef.current) {
      didMountTimelineRef.current = true;
      return;
    }
    reloadTimeline();
  }, [minutePeriod]);

  const didMountKlineRef = useRef(false);
  const reloadKline = useEffectEvent(() => {
    void fetchKline();
  });

  useEffect(() => {
    if (!didMountKlineRef.current) {
      didMountKlineRef.current = true;
      return;
    }
    reloadKline();
  }, [klinePeriod, klineAdjust, settings.indicatorConfig]);

  usePolling(
    useCallback(async () => {
      await Promise.all([fetchQuote(), fetchTimeline()]);
    }, [fetchQuote, fetchTimeline]),
    {
      interval: detailRefreshInterval,
      enabled: !loading,
      immediate: false,
    }
  );

  usePolling(fetchFundData, {
    interval: fundRefreshInterval,
    enabled: !loading && !isOuter,
    immediate: false,
  });

  const handleToggleWatchlist = useCallback(() => {
    if (inWatchlist) {
      watchlistActions.remove(normalizedCode);
      toast.success('已从自选移除');
    } else {
      watchlistActions.add(normalizedCode);
      toast.success('已加入自选');
    }
  }, [inWatchlist, normalizedCode, toast]);

  const handleAddAlert = useCallback(() => {
    if (!quote) {
      return;
    }

    const value = Number(alertValue);
    // 涨跌幅类阈值合法值域含负数（跌幅告警），只有价格/成交额类才要求正数
    const requiresPositive = !['change_percent_gte', 'change_percent_lte'].includes(alertType);
    if (!Number.isFinite(value) || (requiresPositive && value <= 0)) {
      toast.warning('请输入有效的告警阈值');
      return;
    }

    watchlistActions.addAlert({
      code: normalizedCode,
      name: quote.name,
      type: alertType,
      value,
      cooldownSec: 300,
      enabled: true,
      lastTriggeredAt: 0,
    });
    toast.success('已添加本地告警');
  }, [alertType, alertValue, normalizedCode, quote, toast]);

  const handleDeleteAlert = useCallback(
    (ruleId: string) => {
      watchlistActions.deleteAlert(ruleId);
      toast.success('已删除告警');
    },
    [toast]
  );

  const latestNorthboundHolding = northboundHoldings.at(-1) ?? null;

  const timelineChartOption = useMemo(
    () =>
      buildTimelineOption({
        minutePeriod,
        timeline,
        minuteKline,
        prevClose: quote?.prevClose,
        colors: chartColors,
      }),
    [minuteKline, minutePeriod, quote?.prevClose, timeline, chartColors]
  );

  const klineChartOption = useMemo(
    () =>
      buildKlineOption({
        data: klineData,
        overlays: selectedOverlays,
        oscillator: selectedOscillator,
        indicatorConfig: settings.indicatorConfig,
        colors: chartColors,
      }),
    [klineData, selectedOscillator, selectedOverlays, settings.indicatorConfig, chartColors]
  );

  if (loading) {
    return <Loading fullScreen text="加载中..." />;
  }

  if (!quote) {
    return (
      <div className={styles.notFound}>
        <p>未找到股票 {code}</p>
        <Button onClick={() => navigate(-1)}>返回</Button>
      </div>
    );
  }

  const outerCurrency = outerRow?.currency || 'USD';
  const fmtQuotePrice = (v: number | null | undefined) =>
    isOuter ? formatCurrencyPrice(v, outerCurrency) : formatPrice(v);
  const fmtQuoteAmount = (v: number | null | undefined) =>
    isOuter ? formatMarketValueByCurrency(v, outerCurrency) : formatAmount(v);
  const fmtQuoteCap = (v: number | null | undefined) =>
    isOuter ? formatMarketValueByCurrency(v, outerCurrency) : formatMarketCap(v);

  return (
    <div className={styles.detail}>
      <motion.header
        className={styles.header}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </button>

        <div className={styles.stockHeader}>
          <div className={styles.stockTitle}>
            <h1 className={styles.stockName}>{quote.name}</h1>
            <span className={styles.stockCode}>
              {isOuter ? `${OUTER_MARKET_BADGE[assetMarket]} · ${quote.code}` : quote.code}
            </span>
          </div>
          <div className={styles.priceSection}>
            <span className={`${styles.price} ${getChangeColorClass(quote.changePercent)}`}>
              {fmtQuotePrice(quote.price)}
            </span>
            <div className={styles.changeInfo}>
              <span className={getChangeColorClass(quote.changePercent)}>
                {formatChange(quote.change)}
              </span>
              <span className={getChangeColorClass(quote.changePercent)}>
                {formatPercent(quote.changePercent)}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <Button
            variant={inWatchlist ? 'primary' : 'secondary'}
            icon={inWatchlist ? <Star size={16} /> : <StarOff size={16} />}
            onClick={handleToggleWatchlist}
          >
            {inWatchlist ? '已自选' : '加自选'}
          </Button>
        </div>
      </motion.header>

      <Card padding="md">
        <div className={styles.quoteGrid}>
          <div className={styles.quoteItem}>
            <span className={styles.quoteLabel}>{isOuter ? '币种' : '今开'}</span>
            <span className={styles.quoteValue}>
              {isOuter ? outerCurrency : fmtQuotePrice(quote.open)}
            </span>
          </div>
          <div className={styles.quoteItem}>
            <span className={styles.quoteLabel}>昨收</span>
            <span className={styles.quoteValue}>{fmtQuotePrice(quote.prevClose)}</span>
          </div>
          <div className={styles.quoteItem}>
            <span className={styles.quoteLabel}>{isOuter ? '所属行业' : '最高'}</span>
            <span className={`${styles.quoteValue} ${isOuter ? '' : 'text-rise'}`}>
              {isOuter ? outerRow?.industry || outerRow?.sector || '--' : fmtQuotePrice(quote.high)}
            </span>
          </div>
          <div className={styles.quoteItem}>
            <span className={styles.quoteLabel}>{isOuter ? '交易所' : '最低'}</span>
            <span className={`${styles.quoteValue} ${isOuter ? '' : 'text-fall'}`}>
              {isOuter ? outerRow?.exchange || '--' : fmtQuotePrice(quote.low)}
            </span>
          </div>
          <div className={styles.quoteItem}>
            <span className={styles.quoteLabel}>成交量</span>
            <span className={styles.quoteValue}>{formatVolume(quote.volume)}</span>
          </div>
          <div className={styles.quoteItem}>
            <span className={styles.quoteLabel}>成交额</span>
            <span className={styles.quoteValue}>{fmtQuoteAmount(quote.amount)}</span>
          </div>
          {!isOuter && (
            <>
              <div className={styles.quoteItem}>
                <span className={styles.quoteLabel}>换手率</span>
                <span className={styles.quoteValue}>{formatTurnover(quote.turnoverRate)}</span>
              </div>
              <div className={styles.quoteItem}>
                <span className={styles.quoteLabel}>量比</span>
                <span className={styles.quoteValue}>{formatVolumeRatio(quote.volumeRatio)}</span>
              </div>
            </>
          )}
          <div className={styles.quoteItem}>
            <span className={styles.quoteLabel}>市盈率</span>
            <span className={styles.quoteValue}>{formatRatio(quote.pe)}</span>
          </div>
          {!isOuter && (
            <div className={styles.quoteItem}>
              <span className={styles.quoteLabel}>市净率</span>
              <span className={styles.quoteValue}>{formatRatio(quote.pb)}</span>
            </div>
          )}
          <div className={styles.quoteItem}>
            <span className={styles.quoteLabel}>总市值</span>
            <span className={styles.quoteValue}>{fmtQuoteCap(quote.totalMarketCap)}</span>
          </div>
          {!isOuter && (
            <div className={styles.quoteItem}>
              <span className={styles.quoteLabel}>流通市值</span>
              <span className={styles.quoteValue}>{fmtQuoteCap(quote.circulatingMarketCap)}</span>
            </div>
          )}
        </div>
      </Card>

      <div className={styles.mainGrid}>
        <div className={styles.chartSection}>
          <Card
            title="走势"
            extra={
              <Tabs
                items={MINUTE_PERIODS}
                activeKey={minutePeriod}
                onChange={setMinutePeriod}
                size="sm"
              />
            }
          >
            <div className={styles.chartContainer}>
              <LazyEChart option={timelineChartOption} style={{ height: '100%', width: '100%' }} notMerge />
            </div>
          </Card>

          <Card
            title="K线"
            extra={
              <div className={styles.klineControls}>
                <div className={styles.klineToolbarRow}>
                  <Tabs
                    items={KLINE_PERIODS}
                    activeKey={klinePeriod}
                    onChange={handleKlinePeriodChange}
                    size="sm"
                  />
                  <div className={styles.adjustTags} role="group" aria-label="K线复权方式">
                    {KLINE_ADJUST_OPTIONS.map((opt) => {
                      const isActive = klineAdjust === opt.key;
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          className={`${styles.indicatorTag} ${isActive ? styles.active : ''}`}
                          onClick={(e) => {
                            triggerClickRipple(e);
                            handleKlineAdjustChange(opt.key);
                          }}
                        >
                          {isActive && (
                            <motion.span
                              layoutId="stock-adjust-pill"
                              className={styles.indicatorTagBg}
                              transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                            />
                          )}
                          <span className={styles.indicatorTagLabel}>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className={styles.klineIndicatorPanel}>
                  <div className={styles.indicatorTags}>
                    {OVERLAY_OPTIONS.map((indicator) => (
                      <button
                        key={indicator.key}
                        className={`${styles.indicatorTag} ${selectedOverlays.includes(indicator.key) ? styles.active : ''}`}
                        onClick={() =>
                          setSelectedOverlays((prev) =>
                            prev.includes(indicator.key)
                              ? prev.filter((item) => item !== indicator.key)
                              : [...prev, indicator.key]
                          )
                        }
                      >
                        {indicator.label}
                      </button>
                    ))}
                  </div>
                  <div className={styles.oscillatorTags}>
                    {OSCILLATOR_OPTIONS.map((indicator) => {
                      const isActive = selectedOscillator === indicator.key;
                      return (
                        <button
                          key={indicator.key}
                          type="button"
                          className={`${styles.indicatorTag} ${isActive ? styles.active : ''}`}
                          onClick={(e) => {
                            triggerClickRipple(e);
                            setSelectedOscillator(indicator.key);
                          }}
                        >
                          {isActive && (
                            <motion.span
                              layoutId="stock-oscillator-pill"
                              className={styles.indicatorTagBg}
                              transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                            />
                          )}
                          <span className={styles.indicatorTagLabel}>{indicator.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            }
          >
            {klineAdjustNotice && (
              <div className={styles.adjustNotice}>{klineAdjustNotice}</div>
            )}
            <div className={styles.chartContainerLarge}>
              <LazyEChart option={klineChartOption} style={{ height: '100%', width: '100%' }} notMerge />
            </div>
          </Card>
        </div>

        <div className={styles.sideSection}>
          {isOuter ? (
            <>
              <Card title="全球个股信息">
                <div className={styles.historyList}>
                  <div className={styles.historyRow}>
                    <span className={styles.historyDate}>标的全称</span>
                    <span className={styles.historyPrimary}>{outerRow?.en_name || quote.name}</span>
                  </div>
                  <div className={styles.historyRow}>
                    <span className={styles.historyDate}>市场 / 交易所</span>
                    <span className={styles.historyPrimary}>
                      {OUTER_MARKET_BADGE[assetMarket]} · {outerRow?.exchange || '--'}
                    </span>
                  </div>
                  <div className={styles.historyRow}>
                    <span className={styles.historyDate}>交易币种</span>
                    <span className={styles.historyPrimary}>{outerCurrency}</span>
                  </div>
                  <div className={styles.historyRow}>
                    <span className={styles.historyDate}>所属行业</span>
                    <span className={styles.historyPrimary}>
                      {outerRow?.sector || '--'} / {outerRow?.industry || '--'}
                    </span>
                  </div>
                  <div className={styles.historyRow}>
                    <span className={styles.historyDate}>总市值</span>
                    <span className={styles.historyPrimary}>{fmtQuoteCap(quote.totalMarketCap)}</span>
                  </div>
                  <div className={styles.historyRow}>
                    <span className={styles.historyDate}>市盈率 PE(TTM)</span>
                    <span className={styles.historyPrimary}>{formatRatio(quote.pe)}</span>
                  </div>
                </div>
                {outerRow?.currency_note && (
                  <p className={styles.dividendEmpty} style={{ marginTop: 8 }}>
                    单位提示：{outerRow.currency_note}
                  </p>
                )}
              </Card>

              <Card title="技术指标状态摘要">
                {(() => {
                  const lastBar = klineData.at(-1) as Record<string, unknown> | undefined;
                  const prevBar = klineData.at(-6) as Record<string, unknown> | undefined;
                  const ma = (lastBar?.ma as Record<string, number | undefined> | undefined) ?? {};
                  const macd = (lastBar?.macd as Record<string, number | undefined> | undefined) ?? {};
                  const rsi = (lastBar?.rsi as Record<string, number | undefined> | undefined) ?? {};
                  const lastClose = typeof lastBar?.close === 'number' ? lastBar.close : null;
                  const prev5Close = typeof prevBar?.close === 'number' ? prevBar.close : null;
                  const pct5d =
                    lastClose && prev5Close && prev5Close > 0
                      ? ((lastClose - prev5Close) / prev5Close) * 100
                      : null;
                  return (
                    <div className={styles.historyList}>
                      <div className={styles.historyRow}>
                        <span className={styles.historyDate}>近 5 日表现</span>
                        <span className={`${styles.historyPrimary} ${getChangeColorClass(pct5d)}`}>
                          {pct5d !== null ? formatPercent(pct5d) : '--'}
                        </span>
                      </div>
                      <div className={styles.historyRow}>
                        <span className={styles.historyDate}>MA5 / MA10 / MA20</span>
                        <span className={styles.historyPrimary}>
                          {ma.ma5?.toFixed(2) ?? '--'} / {ma.ma10?.toFixed(2) ?? '--'} /{' '}
                          {ma.ma20?.toFixed(2) ?? '--'}
                        </span>
                      </div>
                      <div className={styles.historyRow}>
                        <span className={styles.historyDate}>MACD (DIF / DEA)</span>
                        <span className={styles.historyPrimary}>
                          {macd.dif?.toFixed(2) ?? '--'} / {macd.dea?.toFixed(2) ?? '--'}
                        </span>
                      </div>
                      <div className={styles.historyRow}>
                        <span className={styles.historyDate}>RSI (6 / 12)</span>
                        <span className={styles.historyPrimary}>
                          {rsi.rsi6?.toFixed(1) ?? '--'} / {rsi.rsi12?.toFixed(1) ?? '--'}
                        </span>
                      </div>
                      <div className={styles.historyRow}>
                        <span className={styles.historyDate}>适用范围</span>
                        <span className={styles.historyMeta}>仅研究参考 · 不适用 A 股五档/资金流</span>
                      </div>
                    </div>
                  );
                })()}
              </Card>
            </>
          ) : (
            <>
              <Card title="五档盘口">
                <div className={styles.orderBook}>
                  <div className={styles.askSide}>
                    {[...Array(5)].map((_, index) => {
                      const ask = quote.ask?.[4 - index];
                      return (
                        <div key={`ask-${index}`} className={styles.orderRow}>
                          <span className={styles.orderLabel}>卖{5 - index}</span>
                          <span className={`${styles.orderPrice} text-fall`}>
                            {formatPrice(ask?.price)}
                          </span>
                          <span className={styles.orderVolume}>{ask?.volume ?? '--'}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className={styles.bidSide}>
                    {quote.bid?.slice(0, 5).map((bid, index) => (
                      <div key={`bid-${index}`} className={styles.orderRow}>
                        <span className={styles.orderLabel}>买{index + 1}</span>
                        <span className={`${styles.orderPrice} text-rise`}>
                          {formatPrice(bid?.price)}
                        </span>
                        <span className={styles.orderVolume}>{bid?.volume ?? '--'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              {(fundFlow || individualFundFlowHistory.length > 0) && (() => {
                const latestHist = individualFundFlowHistory.at(-1);
                const effectiveFlow = fundFlow ?? {
                  mainNet:
                    latestHist?.mainNetInflow !== null && latestHist?.mainNetInflow !== undefined
                      ? latestHist.mainNetInflow / 1e4
                      : null,
                  mainNetRatio: latestHist?.mainNetInflowPercent ?? null,
                  retailNet:
                    latestHist?.smallNetInflow !== null && latestHist?.smallNetInflow !== undefined
                      ? latestHist.smallNetInflow / 1e4
                      : null,
                };
                return (
                  <Card title="个股资金流">
                    <div className={styles.fundFlow}>
                      <div className={styles.fundItem}>
                        <span className={styles.fundLabel}>主力净流入</span>
                        <span className={`${styles.fundValue} ${getChangeColorClass(effectiveFlow.mainNet)}`}>
                          {formatAmount(effectiveFlow.mainNet)}
                        </span>
                      </div>
                      <div className={styles.fundItem}>
                        <span className={styles.fundLabel}>主力净占比</span>
                        <span
                          className={`${styles.fundValue} ${getChangeColorClass(
                            effectiveFlow.mainNetRatio
                          )}`}
                        >
                          {formatPercent(effectiveFlow.mainNetRatio)}
                        </span>
                      </div>
                      <div className={styles.fundItem}>
                        <span className={styles.fundLabel}>散户净流入</span>
                        <span className={`${styles.fundValue} ${getChangeColorClass(effectiveFlow.retailNet)}`}>
                          {formatAmount(effectiveFlow.retailNet)}
                        </span>
                      </div>
                    </div>

                    {individualFundFlowHistory.length > 0 && (
                      <div className={styles.historySection}>
                        <div className={styles.historySectionHeader}>近 8 日主力资金</div>
                        <div className={styles.historyList}>
                          {[...individualFundFlowHistory].reverse().map((item) => (
                            <div key={item.date} className={styles.historyRow}>
                              <span className={styles.historyDate}>{formatMaybeDate(item.date)}</span>
                              <div className={styles.historyValueGroup}>
                                <span
                                  className={`${styles.historyPrimary} ${getChangeColorClass(
                                    item.mainNetInflow
                                  )}`}
                                >
                                  {formatYuanAmount(item.mainNetInflow)}
                                </span>
                                <span className={styles.historyMeta}>
                                  {formatPercent(item.mainNetInflowPercent)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })()}

              {largeOrder && (() => {
                const ratios = normalizeLargeOrderRatios(largeOrder);
                if (!ratios.hasData) return null;
                return (
                  <Card title="大单结构">
                    <div className={styles.largeOrder}>
                      <div className={styles.orderBar}>
                        <div className={styles.buyLarge} style={{ width: `${ratios.buyLargePct}%` }} />
                        <div className={styles.buySmall} style={{ width: `${ratios.buySmallPct}%` }} />
                        <div className={styles.sellSmall} style={{ width: `${ratios.sellSmallPct}%` }} />
                        <div className={styles.sellLarge} style={{ width: `${ratios.sellLargePct}%` }} />
                      </div>
                      <div className={styles.orderLegend}>
                        <span className={styles.legendItem}>
                          <i className={styles.buyLargeDot} />
                          大买 {ratios.buyLargePct.toFixed(1)}%
                        </span>
                        <span className={styles.legendItem}>
                          <i className={styles.buySmallDot} />
                          小买 {ratios.buySmallPct.toFixed(1)}%
                        </span>
                        <span className={styles.legendItem}>
                          <i className={styles.sellSmallDot} />
                          小卖 {ratios.sellSmallPct.toFixed(1)}%
                        </span>
                        <span className={styles.legendItem}>
                          <i className={styles.sellLargeDot} />
                          大卖 {ratios.sellLargePct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </Card>
                );
              })()}
            </>
          )}

          <Card title="本地告警">
            <div className={styles.alertEditor}>
              <div className={styles.alertInputs}>
                <select
                  className={styles.alertSelect}
                  value={alertType}
                  onChange={(event) => setAlertType(event.target.value as AlertType)}
                >
                  {ALERT_TYPE_OPTIONS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <input
                  className={styles.alertInput}
                  value={alertValue}
                  onChange={(event) => setAlertValue(event.target.value)}
                  type="number"
                  step="0.01"
                />
              </div>
              <Button variant="secondary" icon={<Bell size={14} />} onClick={handleAddAlert}>
                新增告警
              </Button>
            </div>

            {alerts.length === 0 ? (
              <div className={styles.dividendEmpty}>当前股票暂无本地告警</div>
            ) : (
              <div className={styles.alertList}>
                {alerts.map((rule) => (
                  <div key={rule.id} className={styles.alertItem}>
                    <div className={styles.alertInfo}>
                      <span className={styles.alertLabel}>
                        {ALERT_TYPE_OPTIONS.find((item) => item.key === rule.type)?.label}
                        {rule.value}
                      </span>
                      <span className={styles.alertMeta}>冷却 {rule.cooldownSec}s</span>
                    </div>
                    <button
                      className={styles.alertDelete}
                      onClick={() => handleDeleteAlert(rule.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {isOuter ? (
        <Card title="研究边界说明（全球市场只研模式）">
          <div className={styles.dividendEmpty}>
            A 股专属资金流、龙虎榜、北向持仓及中企会计准则 30 条财报排雷不适用于外围标的；上方已启用全球即时报价、分时走势与 MA/MACD/KDJ/RSI/BOLL 全套技术指标分析。
          </div>
        </Card>
      ) : (
        <div className={styles.lowerGrid}>
          <div className={styles.lowerMain}>
            {code && <StockExpertEvidenceCard stockCode={code} />}
            {code && <StockMinesweeperPanel stockCode={code} />}
          </div>

          <div className={styles.lowerSide}>
            <Card title="北向持仓">
              {latestNorthboundHolding ? (
                <div className={styles.historySection}>
                  <div className={styles.historyList}>
                    <div className={styles.historyRow}>
                      <span className={styles.historyDate}>最新持仓市值</span>
                      <div className={styles.historyValueGroup}>
                        <span className={styles.historyPrimary}>
                          {formatYuanAmount(latestNorthboundHolding.holdMarketValue)}
                        </span>
                        <span className={styles.historyMeta}>
                          {formatMaybeDate(latestNorthboundHolding.date)}
                        </span>
                      </div>
                    </div>
                    <div className={styles.historyRow}>
                      <span className={styles.historyDate}>持股 / 流通占比</span>
                      <div className={styles.historyValueGroup}>
                        <span className={styles.historyPrimary}>
                          {formatCompactNumber(latestNorthboundHolding.holdShares)} 股
                        </span>
                        <span className={styles.historyMeta}>
                          {formatPercent(latestNorthboundHolding.holdRatioFloat, false)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.historySectionHeader}>近 8 日持仓变化</div>
                  <div className={styles.historyList}>
                    {[...northboundHoldings].reverse().map((item) => (
                      <div key={item.date} className={styles.historyRow}>
                        <span className={styles.historyDate}>{formatMaybeDate(item.date)}</span>
                        <div className={styles.historyValueGroup}>
                          <span className={styles.historyPrimary}>
                            {formatYuanAmount(item.holdMarketValue)}
                          </span>
                          <span
                            className={`${styles.historyMeta} ${getChangeColorClass(
                              item.changePercent
                            )}`}
                          >
                            {formatPercent(item.changePercent)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={styles.dividendEmpty}>当前股票暂无北向持仓样本</div>
              )}
            </Card>

            <Card title="分红 / 除权">
              {dividends.length === 0 ? (
                <div className={styles.dividendEmpty}>暂无可展示的分红数据</div>
              ) : (
                <div className={styles.dividendList}>
                  {dividends.map((item, index) => (
                    <div key={`${item.reportDate ?? 'unknown'}-${index}`} className={styles.dividendItem}>
                      <div className={styles.dividendHeader}>
                        <span className={styles.dividendReport}>{formatMaybeDate(item.reportDate)}</span>
                        <span className={styles.dividendProgress}>{item.assignProgress || '待披露'}</span>
                      </div>
                      <div className={styles.dividendDesc}>{item.dividendDesc || '暂无派息说明'}</div>
                      <div className={styles.dividendMeta}>
                        <span>股息率 {formatYield(item.dividendYield)}</span>
                        <span>除权 {formatMaybeDate(item.exDividendDate)}</span>
                      </div>
                      <div className={styles.dividendMeta}>
                        <span>公告 {formatMaybeDate(item.noticeDate)}</span>
                        <span>发放 {formatMaybeDate(item.payDate)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
