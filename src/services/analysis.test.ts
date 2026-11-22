import { describe, expect, it } from 'vitest';
import type { TodayTimelineResponse } from 'stock-sdk';
import {
  applyBackendVettingFilter,
  applyEodStructureFilters,
  calculateTimelineStrength,
  computeTimelineStructure,
  getLimitPercent,
  isLimitDown,
  isLimitUp,
  type EndOfDayFilters,
  type EndOfDayStock,
} from './analysis';

describe('getLimitPercent', () => {
  it('uses board-specific limits', () => {
    expect(getLimitPercent('sh600000', '样例')).toBe(10);
    expect(getLimitPercent('sz300750', '样例')).toBe(20);
    expect(getLimitPercent('sh688981', '样例')).toBe(20);
    expect(getLimitPercent('bj920002', '样例')).toBe(30);
    expect(getLimitPercent('bj430047', '样例')).toBe(30);
  });

  it('applies the ST limit on the main board only', () => {
    expect(getLimitPercent('sz000001', '*ST样例')).toBe(5);
    expect(getLimitPercent('sz300001', 'ST样例')).toBe(20);
  });
});

describe('isLimitUp / isLimitDown', () => {
  it('treats values within tolerance of the limit as limit moves', () => {
    expect(isLimitUp({ code: 'sh600000', name: '样例', changePercent: 9.95 })).toBe(true);
    expect(isLimitUp({ code: 'sh600000', name: '样例', changePercent: 9.5 })).toBe(false);
    expect(isLimitUp({ code: 'sz300001', name: '样例', changePercent: 10 })).toBe(false);
    expect(isLimitDown({ code: 'sz300001', name: '样例', changePercent: -19.9 })).toBe(true);
  });

  it('ignores missing change percent', () => {
    expect(isLimitUp({ code: 'sh600000', name: '样例', changePercent: null })).toBe(false);
    expect(isLimitDown({ code: 'sh600000', name: '样例', changePercent: null })).toBe(false);
  });
});

describe('calculateTimelineStrength', () => {
  it('returns a zero ratio for an empty timeline', () => {
    const timeline = { data: [] } as unknown as TodayTimelineResponse;
    expect(calculateTimelineStrength(timeline)).toEqual({ ratio: 0, points: [] });
  });

  it('computes the share of points at or above the average price', () => {
    const timeline = {
      data: [
        { time: '09:30', price: 10, avgPrice: 10 },
        { time: '09:31', price: 10.2, avgPrice: 10.1 },
        { time: '09:32', price: 9.9, avgPrice: 10.05 },
        { time: '09:33', price: 10.1, avgPrice: 10.05 },
      ],
    } as unknown as TodayTimelineResponse;

    const { ratio, points } = calculateTimelineStrength(timeline);
    expect(ratio).toBe(75);
    expect(points).toHaveLength(4);
  });
});

// ========== M1 尾盘 2.0 新滤网 ==========

const baseFilters = (overrides: Partial<EndOfDayFilters> = {}): EndOfDayFilters => ({
  marketCapMin: 50,
  marketCapMax: 200,
  volumeRatioMin: 1.2,
  changePercentMin: 3,
  changePercentMax: 5,
  turnoverRateMin: 5,
  turnoverRateMax: 10,
  excludeST: true,
  timelineAboveAvgRatio: 80,
  tail30mSlopeMin: null,
  tail30mAmountShareMin: null,
  intradayDrawbackMax: 3.0,
  requireMainInflow: false,
  ...overrides,
});

const sampleStock = (): EndOfDayStock => ({
  code: '300476',
  routeCode: 'sz300476',
  name: '样例',
  price: 10.5,
  changePercent: 3.5,
  change: 0.35,
  volume: 1000,
  amount: 1e6,
  turnoverRate: 6,
  volumeRatio: 1.5,
  circulatingMarketCap: 100,
  totalMarketCap: 120,
  pe: 25,
  pb: 3,
  high: 10.8,
  low: 10,
  open: 10.1,
  prevClose: 10.15,
});

// amount 为累计额：尾盘增量 (1000-600)/1000 = 40%，尾盘斜率 (10.5-10.32)/10.32，回撤 (10.8-10.5)/10.8≈2.78%
// 14:00 冲高 10.8 后回落，用于覆盖日内回撤滤网
const cumulativeTimeline = [
  { time: '09:30', price: 10.1, avgPrice: 10.1, amount: 100 },
  { time: '13:30', price: 10.2, avgPrice: 10.15, amount: 400 },
  { time: '14:00', price: 10.8, avgPrice: 10.3, amount: 500 },
  { time: '14:29', price: 10.3, avgPrice: 10.2, amount: 600 },
  { time: '14:30', price: 10.32, avgPrice: 10.25, amount: 700 },
  { time: '15:00', price: 10.5, avgPrice: 10.4, amount: 1000 },
];

describe('computeTimelineStructure', () => {
  it('computes tail slope / cumulative-diff amount share / drawback', () => {
    const s = computeTimelineStructure(cumulativeTimeline);
    expect(s.tail30mReturnPct).toBeCloseTo(((10.5 - 10.32) / 10.32) * 100, 2);
    expect(s.tail30mAmountSharePct).toBeCloseTo(((1000 - 600) / 1000) * 100, 2);
    expect(s.intradayDrawbackPct).toBeCloseTo(((10.8 - 10.5) / 10.8) * 100, 2);
  });

  it('returns nulls for empty / missing cumulative data (fail-closed)', () => {
    expect(computeTimelineStructure([])).toEqual({
      tail30mReturnPct: null, tail30mAmountSharePct: null, intradayDrawbackPct: null,
    });
    const noAmount = computeTimelineStructure([
      { time: '09:30', price: 10, avgPrice: 10 },
      { time: '15:00', price: 10.5, avgPrice: 10.2 },
    ]);
    expect(noAmount.tail30mAmountSharePct).toBeNull();
  });

  it('never sums cumulative amounts (>100%)', () => {
    const s = computeTimelineStructure(cumulativeTimeline);
    expect(s.tail30mAmountSharePct!).toBeLessThanOrEqual(100);
  });
});

describe('applyEodStructureFilters (前结构校验)', () => {
  const structure = computeTimelineStructure(cumulativeTimeline);

  it('passes when all thresholds satisfied', () => {
    const out = applyEodStructureFilters(sampleStock(), baseFilters({
      tail30mSlopeMin: 1.0,
      tail30mAmountShareMin: 30,
      intradayDrawbackMax: 3.0,
    }), structure);
    expect(out).not.toBeNull();
    expect(out!.tail30mReturnPct).toBeCloseTo(structure.tail30mReturnPct!, 2);
  });

  it('rejects on tail slope below min', () => {
    expect(applyEodStructureFilters(sampleStock(), baseFilters({ tail30mSlopeMin: 5 }), structure)).toBeNull();
  });

  it('rejects on tail amount share below min', () => {
    expect(applyEodStructureFilters(sampleStock(), baseFilters({ tail30mAmountShareMin: 60 }), structure)).toBeNull();
  });

  it('rejects on intraday drawback above max', () => {
    expect(applyEodStructureFilters(sampleStock(), baseFilters({ intradayDrawbackMax: 1 }), structure)).toBeNull();
  });

  it('fail-closed: rejects when required structure data missing', () => {
    const empty = computeTimelineStructure([]);
    expect(applyEodStructureFilters(sampleStock(), baseFilters({ tail30mSlopeMin: 0 }), empty)).toBeNull();
  });

  it('null thresholds disable the filter (backward compatible)', () => {
    const out = applyEodStructureFilters(sampleStock(), baseFilters(), structure);
    expect(out).not.toBeNull();
  });
});

describe('applyBackendVettingFilter (后结构校验联动)', () => {
  it('passes when requireMainInflow disabled', () => {
    expect(applyBackendVettingFilter(sampleStock(), baseFilters())).toBe(true);
  });

  it('keeps positive main inflow when required', () => {
    expect(applyBackendVettingFilter({ ...sampleStock(), mainNetInflow10k: 3200 }, baseFilters({ requireMainInflow: true }))).toBe(true);
  });

  it('rejects zero/negative/missing main inflow when required (fail-closed)', () => {
    expect(applyBackendVettingFilter({ ...sampleStock(), mainNetInflow10k: -5 }, baseFilters({ requireMainInflow: true }))).toBe(false);
    expect(applyBackendVettingFilter({ ...sampleStock(), mainNetInflow10k: null }, baseFilters({ requireMainInflow: true }))).toBe(false);
    expect(applyBackendVettingFilter(sampleStock(), baseFilters({ requireMainInflow: true }))).toBe(false);
  });
});
