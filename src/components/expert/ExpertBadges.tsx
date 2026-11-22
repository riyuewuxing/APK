import { ShieldCheck, Lock } from 'lucide-react';
import {
  ACTION_META,
  type DecisionAction,
  type GlobalGovernanceStatus,
  type ProvenanceBadge,
} from '@/services/expertApi';
import styles from './ExpertBadges.module.css';

interface ActionDecisionPillProps {
  action: DecisionAction;
  showZh?: boolean;
}

export function ActionDecisionPill({ action, showZh = true }: ActionDecisionPillProps) {
  const meta = ACTION_META[action] ?? ACTION_META.INSUFFICIENT_EVIDENCE;
  return (
    <span className={`${styles.actionPill} ${styles[`tone-${meta.tone}`]}`}>
      <span>{meta.shortLabel}</span>
      {showZh && <span>{meta.labelZh}</span>}
    </span>
  );
}

interface ProvenancePillProps {
  badge: ProvenanceBadge;
  compact?: boolean;
  variant?: 'pill' | 'subtle';
}

export function ProvenancePill({
  badge,
  compact = false,
  variant = 'pill',
}: ProvenancePillProps) {
  const statusClass =
    badge.verification_status === 'SUPPORTED'
      ? styles.statusSupported
      : badge.verification_status === 'REJECTED' || badge.verification_status === 'CONFLICTED'
        ? styles.statusDanger
        : styles.statusWarn;

  return (
    <span
      className={variant === 'subtle' ? styles.provenanceSubtle : styles.provenancePill}
      title={`Claim: ${badge.claim_id ?? 'N/A'}`}
    >
      <span className={styles.provenanceSource}>{badge.source_id}</span>
      <span className={styles.provenanceSep}>·</span>
      <span className="font-mono">{badge.as_of}</span>
      {!compact && (
        <>
          <span className={styles.provenanceSep}>·</span>
          <span>可信度 {badge.confidence}</span>
          <span className={styles.provenanceSep}>·</span>
          <span>{badge.crosscheck_status}</span>
        </>
      )}
      <span className={styles.provenanceSep}>·</span>
      <span className={statusClass}>{badge.verification_status}</span>
    </span>
  );
}

interface GovernanceBannerProps {
  governance: GlobalGovernanceStatus;
}

export function GovernanceBanner({ governance }: GovernanceBannerProps) {
  const ledgerOk = governance.ledger_status.includes('VERIFIED');
  return (
    <div className={styles.lockBanner}>
      <div className={styles.lockGroup}>
        <span className={styles.lockChip}>PIT 截止：{governance.pit_cutoff_summary}</span>
        <span className={`${styles.lockChip} ${ledgerOk ? styles.lockSafe : ''}`}>
          <ShieldCheck size={13} />
          <span>
            ClaimLedger: {governance.ledger_status} ({governance.ledger_sha256_short})
          </span>
        </span>
        <span className={styles.lockChip}>校验：{governance.crosscheck_summary}</span>
      </div>
      <div className={`${styles.lockChip} ${styles.lockSafe}`}>
        <Lock size={13} />
        <span>{governance.execution_lock_label}</span>
      </div>
    </div>
  );
}

