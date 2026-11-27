import { describe, expect, it } from 'vitest';
import { versionsMatch, researchBindingMatches, reportBindingMatches, debateReviewCurrent } from './accountObservationBinding';
const s='a'.repeat(64), f='b'.repeat(64), expected={'STK-ALIPAY-001':s,'FND-TIANTIAN-002':f};
const both={'STK-ALIPAY-001':{snapshot_id:s},'FND-TIANTIAN-002':{snapshot_id:f}};
describe('independent account observation versions',()=>{
 it('binds both, rejects a changed or missing fund version',()=>{
  expect(versionsMatch(both,expected,Object.keys(expected))).toBe(true);
  expect(versionsMatch({...both,'FND-TIANTIAN-002':{snapshot_id:s}},expected,Object.keys(expected))).toBe(false);
  expect(versionsMatch({'STK-ALIPAY-001':both['STK-ALIPAY-001']},expected,Object.keys(expected))).toBe(false);
 });
 it('rejects missing expected identity and unknown account keys',()=>{
  expect(versionsMatch(both,{'STK-ALIPAY-001':s},['STK-ALIPAY-001'])).toBe(false);
  expect(versionsMatch({...both,OTHER:{snapshot_id:s}},expected,[])).toBe(false);
  expect(versionsMatch({'FND-TIANTIAN-002':both['FND-TIANTIAN-002']},expected,['FND-TIANTIAN-002'])).toBe(true);
 });
 it('requires explicit request mode and no mismatched legacy ID',()=>{
  const card={account_snapshot_id:s,account_snapshots:both,request_mode:'DEFAULT_REFERENCE_ROUTE'};
  expect(researchBindingMatches(card,expected,false)).toBe(true);
  expect(researchBindingMatches(card,expected,true)).toBe(false);
  expect(researchBindingMatches({...card,request_mode:'EXPLICIT_CURRENT_STOCK_REQUEST'},expected,true)).toBe(true);
  expect(researchBindingMatches({...card,account_snapshot_id:f},expected,false)).toBe(false);
  expect(researchBindingMatches({...card,account_snapshots:undefined},expected,false)).toBe(false);
 });
 it('matches report account and version together',()=>{
  expect(reportBindingMatches({account_id:'FND-TIANTIAN-002',account_snapshot_id:f},'FND-TIANTIAN-002',expected)).toBe(true);
  expect(reportBindingMatches({account_id:'STK-ALIPAY-001',account_snapshot_id:f},'FND-TIANTIAN-002',expected)).toBe(false);
  expect(reportBindingMatches({account_id:'FND-TIANTIAN-002'},'FND-TIANTIAN-002',{})).toBe(false);
 });
 it('withdraws expired reviews at the boundary',()=>{
  const r={subject_review_status:'REVIEW_VERIFIED',subject_review_valid_until:'2026-11-27T00:00:00Z'};
  const t=Date.parse(r.subject_review_valid_until);
  expect(debateReviewCurrent(r,t-1)).toBe(true);
  expect(debateReviewCurrent(r,t)).toBe(false);
  expect(debateReviewCurrent({...r,subject_review_valid_until:null},t)).toBe(false);
  expect(debateReviewCurrent({...r,subject_review_status:'SUBJECT_REVIEW_EXPIRED'},t-1)).toBe(false);
  expect(debateReviewCurrent({...r,subject_review_status:'SUBJECT_REVIEW_INVALID'},t-1)).toBe(false);
 });
});
