// Version equality is an observation binding, never a claim of live-account admission.
export type ObservationVersions = Record<string, {snapshot_id?: string | null; status?: string | null}>;
export type ExpectedVersions = Record<string, string | null | undefined>;
const valid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
export function versionsMatch(observed: ObservationVersions | undefined, expected: ExpectedVersions, required: string[]): boolean {
  if (!observed || required.some(k => !Object.hasOwn(observed, k))) return false;
  return Object.entries(observed).every(([k, v]) => Object.hasOwn(expected,k) && valid(expected[k]) && valid(v?.snapshot_id) && expected[k] === v.snapshot_id);
}
export function researchBindingMatches(card: {account_snapshot_id?: string | null; account_snapshots?: ObservationVersions; request_mode?: string}, expected: ExpectedVersions, liveStock: boolean): boolean {
  return card.request_mode === (liveStock ? 'EXPLICIT_CURRENT_STOCK_REQUEST' : 'DEFAULT_REFERENCE_ROUTE')
    && card.account_snapshot_id === expected['STK-ALIPAY-001']
    && versionsMatch(card.account_snapshots, expected, ['STK-ALIPAY-001']);
}
export function reportBindingMatches(report: {account_id?: string; account_snapshot_id?: string | null}, account: string, expected: ExpectedVersions): boolean {
  return report.account_id === account && valid(expected[account]) && report.account_snapshot_id === expected[account];
}
export function debateReviewCurrent(report: {subject_review_status?: string | null; subject_review_valid_until?: string | null}, now: number): boolean {
  if (!report.subject_review_status) return true;
  if (['REVIEW_EXPIRED','EXPIRED','REVIEW_INVALID','SUBJECT_REVIEW_EXPIRED','SUBJECT_REVIEW_INVALID'].includes(report.subject_review_status)) return false;
  if (!['REVIEW_VERIFIED','REVIEW_GAPS'].includes(report.subject_review_status)) return true;
  const expiry = Date.parse(report.subject_review_valid_until ?? '');
  return Number.isFinite(expiry) && now < expiry;
}
