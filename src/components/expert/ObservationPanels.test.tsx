import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarketCoveragePanel, marketCoverageState, PredictionObservationContent } from './ObservationPanels';

const clock=Date.parse('2026-01-08T09:00:00Z');
const coverage=()=>({
  status:'PARTIAL_WARN',observed_day:'2026-01-08',oldest_log_at:'2026-01-08T08:00:00Z',latest_log_at:'2026-01-08T08:30:00Z',
  reason:'synthetic public projection',source_ref:'fixture',research_only:true,execution_allowed:false,formal_admission:false,
  rows:[{asset:'ETF',denominator:20,available:10,eligible:8,matches:2,comparison_day:'2026-01-07',
    observed_day_eligible:1,observed_day_matches:0,scope_note:'fixture',source_run:1}],
  asset_issues:[{asset:'A股',status:'UNAVAILABLE'}],industries:[],industry_dates:[],
});
const prediction=()=>({
  scope:'RETAINED_PUBLIC_CONTROL_NOT_PRIVATE_EVENT_LEDGER',evaluated_at:'2026-01-08T08:30:00Z',
  model_validation_status:'NOT_VALIDATED',probability_calibrated:false,private_event_chain_verified:false,
  original_vendor_bytes_verified:false,research_only:true,execution_allowed:false,decision_authority:false,model_promotion_allowed:false,
  pilot:{status:'RETAINED_TERMINAL',normalized_receipt_pins_match:true,first_attempt_provenance_reverified_at_runtime:false,
    retry_authorized:false,target:'2026-01-07',symbol:'000001',direction:'UP',outcome_status:'UNAVAILABLE',
    observed_at:'2026-01-07T08:00:00Z',selected_count:1,evaluable_count:0,accuracy:null,flat_accuracy:null,
    accuracy_bounds:[0,1],paired_diagnostics:{selected_paired_accuracy_delta_bounds:[-1,1]}},
  cohort:{status:'PREREGISTERED_NOT_STARTED',protocol_pin_matches:true,receipt_index_verified:false,
    activation_authorized:false,retry_authorized:false,backfill_authorized:false,first:'2026-01-12',last:'2026-01-13',
    symbols:['000001','000002'],expected_sessions:2,expected_slots:4,first_planning_at:'2026-01-11T00:00:00+08:00',evaluable_count:0},
});
describe('R12 public observation display',()=>{
  it('keeps comparison and observation days separate, partial asset unknown, true sample zero',()=>{
    const h=renderToStaticMarkup(<MarketCoveragePanel coverage={coverage()} clock={clock}/>);
    expect(h).toContain('部分资产可观察');expect(h).toContain('2026-01-07');expect(h).toContain('1 / 0（仅样本内）');
    expect(h).toContain('A股：未知');expect(h).toContain('不代表全市场零机会');
  });
  it('downgrades offline or expired coverage and rejects future/unsafe or duplicate assets',()=>{
    expect(marketCoverageState(coverage(),clock,true).status).toBe('STALE');
    expect(marketCoverageState(coverage(),clock+86400000,false).status).toBe('STALE');
    expect(marketCoverageState({...coverage(),latest_log_at:'2026-01-09T08:00:00Z'},clock,false).status).toBe('INVALID');
    expect(marketCoverageState({...coverage(),formal_admission:true},clock,false).status).toBe('INVALID');
    expect(marketCoverageState({...coverage(),asset_issues:[{asset:'ETF',status:'INVALID'}]},clock,false).status).toBe('INVALID');
    expect(marketCoverageState(null,clock,false).status).toBe('UNAVAILABLE');
  });
  it('renders missing outcome as unknown accuracy and descriptive ranges, never zero accuracy',()=>{
    const h=renderToStaticMarkup(<PredictionObservationContent value={prediction()} clock={clock}/>);
    expect(h).toContain('NOT_VALIDATED');expect(h).toContain('0 / 1');expect(h).toContain('未知');
    expect(h).toContain('UNAVAILABLE');expect(h).toContain('[0%, 100%]');expect(h).toContain('[-100%, 100%]');
    expect(h).toContain('等待计划窗口');expect(h).toContain('4 个预期观察槽');
  });
  it('does not show a zero future cohort after its first planning time',()=>{
    const h=renderToStaticMarkup(<PredictionObservationContent value={prediction()} clock={Date.parse('2026-01-11T00:00:00Z')}/>);
    expect(h).toContain('可评估数量未知');expect(h).not.toContain('0 个可评估');
  });
  it('refuses authority and missing outcome with forged zero accuracy',()=>{
    const bad=prediction();
    expect(renderToStaticMarkup(<PredictionObservationContent value={{...bad,decision_authority:true}} clock={clock}/>)).not.toContain('UNAVAILABLE');
    const forged={...bad,pilot:{...bad.pilot,accuracy:0}};
    expect(renderToStaticMarkup(<PredictionObservationContent value={forged} clock={clock}/>)).toContain('无可核验终局回执');
  });
});
