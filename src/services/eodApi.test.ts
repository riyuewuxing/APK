import { describe, expect, it } from 'vitest';
import { referenceCount, referenceGroups, referenceRate, type EodJournalResponse, type EodWinRateStats, type EodSchemeStats } from './eodApi';

const rate = (n: number): EodWinRateStats => ({
  sample_count: n, settled_count: 0, statistics_basis: 'RAW_REFERENCE_GROSS_NOT_TRADE_WIN_RATE',
  t1_open_win_rate_pct: null, t1_close_win_rate_pct: null, t3_close_win_rate_pct: null,
  avg_open_premium_pct: null, profit_loss_ratio: null,
});
const stats: EodJournalResponse['stats'] = {
  generated_at: '2024-01-02', snapshot_count: 2, candidate_count: 2, schemes: [],
  research_only: true, execution_allowed: false, statistics_scope: 'MIXED_CLIENT_REFERENCE_NOT_VALIDATED_FORECAST',
  model_validation_status: 'NOT_VALIDATED', probability_calibrated: false,
};
const scheme: EodSchemeStats = { scheme_name: 'synthetic', overall: rate(2), by_regime: {},
  same_day_server_recorded_reference: rate(1), retrospective_or_unverified_reference: rate(1) };
describe('descriptive reference observations', () => {
  it('distinguishes no observations, unknown counts, and genuine zero percent', () => {
    expect(referenceCount(undefined)).toBe('未知');
    expect(referenceCount(0)).toBe('0');
    expect(referenceRate(rate(2), 0, 0)).toBe('N/A');
    expect(referenceRate(rate(2), 0, undefined)).toBe('N/A');
    expect(referenceRate(rate(2), 0, 1)).toBe('0.0%');
    expect(referenceRate(rate(2), 100, 3)).toBe('N/A');
    expect(referenceRate(rate(2), 101, 1)).toBe('N/A');
    expect(referenceRate(rate(2), -2, 1, 2, false)).toBe('-2.00%');
    expect(referenceRate({...rate(2), statistics_basis: undefined}, 50, 1)).toBe('N/A');
  });
  it('withholds legacy or inconsistent grouping', () => {
    expect(referenceGroups(stats, scheme)?.map(x => x.stats.sample_count)).toEqual([1, 1]);
    expect(referenceGroups({...stats, statistics_scope: undefined}, scheme)).toBeNull();
    expect(referenceGroups(stats, {...scheme, retrospective_or_unverified_reference: rate(2)})).toBeNull();
    expect(referenceGroups(stats, {...scheme, same_day_server_recorded_reference: undefined})).toBeNull();
  });
});
