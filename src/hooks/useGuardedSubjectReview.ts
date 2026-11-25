import { useEffect, useState } from 'react';
import { guardSubjectReview, type DeepResearchCard } from '@/services/expertApi';

/** Re-evaluate a displayed review at expiry even if the user leaves the page open. */
export function useGuardedSubjectReview(card: DeepResearchCard | null): DeepResearchCard | null {
  const [tick, setTick] = useState(0);
  const status = card?.subject_review_status;
  const expiry = Date.parse(card?.subject_review_valid_until ?? '');
  useEffect(() => {
    if (status !== 'REVIEW_VERIFIED' && status !== 'REVIEW_GAPS') return;
    const delay = expiry - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) return;
    const timer = setTimeout(() => setTick(value => value + 1), Math.min(delay + 1, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [status, expiry, tick]);
  return card ? guardSubjectReview(card, Date.now(), true) : null;
}
