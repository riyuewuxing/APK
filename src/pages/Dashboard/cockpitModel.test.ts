import { describe,expect,it } from 'vitest';
import { chinaDay,projectDecisionCockpit } from './cockpitModel';
const now=Date.parse('2024-01-02T09:00:00Z');
const safe={research_only:true,execution_allowed:false};
const scan={task_type:'EOD_SCAN_1445',trade_date:'2024-01-02',triggered_at:'2024-01-02T14:45:00+08:00',
  observation_finished_at:'2024-01-02T14:46:00+08:00',status:'OK',scan_status:'OBSERVED',regime:'GREEN',
  candidate_count:0,scan_coverage:{scope_count:10,quote_valid_count:10,basic_match_count:0,examined_count:0,unavailable_count:0}};
const post={task_type:'POST_CLOSE_1535',trade_date:'2024-01-02',triggered_at:'2024-01-02T15:35:00+08:00',status:'OK',
  post_close_review:{trade_date:'2024-01-02',observed_at:'2024-01-02T15:36:00+08:00',after_market_close:true,
    coverage_status:'PARTIAL',target_count:10,rule_scan_count:8,same_day_quote_count:6,current_red_subject_count:1,current_unknown_or_missing_rule_count:3},
  ai_summary:{...safe,status:'TIMED_OUT',context_scope:'AGGREGATE_RULE_OBSERVATIONS_ONLY',admission_status:'NOT_ADMITTED'}};
const s={...safe,recent_runs:[post,scan]};
const a={...safe,stock_account:{as_of:'2024-01-02',snapshot_id:'a'.repeat(64),book_status:'EMPTY',valuation_basis:'LEDGER_REFERENCE_PRICES_NOT_LIVE_MARKET'},fund_account:{as_of:'2024-01-01'}};
describe('read-only cockpit synthetic evidence boundaries',()=>{
  it('keeps observed zero, risk coverage and AI timeout separate',()=>{
    const p=projectDecisionCockpit(s,a,now);
    expect(p.scan.status).toBe('OBSERVED');expect(p.scan.text).toContain('候选 0');
    expect(p.review.status).toBe('OBSERVED');expect(p.review.text).toContain('未知或缺失规则 3');
    expect(p.aiLabel).toBe('AI 超时');expect(p.account.stockState).toBe('EMPTY');
  });
  it('never falls back from latest failure to older success',()=>{
    const p=projectDecisionCockpit({...s,recent_runs:[{...post,status:'ERROR'},post,{...scan,status:'ERROR'},scan]},null,now);
    expect(p.scan.status).toBe('UNKNOWN');expect(p.review.status).toBe('UNKNOWN');
    expect(p.scan.text).not.toContain('候选 0');expect(p.account.stockId).toBeNull();
  });
  it('withholds stale, future, missing coverage and unsafe data',()=>{
    expect(chinaDay(Date.parse('2024-01-01T16:05:00Z'))).toBe('2024-01-02');
    expect(projectDecisionCockpit(s,a,now+86400000).scan.status).toBe('HISTORICAL');
    expect(projectDecisionCockpit(s,a,now-86400000).scan.status).toBe('UNKNOWN');
    expect(projectDecisionCockpit({...s,recent_runs:[{...scan,scan_coverage:null}]},a,now).scan.status).toBe('UNKNOWN');
    expect(projectDecisionCockpit({...s,execution_allowed:true},a,now).scan.status).toBe('UNKNOWN');
    expect(projectDecisionCockpit(s,{...a,stock_account:{...a.stock_account,book_status:'SEEDED_DEFAULT'}},now).account.stockState).toBeNull();
  });
});
