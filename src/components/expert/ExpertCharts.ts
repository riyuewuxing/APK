import {
  buildAxisPointerLabel,
  buildCrosshairAxisPointer,
  buildCrosshairGlobalAxisPointer,
  type ChartColors,
} from '@/components/charts/chartTheme';
import {
  CLUSTER_LABELS_ZH,
  type BacktestSummaryViewModel,
  type ClusterVoteSummary,
  type KlineBarPoint,
  type KlineMarkerPoint,
  type PortfolioCorrelationSummary,
  type QuantStatsSummary,
} from '@/services/expertApi';
import type { SectorExposureRow, UnderlyingExposureRow } from '@/services/xrayApi';

function calcSma(closes: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  let rolling = 0;
  for (let i = 0; i < closes.length; i += 1) {
    rolling += closes[i];
    if (i >= period) rolling -= closes[i - period];
    out.push(i >= period - 1 ? Number((rolling / period).toFixed(3)) : null);
  }
  return out;
}

export function buildOrthogonalClustersChartOption(
  votes: ClusterVoteSummary[],
  colors: ChartColors
) {
  const ordered = [...votes].reverse();
  const labels = ordered.map((v) => {
    const zh = CLUSTER_LABELS_ZH[v.cluster] ?? v.cluster;
    return v.collinearity_suppressed_count > 0
      ? `${zh} (抑制${v.collinearity_suppressed_count})`
      : zh;
  });
  const values = ordered.map((v) => ({
    value: Number(v.deduped_score.toFixed(1)),
    itemStyle: {
      color:
        v.deduped_score > 0
          ? colors.rise
          : v.deduped_score < 0
            ? colors.fall
            : colors.flat,
      borderRadius: v.deduped_score >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
    },
    rawCount: v.raw_indicator_count,
    suppressed: v.collinearity_suppressed_count,
    summary: v.primary_evidence_summary,
    hasRedFlag: v.has_red_flag,
  }));

  return {
    animation: false,
    grid: { left: 185, right: 28, top: 14, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: colors.bgElevated,
      borderColor: colors.borderPrimary,
      textStyle: { color: colors.textPrimary, fontSize: 13.5 },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0] as
          | {
            name?: string;
            value?: number;
            data?: {
              rawCount?: number;
              suppressed?: number;
              summary?: string;
              hasRedFlag?: boolean;
            };
          }
          | undefined;
        if (!first?.data) return '';
        const d = first.data;
        return [
          `<strong>${first.name ?? ''}</strong>`,
          `去重独立得分: <b>${first.value ?? 0}</b> / ±100`,
          `原始指标 ${d.rawCount ?? 0} 个 · 共线抑制 ${d.suppressed ?? 0} 个${d.hasRedFlag ? ' · <span style="color:#ef4444">含红旗</span>' : ''}`,
          `<span style="color:${colors.textTertiary}">${d.summary ?? ''}</span>`,
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'value',
      min: -100,
      max: 100,
      splitNumber: 4,
      axisLabel: { color: colors.textTertiary, fontSize: 12.5 },
      splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: colors.borderPrimary } },
      axisLabel: { color: colors.textPrimary, fontSize: 13 },
    },
    series: [
      {
        name: '正交簇净得分',
        type: 'bar',
        barWidth: 18,
        data: values,
      },
    ],
  };
}

export function buildExpertKlineChartOption(
  bars: KlineBarPoint[],
  markers: KlineMarkerPoint[],
  subjectTitle: string,
  colors: ChartColors
) {
  if (!bars.length) return {};
  const dates = bars.map((b) => b.time);
  const zoomStart = bars.length > 40 ? 30 : 0;
  const ohlc = bars.map((b) => [b.open, b.close, b.low, b.high]);
  const closes = bars.map((b) => b.close);
  const ma5 = calcSma(closes, 5);
  const ma20 = calcSma(closes, 20);
  const ma60 = calcSma(closes, 60);
  const volumes = bars.map((b) => ({
    value: b.volume,
    itemStyle: { color: b.close >= b.open ? colors.rise : colors.fall },
  }));

  const markPointData = markers.map((m) => {
    const idx = dates.indexOf(m.time);
    const bar = idx >= 0 ? bars[idx] : undefined;
    const isBuy = m.text === 'B';
    const yCoord = bar ? (isBuy ? bar.low * 0.992 : bar.high * 1.008) : 0;
    return {
      name: isBuy ? '买点示例' : '卖点示例',
      coord: [m.time, yCoord],
      value: m.text,
      itemStyle: { color: isBuy ? colors.rise : colors.fall },
      symbolSize: 30,
    };
  });

  return {
    animation: false,
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
    legend: {
      top: 0,
      left: 8,
      textStyle: { color: colors.textTertiary, fontSize: 13 },
      data: [subjectTitle, 'MA5', 'MA20', 'MA60'],
    },
    axisPointer: buildCrosshairGlobalAxisPointer(colors),
    grid: [
      { left: 64, right: 24, top: 38, height: '57%' },
      { left: 64, right: 24, top: '72%', height: '16%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: dates,
        boundaryGap: true,
        axisLine: { lineStyle: { color: colors.borderPrimary } },
        axisLabel: { show: false },
        axisPointer: { show: true, label: { show: false } },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: dates,
        boundaryGap: true,
        axisLine: { lineStyle: { color: colors.borderPrimary } },
        axisLabel: { color: colors.textTertiary, fontSize: 12 },
        axisPointer: buildAxisPointerLabel(colors),
      },
    ],
    yAxis: [
      {
        scale: true,
        axisLabel: { color: colors.textTertiary, fontSize: 12 },
        axisPointer: buildAxisPointerLabel(colors, (p) => Number(p.value).toFixed(2)),
        splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
      },
      {
        scale: true,
        gridIndex: 1,
        splitNumber: 2,
        axisLabel: { show: false },
        axisPointer: { show: false },
        axisLine: { show: false },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: zoomStart, end: 100 },
      {
        type: 'slider',
        xAxisIndex: [0, 1],
        start: zoomStart,
        end: 100,
        top: '91%',
        height: 18,
        borderColor: colors.borderPrimary,
        textStyle: { color: colors.textTertiary, fontSize: 12 },
      },
    ],
    series: [
      {
        name: subjectTitle,
        type: 'candlestick',
        data: ohlc,
        itemStyle: {
          color: colors.rise,
          color0: colors.fall,
          borderColor: colors.rise,
          borderColor0: colors.fall,
        },
        markPoint: markPointData.length
          ? {
            data: markPointData,
            label: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
          }
          : undefined,
      },
      {
        name: 'MA5',
        type: 'line',
        data: ma5,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.2, color: '#f59e0b' },
      },
      {
        name: 'MA20',
        type: 'line',
        data: ma20,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.4, color: '#ec4899' },
      },
      {
        name: 'MA60',
        type: 'line',
        data: ma60,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.4, color: '#8b5cf6' },
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes,
      },
    ],
  };
}

export function buildCorrelationHeatmapOption(
  corr: PortfolioCorrelationSummary,
  colors: ChartColors
) {
  const symbols = corr.symbols ?? [];
  const names = corr.names ?? {};
  const matrix = corr.correlation_matrix ?? {};
  if (!symbols.length) return {};

  const labels = symbols.map((s) => (names[s] ? `${names[s]}(${s})` : s));
  const data: Array<[number, number, number]> = [];
  for (let i = 0; i < symbols.length; i += 1) {
    for (let j = 0; j < symbols.length; j += 1) {
      const val = matrix[symbols[i]]?.[symbols[j]] ?? 0;
      data.push([j, i, Number(val.toFixed(2))]);
    }
  }

  return {
    animation: false,
    tooltip: {
      position: 'top',
      backgroundColor: colors.bgElevated,
      borderColor: colors.borderPrimary,
      textStyle: { color: colors.textPrimary, fontSize: 13.5 },
      formatter: (params: unknown) => {
        const p = params as { value?: [number, number, number] };
        if (!p.value) return '';
        const [xIdx, yIdx, val] = p.value;
        return `${labels[yIdx]} × ${labels[xIdx]}<br/>相关系数: <b>${val.toFixed(2)}</b>`;
      },
    },
    grid: { left: 136, right: 24, top: 16, bottom: 68 },
    xAxis: {
      type: 'category',
      data: symbols,
      axisLabel: { color: colors.textTertiary, fontSize: 12, rotate: 25 },
      splitArea: { show: true },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: colors.textTertiary, fontSize: 12 },
      splitArea: { show: true },
    },
    visualMap: {
      min: -0.5,
      max: 1.0,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 2,
      itemWidth: 12,
      itemHeight: 130,
      textStyle: { color: colors.textTertiary, fontSize: 12 },
      inRange: {
        color: ['#10b981', '#27272a', '#ef4444'],
      },
    },
    series: [
      {
        name: '相关性',
        type: 'heatmap',
        data,
        label: {
          show: symbols.length <= 8,
          color: '#fafafa',
          fontSize: 12,
          formatter: (params: unknown) => {
            const p = params as { value?: [number, number, number] };
            return p.value ? p.value[2].toFixed(2) : '';
          },
        },
      },
    ],
  };
}

export function buildBacktestUnderwaterChartOption(
  backtest: BacktestSummaryViewModel | null,
  colors: ChartColors
) {
  if (!backtest || !backtest.underwater_dates.length) return {};
  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: buildCrosshairAxisPointer(colors),
      backgroundColor: colors.tooltipBg,
      borderColor: colors.borderPrimary,
      borderWidth: 1,
      textStyle: { color: colors.textPrimary, fontSize: 13.5 },
      extraCssText:
        'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 8px; box-shadow: 0 10px 26px rgba(0,0,0,0.32);',
      valueFormatter: (val: unknown) => `${Number(val).toFixed(2)}%`,
    },
    grid: { left: 60, right: 24, top: 26, bottom: 32 },
    xAxis: {
      type: 'category',
      data: backtest.underwater_dates,
      axisLabel: { color: colors.textTertiary, fontSize: 12 },
      axisPointer: buildAxisPointerLabel(colors),
      axisLine: { lineStyle: { color: colors.borderPrimary } },
    },
    yAxis: {
      type: 'value',
      max: 0,
      axisLabel: {
        color: colors.textTertiary,
        fontSize: 12,
        formatter: (v: number) => `${v}%`,
      },
      axisPointer: buildAxisPointerLabel(colors, (p) => `${Number(p.value).toFixed(2)}%`),
      splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
    },
    series: [
      {
        name: '水下回撤 (%)',
        type: 'line',
        data: backtest.underwater_drawdowns_pct,
        symbol: 'none',
        lineStyle: { width: 1.5, color: '#ef4444' },
        areaStyle: { color: 'rgba(239, 68, 68, 0.22)' },
      },
    ],
  };
}

export function buildQuantStatsEquityChartOption(
  qs: QuantStatsSummary | null,
  colors: ChartColors
) {
  if (!qs || !qs.series.dates.length) return {};
  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: buildCrosshairAxisPointer(colors),
      backgroundColor: colors.tooltipBg,
      borderColor: colors.borderPrimary,
      borderWidth: 1,
      textStyle: { color: colors.textPrimary, fontSize: 13.5 },
      extraCssText:
        'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 8px; box-shadow: 0 10px 26px rgba(0,0,0,0.32);',
    },
    axisPointer: buildCrosshairGlobalAxisPointer(colors),
    legend: {
      top: 0,
      textStyle: { color: colors.textTertiary, fontSize: 13 },
      data: ['组合累计收益 (%)', `${qs.benchmark_label} (%)`, '组合水下回撤 (%)'],
    },
    grid: [
      { left: 62, right: 24, top: 38, height: '47%' },
      { left: 62, right: 24, top: '66%', height: '24%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: qs.series.dates,
        axisLabel: { show: false },
        axisPointer: { show: true, label: { show: false } },
        axisLine: { lineStyle: { color: colors.borderPrimary } },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: qs.series.dates,
        axisLabel: { color: colors.textTertiary, fontSize: 12 },
        axisPointer: buildAxisPointerLabel(colors),
        axisLine: { lineStyle: { color: colors.borderPrimary } },
      },
    ],
    yAxis: [
      {
        type: 'value',
        axisLabel: { color: colors.textTertiary, fontSize: 12, formatter: '{value}%' },
        axisPointer: buildAxisPointerLabel(colors, (p) => `${Number(p.value).toFixed(2)}%`),
        splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
      },
      {
        type: 'value',
        gridIndex: 1,
        max: 0,
        axisLabel: { color: colors.textTertiary, fontSize: 12, formatter: '{value}%' },
        splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
      },
    ],
    series: [
      {
        name: '组合累计收益 (%)',
        type: 'line',
        data: qs.series.strategy_cum_pct,
        symbol: 'none',
        lineStyle: { width: 2, color: colors.accent },
      },
      {
        name: `${qs.benchmark_label} (%)`,
        type: 'line',
        data: qs.series.benchmark_cum_pct,
        symbol: 'none',
        lineStyle: { width: 1.4, color: colors.textTertiary, type: 'dashed' },
      },
      {
        name: '组合水下回撤 (%)',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: qs.series.drawdown_pct,
        symbol: 'none',
        lineStyle: { width: 1.4, color: '#ef4444' },
        areaStyle: { color: 'rgba(239, 68, 68, 0.2)' },
      },
    ],
  };
}

export function buildXRayTopHoldingsChartOption(
  rows: UnderlyingExposureRow[],
  colors: ChartColors
) {
  const sliced = rows.slice(0, 15).reverse();
  if (!sliced.length) return {};

  const labels = sliced.map((r) => r.name || r.symbol);
  const directData = sliced.map((r) => Number(r.direct_weight_pct.toFixed(2)));
  const indirectData = sliced.map((r) => Number(r.indirect_weight_pct.toFixed(2)));

  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
      backgroundColor: colors.bgElevated,
      borderColor: colors.borderPrimary,
      textStyle: { color: colors.textPrimary, fontSize: 12.5 },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0] as { dataIndex?: number } | undefined;
        const idx = first?.dataIndex ?? -1;
        const row = sliced[idx];
        if (!row) return '';
        return [
          `<b>${row.name}</b> (${row.symbol}) · ${row.sector}`,
          `合并净暴露：<b>${row.total_weight_pct.toFixed(2)}%</b>（直持 ${row.direct_weight_pct.toFixed(2)}% / 穿透 ${row.indirect_weight_pct.toFixed(2)}%）`,
          row.breakdown_text,
        ].join('<br/>');
      },
    },
    legend: {
      top: 0,
      textStyle: { color: colors.textTertiary, fontSize: 12 },
      data: ['直持权重 (%)', '基金/ETF穿透 (%)'],
    },
    grid: { left: 92, right: 20, top: 32, bottom: 24 },
    xAxis: {
      type: 'value',
      axisLabel: { color: colors.textTertiary, fontSize: 11.5, formatter: '{value}%' },
      splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        color: colors.textPrimary,
        fontSize: 12,
        width: 82,
        overflow: 'truncate',
      },
    },
    series: [
      {
        name: '直持权重 (%)',
        type: 'bar',
        stack: 'xray',
        barMaxWidth: 16,
        itemStyle: { color: colors.accent },
        data: directData,
      },
      {
        name: '基金/ETF穿透 (%)',
        type: 'bar',
        stack: 'xray',
        barMaxWidth: 16,
        itemStyle: { color: '#f59e0b' },
        data: indirectData,
      },
    ],
  };
}

export function buildXRaySectorChartOption(
  sectors: SectorExposureRow[],
  colors: ChartColors
) {
  const sliced = sectors.slice(0, 10).reverse();
  if (!sliced.length) return {};

  const labels = sliced.map((s) => s.sector);
  const directData = sliced.map((s) => Number(s.direct_weight_pct.toFixed(2)));
  const indirectData = sliced.map((s) => Number(s.indirect_weight_pct.toFixed(2)));

  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
      backgroundColor: colors.bgElevated,
      borderColor: colors.borderPrimary,
      textStyle: { color: colors.textPrimary, fontSize: 12.5 },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0] as { dataIndex?: number } | undefined;
        const idx = first?.dataIndex ?? -1;
        const sec = sliced[idx];
        if (!sec) return '';
        const topDesc = sec.top_symbols.length ? `<br/>主要标的：${sec.top_symbols.join('、')}` : '';
        return (
          `<b>${sec.sector}</b>（${sec.underlying_count} 只底层标的）<br/>` +
          `已披露暴露：<b>${sec.total_weight_pct.toFixed(2)}%</b>` +
          `（直持 ${sec.direct_weight_pct.toFixed(2)}% / 穿透 ${sec.indirect_weight_pct.toFixed(2)}%）` +
          topDesc
        );
      },
    },
    legend: {
      top: 0,
      textStyle: { color: colors.textTertiary, fontSize: 12 },
      data: ['直持行业 (%)', '基金穿透 (%)'],
    },
    grid: { left: 92, right: 20, top: 32, bottom: 24 },
    xAxis: {
      type: 'value',
      axisLabel: { color: colors.textTertiary, fontSize: 11.5, formatter: '{value}%' },
      splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        color: colors.textPrimary,
        fontSize: 12,
        width: 82,
        overflow: 'truncate',
      },
    },
    series: [
      {
        name: '直持行业 (%)',
        type: 'bar',
        stack: 'sector',
        barMaxWidth: 16,
        itemStyle: { color: colors.accent },
        data: directData,
      },
      {
        name: '基金穿透 (%)',
        type: 'bar',
        stack: 'sector',
        barMaxWidth: 16,
        itemStyle: { color: '#14b8a6' },
        data: indirectData,
      },
    ],
  };
}

