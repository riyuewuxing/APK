import { describe, expect, it } from 'vitest';
import { guardSubjectReview, type DeepResearchCard } from './expertApi';

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
