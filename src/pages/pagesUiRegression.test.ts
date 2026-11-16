import { describe, expect, it } from 'vitest';
import type { IndustryBoard } from 'stock-sdk';
import { formatHotBoardBreadth, formatNorthboundDisplay } from './Dashboard/dashboardHelpers';
import { resolveHeatmapControls } from './Heatmap/heatmapHelpers';
import {
  formatRankingMetricCell,
  getRankingColumnHeader,
  sortBoards,
  type BoardExtraFields,
} from './Rankings/rankingHelpers';

function makeBoard(overrides: Partial<IndustryBoard & BoardExtraFields>): IndustryBoard & BoardExtraFields {
  return {
    rank: 1,
    name: '测试板块',
    code: 'hangye_TEST',
    price: 10,
    change: 0.1,
    changePercent: 1.0,
    totalMarketCap: null,
    turnoverRate: null,
    riseCount: null,
    fallCount: null,
    leadingStock: '领涨股',
    leadingStockChangePercent: 2.0,
    amount: 100000,
    netInflowYi: null,
    constituentCount: 10,
    ...overrides,
  };
}

describe('Dashboard / Rankings / Heatmap regression checks', () => {
  it('shows suspended disclosure text instead of 0元 when northbound amounts are all zero', () => {
    expect(
      formatNorthboundDisplay({ netInflow: 0, netBuyAmount: 0, remainAmount: 0 })
    ).toEqual({ label: '--（盘中已停披露）', suspended: true });

    expect(
      formatNorthboundDisplay({ netInflow: 250000000, netBuyAmount: 250000000, remainAmount: 0 })
    ).toEqual({ label: '2.50亿', suspended: false });
  });

  it('falls back to constituent count when rise/fall counts are unavailable', () => {
    expect(formatHotBoardBreadth({ riseCount: null, fallCount: null, constituentCount: 42 })).toEqual({
      mode: 'text',
      text: '共 42 只成分股',
    });
    expect(formatHotBoardBreadth({ riseCount: 12, fallCount: 5, constituentCount: 17 })).toEqual({
      mode: 'riseFall',
      rise: 12,
      fall: 5,
    });
  });

  it('aligns netInflow ranking column sorting (nulls last) and display units', () => {
    const missingFlow = makeBoard({ code: 'B_MISSING', name: '缺失净流', amount: 900000, netInflowYi: null });
    const negFlow = makeBoard({ code: 'B_NEG', name: '负净流', amount: 200000, netInflowYi: -3.25 });
    const posFlow = makeBoard({ code: 'B_POS', name: '正净流', amount: 150000, netInflowYi: 8.42 });

    const ordered = sortBoards([missingFlow, negFlow, posFlow], 'netInflow');
    expect(ordered.map((b) => b.code)).toEqual(['B_POS', 'B_NEG', 'B_MISSING']);
    expect(getRankingColumnHeader('netInflow')).toBe('主力净流');
    expect(formatRankingMetricCell(ordered[0]!, 'netInflow').text).toBe('+8.42亿');
    expect(formatRankingMetricCell(ordered[1]!, 'netInflow').text).toBe('-3.25亿');
    expect(formatRankingMetricCell(ordered[2]!, 'netInflow').text).toBe('--');
  });

  it('hides missing turnoverRate/totalMarketCap controls in Heatmap board dimensions', () => {
    const indControls = resolveHeatmapControls('industry', {
      colorField: 'turnoverRate',
      sizeField: 'totalMarketCap',
    });
    expect(indControls.colorFieldOptions.map((o) => o.key)).toEqual(['changePercent']);
    expect(indControls.sizeFieldOptions.map((o) => o.key)).toEqual(['amount']);
    expect(indControls.effectiveColorField).toBe('changePercent');
    expect(indControls.effectiveSizeField).toBe('amount');

    const watchControls = resolveHeatmapControls('watchlist', {
      colorField: 'turnoverRate',
      sizeField: 'totalMarketCap',
    });
    expect(watchControls.colorFieldOptions.map((o) => o.key)).toContain('turnoverRate');
    expect(watchControls.sizeFieldOptions.map((o) => o.key)).toContain('totalMarketCap');
  });
});
