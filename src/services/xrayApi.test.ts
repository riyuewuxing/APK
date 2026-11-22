import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChartColors } from '@/components/charts/chartTheme';
import { buildXRaySectorChartOption, buildXRayTopHoldingsChartOption } from '@/components/expert';
import { resetApiClientState } from './apiClient';
import { clearOfflineSnapshots } from './offlineCache';
import {
  FUND_DISCLOSURE_STATUS_LABELS,
  OVERLAP_ALERT_TYPE_LABELS,
  XRAY_ACCOUNT_OPTIONS,
  fetchPortfolioXRay,
  type PortfolioXRayResponse,
} from './xrayApi';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

const SAMPLE_XRAY: PortfolioXRayResponse = {
  account_id: 'ALL',
  account_label: '全账户联合穿透',
  as_of: '2026-11-06',
  include_amounts: false,
  total_equity_cny: null,
  unattributed_bucket_id: 'UNATTRIBUTED_FUND_RESIDUAL',
  coverage_summary: {
    direct_stock_weight_pct: 3.56,
    indirect_disclosed_stock_weight_pct: 9.83,
    total_disclosed_equity_weight_pct: 13.39,
    cash_and_money_fund_weight_pct: 13.64,
    unattributed_fund_residual_pct: 72.97,
    max_staleness_days: 37,
    disclosed_fund_count: 5,
    total_fund_count: 6,
    data_gap_notes: ['未披露余项严守 UNATTRIBUTED_FUND_RESIDUAL 口径。'],
  },
  top_underlying_exposures: [
    {
      symbol: '601138',
      name: '工业富联',
      sector: '消费电子',
      total_weight_pct: 1.34,
      direct_weight_pct: 0.8,
      indirect_weight_pct: 0.54,
      holder_count: 2,
      is_direct_held: true,
      research_route: '/expert?symbol=sh601138',
      breakdown_text: '直持 0.80% + 通过 018956 间接持有 0.54%',
      contributions: [],
    },
  ],
  overlap_alerts: [
    {
      symbol: '601138',
      name: '工业富联',
      sector: '消费电子',
      alert_type: 'MULTI_HOLDER',
      holder_count: 2,
      total_weight_pct: 1.34,
      direct_weight_pct: 0.8,
      indirect_weight_pct: 0.54,
      holders_summary: '直持 0.80% + 通过 018956 间接持有 0.54%',
      research_route: '/expert?symbol=sh601138',
    },
  ],
  sector_exposures: [
    {
      sector: '消费电子',
      total_weight_pct: 1.34,
      direct_weight_pct: 0.8,
      indirect_weight_pct: 0.54,
      underlying_count: 1,
      top_symbols: ['工业富联(1.34%)'],
    },
  ],
  fund_disclosures: [
    {
      fund_code: '018956',
      fund_name: '中航机遇领航混合发起A',
      account_id: 'FND-TIANTIAN-002',
      portfolio_weight_pct: 9.38,
      asset_class: 'FUND',
      holdings_report_date: '2026-09-30',
      staleness_days: 37,
      disclosed_coverage_pct: 72.44,
      unattributed_residual_pct: 27.56,
      top_holdings_count: 13,
      status: 'DISCLOSED',
      source: 'eastmoney_fundf10_jjcc',
      note: '已披露 13 只持仓股。',
    },
  ],
  lookthrough_exposures: [],
  warnings: [],
  research_only: true,
  execution_allowed: false,
};

describe('xrayApi & X-Ray ECharts builders', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    clearOfflineSnapshots();
    resetApiClientState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requests /api/portfolio/xray with account_id query param and returns read-only payload', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_XRAY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    const data = await fetchPortfolioXRay('FND-TIANTIAN-002');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [reqUrl] = fetchSpy.mock.calls[0] as [string];
    expect(reqUrl).toContain('/api/portfolio/xray?account_id=FND-TIANTIAN-002');
    expect(data.unattributed_bucket_id).toBe('UNATTRIBUTED_FUND_RESIDUAL');
    expect(data.total_equity_cny).toBeNull();
    expect(XRAY_ACCOUNT_OPTIONS.map((o) => o.value)).toEqual([
      'ALL',
      'STK-ALIPAY-001',
      'FND-TIANTIAN-002',
    ]);
    expect(FUND_DISCLOSURE_STATUS_LABELS.LOW_COVERAGE_FEEDER).toBe('联接基金低覆盖');
    expect(OVERLAP_ALERT_TYPE_LABELS.MULTI_HOLDER).toBe('跨账户/多基金叠加');
  });

  it('builds stacked bar ECharts options for holdings & sectors and returns {} when empty', () => {
    const colors = getChartColors('dark', 'red-rise');
    expect(buildXRayTopHoldingsChartOption([], colors)).toEqual({});
    expect(buildXRaySectorChartOption([], colors)).toEqual({});

    const topOpt = buildXRayTopHoldingsChartOption(SAMPLE_XRAY.top_underlying_exposures, colors);
    expect(topOpt.tooltip?.confine).toBe(true);
    expect(topOpt.series).toHaveLength(2);
    expect(topOpt.series?.[0]?.stack).toBe('xray');

    const secOpt = buildXRaySectorChartOption(SAMPLE_XRAY.sector_exposures, colors);
    expect(secOpt.tooltip?.confine).toBe(true);
    expect(secOpt.series).toHaveLength(2);
    expect(secOpt.series?.[0]?.stack).toBe('sector');
  });
});
