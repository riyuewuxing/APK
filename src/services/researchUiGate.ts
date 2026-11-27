/** Generic in-memory gate for non-authoritative UI actions from a streamed research turn.
 * It never executes actions, trusts no model text, and releases once only after
 * the transport resolved with a coherent terminal receipt. Not fact admission.
 */
export class DeferredResearchUiActions<T> {
  private state: 'OPEN' | 'SUCCESS' | 'FAILED' | 'RELEASED' = 'OPEN';
  private metadataSeen = false;
  private pending: T[] = [];

  acceptMetadata(researchOnly: unknown, executionAllowed: unknown): void {
    if (this.state !== 'OPEN' || this.metadataSeen || researchOnly !== true || executionAllowed !== false) {
      this.fail();
      throw new Error('AI 研究边界或元信息冲突');
    }
    this.metadataSeen = true;
  }

  queue(action: T): void {
    if (this.state !== 'OPEN' || !this.metadataSeen) {
      this.fail();
      throw new Error('AI 动作缺少有效研究元信息');
    }
    this.pending.push(action);
  }

  fail(): void {
    this.state = 'FAILED';
    this.pending = [];
  }

  finish(ok: unknown): void {
    if (ok === false) { this.fail(); return; }
    if (ok !== true || !this.metadataSeen || this.state !== 'OPEN') {
      this.fail();
      throw new Error('AI 完成回执缺失或冲突');
    }
    this.state = 'SUCCESS';
  }

  release(aborted: boolean): T[] {
    if (this.state === 'RELEASED') return [];
    if (aborted || this.state !== 'SUCCESS') { this.fail(); return []; }
    this.state = 'RELEASED';
    const actions = this.pending;
    this.pending = [];
    return actions;
  }

  isSuccessful(): boolean {
    return this.state === 'SUCCESS' || this.state === 'RELEASED';
  }
}

/** Missing binding never counts as a verified numeric overlay. */
export function researchPriceBindingReady(binding: {
  evidence_status: string; pending_verification: boolean; adjustment_verified?: boolean;
  observation_as_of?: string | null;
} | null | undefined): boolean {
  return binding?.evidence_status === 'VERIFIED' && binding.pending_verification === false
    && binding.adjustment_verified === true && typeof binding.observation_as_of === 'string'
    && binding.observation_as_of.trim() !== '';
}
