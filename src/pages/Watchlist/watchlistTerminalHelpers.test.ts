import { describe, expect, it } from 'vitest';
import type { FullQuote } from 'stock-sdk';
import { getChartColors } from '@/components/charts/chartTheme';
import {
  buildCompactTimelineOption,
  computeIntradayMinuteVolumes,
  computeQuoteFlashMap,
  formatSignedAmountWan,
  getAShareSessionState,
  resolveWatchlistPollingPlan,
  sortWatchlistQuotes,
  updatePriceWindowAndComputeSpeed,
} from './watchlistTerminalHelpers';

function makeQuote(overrides: Partial<FullQuote> & { code: string }): FullQuote {
  return {
    marketId: '1',
    name: `测试_${overrides.code}`,
    prevClose: 10,
    open: 10,
    volume: 1000,
    outerVolume: 500,
    innerVolume: 500,
    bid: [],
    ask: [],
    time: '20261119103000',
    timestamp: null,
    tz: 'Asia/Shanghai',
    price: 10,
    change: 0,
    changePercent: 0,
    high: 10.2,
    low: 9.8,
    volume2: 1000,
    amount: 5000,
    turnoverRate: 1.5,
    pe: 20,
    amplitude: 4,
    circulatingMarketCap: 100,
    totalMarketCap: 120,
    pb: 2,
    limitUp: 11,
    limitDown: 9,
    volumeRatio: 1.2,
    avgPrice: 10,
    peStatic: 21,
    peDynamic: 19,
    high52w: 12,
    low52w: 8,
    circulatingShares: 1e9,
    totalShares: 1.2e9,
    market: 'CN',
    assetType: 'stock',
    source: 'tencent',
    ...overrides,
  };
}

describe('getAShareSessionState & resolveWatchlistPollingPlan', () => {
  it('classifies A-share trading sessions strictly in Asia/Shanghai regardless of host timezone', () => {
    // 2026-11-19 is Thursday (weekday)
    expect(getAShareSessionState(new Date('2026-11-19T01:14:00Z'))).toBe('closed'); // 09:14 CST
    expect(getAShareSessionState(new Date('2026-11-19T01:15:00Z'))).toBe('auction'); // 09:15 CST
    expect(getAShareSessionState(new Date('2026-11-19T01:30:00Z'))).toBe('morning'); // 09:30 CST
    expect(getAShareSessionState(new Date('2026-11-19T03:30:00Z'))).toBe('morning'); // 11:30 CST
    expect(getAShareSessionState(new Date('2026-11-19T03:31:00Z'))).toBe('noon_break'); // 11:31 CST
    expect(getAShareSessionState(new Date('2026-11-19T05:00:00Z'))).toBe('afternoon'); // 13:00 CST
    expect(getAShareSessionState(new Date('2026-11-19T07:00:00Z'))).toBe('afternoon'); // 15:00 CST
    expect(getAShareSessionState(new Date('2026-11-19T07:01:00Z'))).toBe('closed'); // 15:01 CST
    // 2026-11-21 is Saturday
    expect(getAShareSessionState(new Date('2026-11-21T02:00:00Z'))).toBe('closed'); // Sat 10:00 CST
  });

  it('adapts live3s polling frequency to 3s during trading and 30s off-hours', () => {
    const tradingPlan = resolveWatchlistPollingPlan('live3s', 15000, new Date('2026-11-19T02:00:00Z'));
    expect(tradingPlan.enabled).toBe(true);
    expect(tradingPlan.quoteIntervalMs).toBe(3000);
    expect(tradingPlan.timelineIntervalMs).toBe(5000);
    expect(tradingPlan.statusLabel).toContain('3s');

    const offHoursPlan = resolveWatchlistPollingPlan('live3s', 15000, new Date('2026-11-19T08:00:00Z'));
    expect(offHoursPlan.enabled).toBe(true);
    expect(offHoursPlan.quoteIntervalMs).toBe(30000);
    expect(offHoursPlan.timelineIntervalMs).toBe(30000);
    expect(offHoursPlan.statusLabel).toContain('30s');

    const pausedPlan = resolveWatchlistPollingPlan('paused', 15000, new Date('2026-11-19T02:00:00Z'));
    expect(pausedPlan.enabled).toBe(false);
    expect(pausedPlan.statusLabel).toContain('已暂停');
  });
});

describe('computeQuoteFlashMap', () => {
  it('emits up/down flash only on real positive price changes and ignores flat/zero prices', () => {
    const prev = new Map<string, Pick<FullQuote, 'code' | 'price'>>([
      ['sh600900', { code: '600900', price: 28.5 }],
      ['sz300476', { code: '300476', price: 45.0 }],
      ['sh601138', { code: '601138', price: 20.0 }],
      ['sh600887', { code: '600887', price: 0 }],
    ]);
    const next = new Map<string, Pick<FullQuote, 'code' | 'price'>>([
      ['sh600900', { code: '600900', price: 28.55 }],
      ['sz300476', { code: '300476', price: 44.8 }],
      ['sh601138', { code: '601138', price: 20.0 }],
      ['sh600887', { code: '600887', price: 27.1 }],
      ['sh601088', { code: '601088', price: 0 }],
    ]);

    const flashes = computeQuoteFlashMap(prev, next);
    expect(flashes.get('sh600900')).toBe('up');
    expect(flashes.get('sz300476')).toBe('down');
    expect(flashes.has('sh601138')).toBe(false);
    expect(flashes.has('sh600887')).toBe(false);
    expect(flashes.has('sh601088')).toBe(false);
  });
});

describe('updatePriceWindowAndComputeSpeed', () => {
  it('fails closed (returns null) when span is under 30s, computes 3-minute speed, and prunes stale samples', () => {
    const t0 = 1_700_000_000_000;
    const step1 = updatePriceWindowAndComputeSpeed([], 100, t0);
    expect(step1.speedPercent).toBeNull();
    expect(step1.samples).toHaveLength(1);

    const step2 = updatePriceWindowAndComputeSpeed(step1.samples, 101, t0 + 29_000);
    expect(step2.speedPercent).toBeNull();
    expect(step2.samples).toHaveLength(2);

    const step3 = updatePriceWindowAndComputeSpeed(step2.samples, 102, t0 + 180_000);
    expect(step3.speedPercent).toBeCloseTo(2.0, 5);

    // Add a much later sample (> 6 min after t0): t0 should be pruned, t0+180s becomes 180s baseline
    const step4 = updatePriceWindowAndComputeSpeed(step3.samples, 104.04, t0 + 365_000);
    expect(step4.samples.some((s) => s.ts === t0)).toBe(false);
    expect(step4.speedPercent).toBeCloseTo(2.0, 5);
  });
});

describe('computeIntradayMinuteVolumes & buildCompactTimelineOption', () => {
  it('converts cumulative shares into per-minute lots, clamps decreasing glitches to 0, and colors bar 0 via prevClose', () => {
    const bars = computeIntradayMinuteVolumes(
      [
        { price: 28.1, volume: 120_000 }, // 1200 hands, < prevClose(28.2) -> fall
        { price: 28.3, volume: 185_000 }, // +650 hands, >= 28.1 -> rise
        { price: 28.2, volume: 170_000 }, // anomalous drop -> clamped to 0, < 28.3 -> fall
      ],
      28.2
    );

    expect(bars).toEqual([
      { volumeLots: 1200, isRise: false },
      { volumeLots: 650, isRise: true },
      { volumeLots: 0, isRise: false },
    ]);

    const option = buildCompactTimelineOption({
      timeline: {
        code: 'sh600900',
        date: '2026-11-19',
        timestamp: null,
        tz: 'Asia/Shanghai',
        preClose: 28.2,
        data: [
          { time: '09:30', timestamp: null, tz: 'Asia/Shanghai', price: 28.1, avgPrice: 28.1, volume: 120_000, amount: 3_372_000 },
          { time: '09:31', timestamp: null, tz: 'Asia/Shanghai', price: 28.3, avgPrice: 28.2, volume: 185_000, amount: 5_217_000 },
        ],
      },
      colors: getChartColors('dark', 'red-rise'),
    });
    const series = option.series as Array<{ markLine?: { data?: Array<{ yAxis: number }> } }>;
    expect(series[0]?.markLine?.data?.[0]?.yAxis).toBe(28.2);
  });
});

describe('sortWatchlistQuotes & formatSignedAmountWan', () => {
  it('always places null/undefined/NaN values at bottom in both asc and desc orders', () => {
    const qNeg = makeQuote({ code: 'sh600900', changePercent: -1.5, volumeRatio: 0.8, peDynamic: -12, pe: null });
    const qPos = makeQuote({ code: 'sz300476', changePercent: 3.2, volumeRatio: 2.1, peDynamic: 28, pe: 28 });
    const qMissing = makeQuote({
      code: 'sh601138',
      changePercent: Number.NaN,
      volumeRatio: null,
      peDynamic: null,
      pe: null,
    });

    const descVol = sortWatchlistQuotes([qMissing, qNeg, qPos], 'volumeRatio', 'desc');
    expect(descVol.map((q) => q.code)).toEqual(['sz300476', 'sh600900', 'sh601138']);

    const ascVol = sortWatchlistQuotes([qMissing, qPos, qNeg], 'volumeRatio', 'asc');
    expect(ascVol.map((q) => q.code)).toEqual(['sh600900', 'sz300476', 'sh601138']);

    const ascPe = sortWatchlistQuotes([qMissing, qPos, qNeg], 'peDynamic', 'asc');
    expect(ascPe.map((q) => q.code)).toEqual(['sh600900', 'sz300476', 'sh601138']);

    const speedMap = new Map<string, number | null>([
      ['sh600900', -0.45],
      ['sz300476', 0.92],
      ['sh601138', null],
    ]);
    const descSpeed = sortWatchlistQuotes([qMissing, qNeg, qPos], 'speed', 'desc', speedMap);
    expect(descSpeed.map((q) => q.code)).toEqual(['sz300476', 'sh600900', 'sh601138']);
  });

  it('formats signed fund flow in 万元/亿元 accurately without distorting negative values', () => {
    expect(formatSignedAmountWan(12500)).toBe('+1.25亿');
    expect(formatSignedAmountWan(-1200)).toBe('-1200.00万');
    expect(formatSignedAmountWan(null)).toBe('--');
  });
});
