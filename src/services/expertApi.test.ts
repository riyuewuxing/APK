import { describe, expect, it } from 'vitest';
import { comparisonEvidenceReady, comparisonAdvantageLabel, guardSubjectReview, type DeepResearchCard, type OpportunityCostMatrixRow } from './expertApi';

describe('subject review freshness', () => {
  it.each(['REVIEW_VERIFIED', 'REVIEW_GAPS'])('withholds stale %s directional derivatives', status => {
    const card = {
      subject_review_status: status,
      subject_review_valid_until: '2026-11-26T00:00:00Z',
      audit_claims: [{claim_id: 'claim'}],
      opportunity_cost_matrix: [{alternative_id: 'cash'}],
      research_playbook: {
        status: 'CONDITIONAL_RESEARCH', research_direction: 'BUY',
        reference_band: {low_cny: 9, high_cny: 11},
        candidate_band: {low_cny: 9, high_cny: 9.5},
        valid_until: '2026-11-27T00:00:00Z',
      },
      decision_packet: {
        action: 'BUY', research_action: 'BUY', admission_state: 'ADMITTED',
        composite_conviction_score: 80, supporting_clusters_count: 5,
        supporting_reasons: ['expired support'], cluster_votes: [{indicators: [{badge: {claim_id: 'claim'}}]}],
      },
    } as unknown as DeepResearchCard;
    const before = Date.parse('2026-11-25T23:59:59Z');
    expect(guardSubjectReview(card, before, true)).toBe(card);
    for (const guarded of [guardSubjectReview(card, before, false), guardSubjectReview(card, before + 1000, true)]) {
      expect(guarded.decision_packet.action).toBe('WAIT');
      expect(guarded.decision_packet.research_action).toBeNull();
      expect(guarded.decision_packet.admission_state).toBe('NOT_ADMITTED');
      expect(guarded.decision_packet.composite_conviction_score).toBe(0);
      expect(guarded.decision_packet.cluster_votes).toEqual([]);
      expect(guarded.audit_claims).toEqual([]);
      expect(guarded.opportunity_cost_matrix).toEqual([]);
      expect(guarded.research_playbook?.candidate_band).toBeNull();
      expect(guarded.research_playbook?.reference_band).toEqual({low_cny: 9, high_cny: 11});
    }
    expect(card.decision_packet.research_action).toBe('BUY');
    expect(card.research_playbook?.candidate_band).not.toBeNull();
  });
});


describe('opportunity comparison display contract', () => {
  const verified = (): OpportunityCostMatrixRow => ({
    alternative_id: 'SYNTHETIC', alternative_name: 'Synthetic', alternative_kind: 'CANDIDATE',
    thesis_quality: 'REVIEWED', evidence_confidence: 'REVIEWED', zero_position_test: 'UNVERIFIED',
    decision_eligible: true, candidate_advantages: ['EXPECTED_NET_RETURN_PCT_HIGHER'],
    alternative_advantages: ['DOWNSIDE_RISK_PCT_LOWER', 'LIQUIDITY_COST_BPS_LOWER', 'MARGINAL_PORTFOLIO_RISK_PCT_LOWER'],
    shared_unknowns: [], governance_reasons: [], comparison_basis_label: '[DEMO] same basis',
    comparison_metrics: [
      {key: 'expected_net_return_pct', label: '预期净收益', unit: '%', candidate_value: 4, alternative_value: 3, definition: 'synthetic return'},
      {key: 'downside_risk_pct', label: '下行风险', unit: '%', candidate_value: 5, alternative_value: 2, definition: 'synthetic downside'},
      {key: 'liquidity_cost_bps', label: '流动性成本', unit: 'bps', candidate_value: 10, alternative_value: 5, definition: 'synthetic cost'},
      {key: 'marginal_portfolio_risk_pct', label: '组合边际风险', unit: '%', candidate_value: 2, alternative_value: 1, definition: 'synthetic risk delta'},
    ],
  });
  it('accepts exact four consistent reviewed dimensions', () => {
    expect(comparisonEvidenceReady(verified())).toBe(true);
    expect(comparisonAdvantageLabel('EXPECTED_NET_RETURN_PCT_HIGHER')).toBe('预期净收益更高');
    expect(comparisonAdvantageLabel('DOWNSIDE_RISK_PCT_LOWER')).toBe('下行风险更低');
    expect(comparisonAdvantageLabel('UNKNOWN')).toBe('');
  });
  it('withholds legacy flags and contradictory or incomplete data', () => {
    const original = verified();
    const rows = [
      {...verified(), decision_eligible: false},
      {...verified(), comparison_metrics: undefined},
      {...verified(), comparison_basis_label: ''},
      {...verified(), governance_reasons: ['BLOCKED']},
      {...verified(), candidate_advantages: ['DOWNSIDE_RISK_PCT_LOWER']},
      {...verified(), alternative_advantages: []},
      {...verified(), comparison_metrics: [original.comparison_metrics![0], ...original.comparison_metrics!.slice(0, 3)]},
      {...verified(), comparison_metrics: original.comparison_metrics!.map((item, i) => i === 0 ? {...item, candidate_value: NaN} : item)},
      {...verified(), comparison_metrics: original.comparison_metrics!.map((item, i) => i === 1 ? {...item, alternative_value: -2} : item)},
      {...verified(), comparison_metrics: original.comparison_metrics!.map((item, i) => i === 2 ? {...item, unit: '%'} : item)},
      {...verified(), comparison_metrics: original.comparison_metrics!.map((item, i) => i === 3 ? {...item, definition: ' '} : item)},
    ];
    rows.forEach(row => expect(comparisonEvidenceReady(row)).toBe(false));
  });
  it('keeps exact ties neutral and permits reviewed negative marginal risk', () => {
    const row = verified();
    row.comparison_metrics![3] = {...row.comparison_metrics![3], candidate_value: -1, alternative_value: -1};
    row.alternative_advantages.pop();
    expect(comparisonEvidenceReady(row)).toBe(true);
  });
});
