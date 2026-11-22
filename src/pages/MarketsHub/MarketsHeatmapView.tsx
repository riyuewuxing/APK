import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import { LazyEChart } from '@/components/charts/LazyEChart';
import { getChartColors, withAlpha } from '@/components/charts/chartTheme';
import { Card, Empty, Tabs } from '@/components/common';
import { useAppSettings } from '@/contexts';
import { useTheme } from '@/hooks';
import type { GlobalMarketOverviewResponse } from '@/services/globalMarketsApi';
import { formatMarketValueByCurrency, formatPercent } from '@/utils/format';
import styles from './MarketsHub.module.css';

interface MarketsHeatmapViewProps {
  overview: GlobalMarketOverviewResponse;
  onSelectSector?: (sectorKey: string) => void;
}

type HeatmapMode = 'nested' | 'sector';
type SizeMetric = 'market_cap' | 'amount';

export function MarketsHeatmapView({ overview, onSelectSector }: MarketsHeatmapViewProps) {
  const navigate = useNavigate();
  const { theme, preset } = useTheme();
  const { settings } = useAppSettings();
  const colors = useMemo(
    () => getChartColors(theme, settings.colorMode, preset),
    [theme, settings.colorMode, preset]
  );
  // 外围市场默认展示「纯行业板块图」，避免双层顶栏遮挡与层级合并错乱
  const [mode, setMode] = useState<HeatmapMode>('sector');
  const [sizeMetric, setSizeMetric] = useState<SizeMetric>('market_cap');

  const option = useMemo<EChartsOption>(() => {
    // 雅致宝石收敛色阶：低波动柔和，强趋势渐深而不刺眼
    const minAlpha = theme === 'light' ? 0.54 : 0.36;
    const maxAlpha = theme === 'light' ? 0.94 : 0.9;
    const colorForPct = (pct: number) => {
      if (Math.abs(pct) < 0.005) return withAlpha(colors.flat, theme === 'light' ? 0.45 : 0.55);
      const intensity = Math.min(Math.abs(pct) / 5.5, 1);
      const alpha = minAlpha + intensity * (maxAlpha - minAlpha);
      return withAlpha(pct > 0 ? colors.rise : colors.fall, alpha);
    };

    const tooltipGlassStyle = {
      backgroundColor: colors.tooltipBg,
      borderColor: colors.borderPrimary,
      borderWidth: 1,
      padding: [10, 14] as [number, number],
      textStyle: { color: colors.textPrimary, fontSize: 12 },
      extraCssText:
        'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 10px 28px rgba(0,0,0,0.32); border-radius: 8px;',
    };

    const richLabel = {
      name: {
        fontSize: 13,
        lineHeight: 18,
        color: '#ffffff',
        fontWeight: 700,
        textShadowColor: 'rgba(0,0,0,0.62)',
        textShadowBlur: 4,
      },
      change: {
        fontSize: 12,
        lineHeight: 16,
        color: 'rgba(255,255,255,0.95)',
        fontWeight: 600,
        padding: [1, 0, 0, 0],
        textShadowColor: 'rgba(0,0,0,0.6)',
        textShadowBlur: 3,
      },
      meta: {
        fontSize: 10.5,
        lineHeight: 14,
        color: 'rgba(255,255,255,0.78)',
        padding: [2, 0, 0, 0],
        textShadowColor: 'rgba(0,0,0,0.55)',
        textShadowBlur: 3,
      },
    };

    if (mode === 'sector') {
      const data = overview.sectors.slice(0, 30).map((sec) => {
        const sizeVal =
          sizeMetric === 'amount'
            ? sec.total_amount || sec.constituent_count
            : sec.total_market_cap || sec.constituent_count;
        return {
          name: sec.name,
          value: [
            Math.max(1, sizeVal),
            sec.change_pct,
            sec.constituent_count,
            sec.rise_count,
            sec.fall_count,
          ],
          sectorKey: sec.board_code,
          leadingName: sec.leading_stock_name,
          leadingPct: sec.leading_stock_pct,
          itemStyle: { color: colorForPct(sec.change_pct) },
        };
      });
      return {
        backgroundColor: 'transparent',
        tooltip: {
          ...tooltipGlassStyle,
          formatter: (params: unknown) => {
            const p = params as {
              name: string;
              data?: {
                value?: number[];
                leadingName?: string;
                leadingPct?: number;
              };
            };
            const valSize = p.data?.value?.[0] ?? 0;
            const chg = p.data?.value?.[1] ?? 0;
            const cnt = p.data?.value?.[2] ?? 0;
            const riseCnt = p.data?.value?.[3] ?? 0;
            const fallCnt = p.data?.value?.[4] ?? 0;
            const totalBreadth = Math.max(1, riseCnt + fallCnt);
            const riseRatio = Math.round((riseCnt / totalBreadth) * 100);
            const chgColor = chg > 0 ? colors.rise : chg < 0 ? colors.fall : colors.flat;
            const sizeLabel = sizeMetric === 'amount' ? '板块成交额' : '板块总市值';

            let html = `<div style="font-weight:700;font-size:13px;margin-bottom:6px;color:${colors.textPrimary}">${p.name}</div>`;
            html += `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:${colors.textTertiary}">板块涨跌</span><span style="color:${chgColor};font-weight:700">${formatPercent(chg)}</span></div>`;
            html += `<div style="display:flex;justify-content:space-between;gap:18px;margin-top:2px"><span style="color:${colors.textTertiary}">${sizeLabel}</span><span>${formatMarketValueByCurrency(valSize, overview.currency)}</span></div>`;
            if (p.data?.leadingName) {
              const lp = p.data.leadingPct ?? 0;
              const lpColor = lp > 0 ? colors.rise : lp < 0 ? colors.fall : colors.flat;
              html += `<div style="display:flex;justify-content:space-between;gap:18px;margin-top:4px;padding-top:5px;border-top:1px solid ${colors.borderPrimary}"><span style="color:${colors.textTertiary}">领涨代表</span><span>${p.data.leadingName} <b style="color:${lpColor}">${formatPercent(lp)}</b></span></div>`;
            }
            html += `<div style="margin-top:6px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:${colors.rise}">涨 ${riseCnt}</span><span style="color:${colors.textTertiary}">成分 ${cnt} 家</span><span style="color:${colors.fall}">跌 ${fallCnt}</span></div>`;
            html += `<div style="display:flex;height:4px;border-radius:3px;overflow:hidden;background:${colors.borderSecondary}"><span style="width:${riseRatio}%;background:${colors.rise}"></span><span style="width:${100 - riseRatio}%;background:${colors.fall}"></span></div></div>`;
            return html;
          },
        },
        series: [
          {
            type: 'treemap',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            upperLabel: { show: false },
            label: {
              show: true,
              position: 'inside',
              overflow: 'truncate',
              formatter: (params: unknown) => {
                const p = params as {
                  name: string;
                  data?: { value?: number[]; leadingName?: string };
                };
                const pctStr = formatPercent(p.data?.value?.[1] ?? 0);
                const cnt = p.data?.value?.[2] ?? 0;
                const metaStr = p.data?.leadingName
                  ? `${p.data.leadingName} · ${cnt}家`
                  : `${cnt}家`;
                return `{name|${p.name}}\n{change|${pctStr}}\n{meta|${metaStr}}`;
              },
              rich: richLabel,
            },
            itemStyle: {
              borderColor: colors.bgCard,
              borderWidth: 1.5,
              gapWidth: 2,
              borderRadius: 4,
            },
            levels: [
              {
                upperLabel: { show: false },
                itemStyle: {
                  borderColor: colors.bgCard,
                  borderWidth: 0,
                  gapWidth: 2,
                },
              },
              {
                upperLabel: { show: false },
                label: {
                  show: true,
                  position: 'inside',
                  overflow: 'truncate',
                  formatter: (params: unknown) => {
                    const p = params as {
                      name: string;
                      data?: { value?: number[]; leadingName?: string };
                    };
                    const pctStr = formatPercent(p.data?.value?.[1] ?? 0);
                    const cnt = p.data?.value?.[2] ?? 0;
                    const metaStr = p.data?.leadingName
                      ? `${p.data.leadingName} · ${cnt}家`
                      : `${cnt}家`;
                    return `{name|${p.name}}\n{change|${pctStr}}\n{meta|${metaStr}}`;
                  },
                  rich: richLabel,
                },
                itemStyle: {
                  borderColor: colors.bgCard,
                  borderWidth: 1.5,
                  gapWidth: 2,
                  borderRadius: 4,
                },
              },
            ],
            emphasis: {
              itemStyle: {
                borderColor: colors.accent,
                borderWidth: 2,
              },
              label: { show: true },
            },
            data,
          },
        ],
      };
    }

    const sectorPctMap = new Map<string, { chg: number; key: string }>();
    overview.sectors.forEach((sec) => {
      sectorPctMap.set(sec.name, { chg: sec.change_pct, key: sec.board_code });
    });

    const sortedStocks = [...overview.stocks].sort((a, b) => {
      const va = sizeMetric === 'amount' ? (a.amount ?? a.market_cap ?? 0) : (a.market_cap ?? a.amount ?? 0);
      const vb = sizeMetric === 'amount' ? (b.amount ?? b.market_cap ?? 0) : (b.market_cap ?? b.amount ?? 0);
      return vb - va;
    });

    const bySector = new Map<string, typeof overview.stocks>();
    for (const s of sortedStocks) {
      const list = bySector.get(s.sector) ?? [];
      if (list.length < 20) {
        list.push(s);
        bySector.set(s.sector, list);
      }
    }

    const treeData = Array.from(bySector.entries()).map(([sectorName, list]) => {
      const secMeta = sectorPctMap.get(sectorName);
      return {
        name: sectorName,
        sectorKey: secMeta?.key ?? list[0]?.sector_key,
        sectorPct: secMeta?.chg ?? 0,
        children: list.map((st) => {
          const rawSize =
            sizeMetric === 'amount'
              ? st.amount || st.market_cap || 1
              : st.market_cap || st.amount || 1;
          const pct = st.change_pct ?? 0;
          return {
            name: st.name,
            value: [Math.max(1, rawSize), pct],
            symbolCode: st.symbol,
            currency: st.currency,
            price: st.price,
            itemStyle: { color: colorForPct(pct) },
          };
        }),
      };
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        ...tooltipGlassStyle,
        formatter: (params: unknown) => {
          const p = params as {
            name: string;
            data?: { symbolCode?: string; sectorPct?: number; value?: number[]; price?: number; currency?: string };
          };
          if (!p.data?.symbolCode) {
            return `<strong>${p.name}</strong><br/>板块涨跌: ${formatPercent(p.data?.sectorPct ?? 0)}`;
          }
          const val = p.data.value?.[0] ?? 0;
          const pct = p.data.value?.[1] ?? 0;
          const pctColor = pct > 0 ? colors.rise : pct < 0 ? colors.fall : colors.flat;
          return `<div style="font-weight:700;margin-bottom:4px">${p.name} <span style="color:${colors.textTertiary};font-weight:400">(${p.data.symbolCode})</span></div>现价: ${p.data.price ?? '--'} ${p.data.currency ?? ''}<br/>涨跌: <b style="color:${pctColor}">${formatPercent(pct)}</b><br/>规模: ${formatMarketValueByCurrency(val, p.data.currency)}`;
        },
      },
      series: [
        {
          type: 'treemap',
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          levels: [
            {
              itemStyle: {
                borderColor: colors.bgCard,
                borderWidth: 0,
                gapWidth: 3,
              },
              upperLabel: { show: false },
            },
            {
              label: { show: false },
              upperLabel: {
                show: true,
                height: 22,
                color: colors.textPrimary,
                backgroundColor: colors.bgElevated,
                fontSize: 11,
                fontWeight: 600,
                padding: [0, 6],
                formatter: (params: unknown) => {
                  const p = params as { name: string; data?: { sectorPct?: number } };
                  return `${p.name} ${formatPercent(p.data?.sectorPct ?? 0)}`;
                },
              },
              itemStyle: {
                borderColor: colors.bgCard,
                borderWidth: 2,
                gapWidth: 2,
                borderRadius: 4,
              },
            },
            {
              label: {
                show: true,
                position: 'inside',
                overflow: 'truncate',
                formatter: (params: unknown) => {
                  const p = params as { name: string; data?: { value?: number[] } };
                  return `{name|${p.name}}\n{change|${formatPercent(p.data?.value?.[1] ?? 0)}}`;
                },
                rich: richLabel,
              },
              itemStyle: {
                borderColor: colors.bgCard,
                borderWidth: 1,
                gapWidth: 1,
                borderRadius: 4,
              },
            },
          ],
          emphasis: {
            itemStyle: {
              borderColor: colors.accent,
              borderWidth: 2,
            },
          },
          data: treeData,
        },
      ],
    };
  }, [overview, mode, sizeMetric, colors, theme]);

  const handleEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const p = params as { data?: { symbolCode?: string; sectorKey?: string } };
        if (p.data?.symbolCode) {
          navigate(`/s/${p.data.symbolCode}`);
        } else if (p.data?.sectorKey && onSelectSector) {
          onSelectSector(p.data.sectorKey);
        }
      },
    }),
    [navigate, onSelectSector]
  );

  if (overview.stocks.length === 0) {
    return <Empty title={`${overview.market_label}暂无热力图数据`} />;
  }

  return (
    <Card padding="sm" className={styles.heatmapCard}>
      <div className={styles.subControls}>
        <Tabs
          items={[
            { key: 'sector', label: '纯行业板块图' },
            { key: 'nested', label: '行业×龙头双层全景' },
          ]}
          activeKey={mode}
          onChange={(k) => setMode(k as HeatmapMode)}
          size="sm"
        />
        <div className={styles.legendInline}>
          <span>大跌</span>
          <div className={styles.heatmapLegendBar} data-mode={settings.colorMode} />
          <span>大涨</span>
        </div>
        <Tabs
          items={[
            { key: 'market_cap', label: '面积: 总市值' },
            { key: 'amount', label: '面积: 成交额' },
          ]}
          activeKey={sizeMetric}
          onChange={(k) => setSizeMetric(k as SizeMetric)}
          size="sm"
        />
      </div>
      <div className={styles.outerHeatmapCanvas}>
        <LazyEChart
          option={option}
          onEvents={handleEvents}
          notMerge
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </Card>
  );
}
