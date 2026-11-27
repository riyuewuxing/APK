import { describe, expect, it } from 'vitest';
import { DeferredResearchUiActions, researchPriceBindingReady } from './researchUiGate';

describe('deferred research UI actions (synthetic)', () => {
  it('only releases once, after coherent meta and successful terminal', () => {
    const gate = new DeferredResearchUiActions<string>();
    expect(() => new DeferredResearchUiActions<string>().queue('before-meta')).toThrow();
    gate.acceptMetadata(true, false);
    gate.queue('after-meta');
    gate.finish(true);
    expect(gate.release(false)).toEqual(['after-meta']);
    expect(gate.release(false)).toEqual([]);
  });
  it('failure, incomplete transport and cancellation discard pending actions', () => {
    for (const mode of ['fail','incomplete','abort']) {
      const gate = new DeferredResearchUiActions<string>();
      gate.acceptMetadata(true, false);
      gate.queue('pending');
      if (mode === 'fail') gate.finish(false);
      if (mode === 'abort') gate.finish(true);
      expect(gate.release(mode === 'abort')).toEqual([]);
      expect(gate.isSuccessful()).toBe(false);
    }
  });
  it('rejects unsafe meta, success without meta, duplicate meta and error then success', () => {
    expect(() => new DeferredResearchUiActions().acceptMetadata(true,true)).toThrow();
    expect(() => new DeferredResearchUiActions().finish(true)).toThrow();
    const gate = new DeferredResearchUiActions();
    gate.acceptMetadata(true, false);
    expect(() => gate.acceptMetadata(true,false)).toThrow();
    expect(() => gate.finish(true)).toThrow();
    expect(gate.release(false)).toEqual([]);
  });
  it('requires explicit positive evidence binding, not an absent pending flag', () => {
    const binding = {evidence_status:'VERIFIED',pending_verification:false,adjustment_verified:true,observation_as_of:'2024-01-02'};
    expect(researchPriceBindingReady(binding)).toBe(true);
    expect(researchPriceBindingReady(undefined)).toBe(false);
    expect(researchPriceBindingReady({...binding,pending_verification:true})).toBe(false);
    expect(researchPriceBindingReady({...binding,evidence_status:'STALE'})).toBe(false);
    expect(researchPriceBindingReady({...binding,adjustment_verified:false})).toBe(false);
    expect(researchPriceBindingReady({...binding,observation_as_of:null})).toBe(false);
  });
});
