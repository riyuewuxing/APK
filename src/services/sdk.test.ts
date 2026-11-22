import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeLargeOrderRatios } from '@/utils/format';
import {
  buildBoardRoute,
  clearSdkCache,
  getBoardFundFlow,
  getBoardKlineWithMeta,
  getBoardSummary,
  getFundFlow,
  getFundFlowRank,
  getIndividualFundFlow,
  getIndustryList,
  getKlineWithIndicators,
  getMarketFundFlow,
  getSectorFundFlowHistory,
  getSectorFundFlowRank,
  normalizeBoardCode,
  sdk,
} from './sdk';
import { fetchResearchCard, normalizeResearchSubjectId } from './expertApi';

describe('sdk market proxy adapters', () => {
  afterEach(() => {
    clearSdkCache();
    vi.restoreAllMocks();
  });

  it('prefers /api/market/boards/industry when backend responds cleanly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            rank: 1,
            name: '电力',
            code: 'hangye_ZA01',
            price: 1412.5,
            change: 18.2,
            changePercent: 2.35,
            totalMarketCap: null,
            turnoverRate: null,
            riseCount: 62,
            fallCount: 16,
            leadingStock: '长江电力',
            leadingStockChangePercent: 3.4,
            amount: 2105000,
            constituentCount: 78,
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const list = await getIndustryList();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/market/boards/industry');
    expect(list).toHaveLength(1);
    expect(list[0]?.code).toBe('hangye_ZA01');
    expect(list[0]?.totalMarketCap).toBeNull();
  });

  it('routes sector and individual fund flow ranks to /api/market/fund-flow/*', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              code: 'hangye_ZA01',
              name: '电力',
              changePercent: 2.35,
              mainNetInflow: 1840000000,
              mainNetInflowPercent: 11.2,
              superLargeNetInflow: null,
              largeNetInflow: null,
              mediumNetInflow: null,
              smallNetInflow: null,
              topStockName: '长江电力',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              code: '600900',
              name: '长江电力',
              price: 29.91,
              changePercent: 1.01,
              mainNetInflow: 626000000,
              mainNetInflowPercent: 23.9,
              superLargeNetInflow: null,
              superLargeNetInflowPercent: null,
              largeNetInflow: null,
              largeNetInflowPercent: null,
              mediumNetInflow: null,
              mediumNetInflowPercent: null,
              smallNetInflow: null,
              smallNetInflowPercent: null,
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const sectors = await getSectorFundFlowRank({ sectorType: 'industry', indicator: 'today' });
    const stocks = await getFundFlowRank({ indicator: 'today' });

    expect(sectors[0]?.name).toBe('电力');
    expect(stocks[0]?.code).toBe('600900');
  });

  it('returns empty array instead of probing EM for non-BK sector fund flow history', async () => {
    const history = await getSectorFundFlowHistory('hangye_ZA01');
    expect(history).toEqual([]);
  });

  it('normalizes encoded THS board codes once and calls new summary/kline/fund-flow routes cleanly', async () => {
    const rawCode = 'ths_ind:%E5%8C%BB%E8%8D%AF%E5%95%86%E4%B8%9A';
    expect(normalizeBoardCode(rawCode)).toBe('ths_ind:医药商业');
    expect(buildBoardRoute('industry', rawCode)).toBe(
      '/boards/industry/ths_ind%3A%E5%8C%BB%E8%8D%AF%E5%95%86%E4%B8%9A'
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          meta: { name: '医药商业', code: rawCode, totalMarketCap: 1200, riseCount: 15, fallCount: 8 },
          spot: [{ item: '总市值(亿)', value: 1200 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ date: '2026-11-12', open: 1000, close: 1012, high: 1020, low: 995 }],
          kline_source: 'constituent_proxy',
          kline_source_label: '成分股合成参考走势 (前15大成分股等权基准=1000)',
          sampled_constituents: 15,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          periods: [{ period: 'today', label: '今日', netInflowYi: 1.5, inflowYi: 5.0, outflowYi: 3.5, changePercent: 1.2 }],
          daily_history: [
            {
              date: '2026-11-12',
              mainNetInflow: 150000000,
              mainNetInflowPercent: 2.1,
              superLargeNetInflow: 90000000,
              smallNetInflow: -30000000,
            },
          ],
          flow_source: 'ths_periods+constituent_daily',
          flow_source_label: '同花顺多周期板块资金 + 前10大成分股日线主力净流聚合',
          sampled_constituents: 10,
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const summary = await getBoardSummary('industry', rawCode);
    const kline = await getBoardKlineWithMeta('industry', 'ths_ind:医药商业', { period: 'daily' });
    const ff = await getBoardFundFlow('industry', rawCode);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/market/boards/industry/ths_ind%3A%E5%8C%BB%E8%8D%AF%E5%95%86%E4%B8%9A/summary'
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/api/market/boards/industry/ths_ind%3A%E5%8C%BB%E8%8D%AF%E5%95%86%E4%B8%9A/kline?period=daily'
    );
    expect(summary.meta?.totalMarketCap).toBe(1200);
    expect(kline.klineSource).toBe('constituent_proxy');
    expect(kline.items).toHaveLength(1);
    expect(ff.periods).toHaveLength(1);
    expect(ff.dailyHistory[0]?.mainNetInflow).toBe(150000000);
  });

  it('scales 0..1 decimal largeOrder ratios to 0..100 percentages cleanly', () => {
    const scaled = normalizeLargeOrderRatios({
      buyLargeRatio: 0.393,
      buySmallRatio: 0.18,
      sellLargeRatio: 0.193,
      sellSmallRatio: 0.234,
    });
    expect(scaled.hasData).toBe(true);
    expect(scaled.buyLargePct).toBeCloseTo(39.3, 4);
    expect(scaled.sellSmallPct).toBeCloseTo(23.4, 4);

    const empty = normalizeLargeOrderRatios({
      buyLargeRatio: 0,
      buySmallRatio: 0,
      sellLargeRatio: 0,
      sellSmallRatio: 0,
    });
    expect(empty.hasData).toBe(false);
  });

  it('routes individual and market fund flow through backend proxy without probing EM push2', async () => {
    const emIndividualSpy = vi.spyOn(sdk.fundFlow, 'individual');
    const emMarketSpy = vi.spyOn(sdk.fundFlow, 'market');
    const emIndustrySpy = vi.spyOn(sdk.board.industry, 'list');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              date: '2026-11-13',
              mainNetInflow: 741446243.01,
              mainNetInflowPercent: 13.01,
              superLargeNetInflow: 500000000,
              largeNetInflow: 241446243.01,
              mediumNetInflow: -100000000,
              smallNetInflow: -200000000,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              date: '2026-11-13',
              mainNetInflow: -95219000000,
              mainNetInflowPercent: -9.03,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'upstream error' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const stockFlow = await getIndividualFundFlow('600519', { period: 'daily' });
    const marketFlow = await getMarketFundFlow();
    const failedList = await getIndustryList();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/market/stocks/sh600519/fund-flow?period=daily'
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/market/fund-flow/market');
    expect(stockFlow[0]?.mainNetInflow).toBe(741446243.01);
    expect(marketFlow[0]?.mainNetInflow).toBe(-95219000000);
    expect(failedList).toEqual([]);
    expect(emIndividualSpy).not.toHaveBeenCalled();
    expect(emMarketSpy).not.toHaveBeenCalled();
    expect(emIndustrySpy).not.toHaveBeenCalled();
  });

  it('falls back to /api/market/stocks/{code}/kline and computes indicators when EM fails', async () => {
    vi.spyOn(sdk.kline, 'withIndicators').mockRejectedValue(new Error('net::ERR_EMPTY_RESPONSE'));
    const sampleBars = Array.from({ length: 12 }, (_, idx) => ({
      date: `2026-11-${String(idx + 1).padStart(2, '0')}`,
      timestamp: null,
      tz: 'Asia/Shanghai',
      code: 'sh600519',
      open: 1400 + idx,
      close: 1402 + idx,
      high: 1405 + idx,
      low: 1398 + idx,
      volume: 10000 + idx * 100,
      amount: null,
      amplitude: 0.5,
      changePercent: 0.2,
      change: 2.0,
      turnoverRate: null,
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: sampleBars, count: sampleBars.length }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await getKlineWithIndicators('sh600519', {
      period: 'weekly',
      adjust: 'hfq',
      indicators: { ma: { periods: [5, 10] } },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/market/stocks/sh600519/kline?period=weekly&adjust=hfq'
    );
    expect(rows).toHaveLength(12);
    expect(rows.at(-1)?.ma?.ma5).toBeCloseTo(1411, 4);
  });

  it('routes getFundFlow through backend Sina proxy in 万元 without calling dead EM quotes.fundFlow', async () => {
    const deadEmSpy = vi.spyOn(sdk.quotes, 'fundFlow');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            date: '2026-11-16',
            mainNetInflow: 120000000,
            mainNetInflowPercent: 8.5,
            superLargeNetInflow: 80000000,
            largeNetInflow: 40000000,
            mediumNetInflow: -20000000,
            smallNetInflow: -30000000,
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const flows = await getFundFlow(['600519']);
    expect(deadEmSpy).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/market/stocks/sh600519/fund-flow?period=daily');
    expect(flows).toHaveLength(1);
    expect(flows[0]?.mainNet).toBeCloseTo(12000, 4);
    expect(flows[0]?.retailNet).toBeCloseTo(-5000, 4);
  });

  it('preserves explicit market prefixes and asset_type hints on research requests', async () => {
    expect(normalizeResearchSubjectId('sz000001')).toBe('sz000001');
    expect(normalizeResearchSubjectId('sh000001')).toBe('sh000001');
    expect(normalizeResearchSubjectId('000999')).toBe('000999');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ subject_id: '000001', asset_type: 'FUND' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchResearchCard('000001', undefined, 'fund');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/research/000001?asset_type=fund');
  });
});
