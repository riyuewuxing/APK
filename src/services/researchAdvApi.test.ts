import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientState } from './apiClient';
import { clearOfflineSnapshots } from './offlineCache';
import {
  MINESWEEPER_OVERALL_LABELS,
  RULE_STATUS_LABELS,
  STANCE_LABELS,
  VERIFICATION_STATUS_LABELS,
  fetchDebateSynthesis,
  fetchFilingMinesweeper,
} from './researchAdvApi';

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

describe('researchAdvApi (M4 minesweeper & debate)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    clearOfflineSnapshots();
    resetApiClientState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requests /api/research/{id}/minesweeper and preserves asset_type hint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          symbol: 'sh600900',
          subject_id: '600900',
          subject_name: '长江电力',
          asset_type: 'STOCK',
          asset_semantic_isolated: false,
          as_of: '2026-11-18',
          report_date: '2026-09-30',
          report_name: '2026三季报',
          overall_status: 'RED_FLAG',
          risk_score: 54.0,
          rules_total: 30,
          red_flag_count: 3,
          warn_count: 0,
          unknown_count: 0,
          pass_count: 27,
          categories: [],
          rules: [],
          recent_disclosures: [],
          pledge_ratio_pct: 1.84,
          restricted_unlock_pct: 0,
          data_sources: {},
          notice: '',
          research_only: true,
          execution_allowed: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchSpy);

    const res = await fetchFilingMinesweeper('sh600900', undefined, 'stock');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/api/research/sh600900/minesweeper?asset_type=stock');
    expect(res.rules_total).toBe(30);
    expect(res.research_only).toBe(true);
    expect(res.execution_allowed).toBe(false);
    expect(MINESWEEPER_OVERALL_LABELS.UNKNOWN).toContain('UNKNOWN');
    expect(RULE_STATUS_LABELS.RED_FLAG).toBe('红旗');
  });

  it('requests /api/research/{id}/debate and keeps VerificationStatus labels complete', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          subject_id: '300476',
          subject_name: '胜宏科技',
          asset_type: 'STOCK',
          as_of: '2026-09-24',
          claim_ledger_status: 'ClaimLedger (SUPPORTED)',
          action_lock: 'WAIT',
          action_label_zh: '等待',
          composite_conviction_score: 37.6,
          minesweeper_overall_status: 'WARN',
          minesweeper_red_flags: 0,
          minesweeper_warn_count: 2,
          minesweeper_unknown_count: 0,
          perspectives: [],
          dominant_tension: '待核验',
          change_triggers: [],
          research_only: true,
          execution_allowed: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchSpy);

    const res = await fetchDebateSynthesis('300476');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/api/research/300476/debate');
    expect(res.action_lock).toBe('WAIT');
    expect(res.composite_conviction_score).toBe(37.6);
    expect(VERIFICATION_STATUS_LABELS.CONFLICTED).toBe('CONFLICTED');
    expect(STANCE_LABELS.OPPOSE).toBe('反对');
  });
});
