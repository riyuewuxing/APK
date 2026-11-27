import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(path.resolve(process.env.PW_ROOT||'/tmp/pw','node_modules','playwright'));
const base=process.env.R08_BASE||'http://127.0.0.1:8502';
const out=process.env.R08_OUT||'e2e_artifacts_ui';
fs.mkdirSync(out,{recursive:true});
const safe={research_only:true,execution_allowed:false};
const scan={task_type:'EOD_SCAN_1445',trade_date:'2024-01-02',triggered_at:'2024-01-02T14:45:00+08:00',observation_finished_at:'2024-01-02T14:46:00+08:00',
  status:'OK',scan_status:'OBSERVED',regime:'GREEN',candidate_count:0,scan_coverage:{scope_count:10,quote_valid_count:10,basic_match_count:0,examined_count:0,unavailable_count:0}};
const post={task_type:'POST_CLOSE_1535',trade_date:'2024-01-02',triggered_at:'2024-01-02T15:35:00+08:00',status:'DEGRADED',
  post_close_review:{trade_date:'2024-01-02',observed_at:'2024-01-02T15:36:00+08:00',after_market_close:true,coverage_status:'PARTIAL',
    target_count:10,rule_scan_count:8,same_day_quote_count:6,current_red_subject_count:1,current_unknown_or_missing_rule_count:3},
  ai_summary:{...safe,status:'TIMED_OUT',context_scope:'AGGREGATE_RULE_OBSERVATIONS_ONLY',admission_status:'NOT_ADMITTED'}};
const stock={as_of:'2024-01-02',snapshot_id:'a'.repeat(64),book_status:'EMPTY',valuation_basis:'LEDGER_REFERENCE_PRICES_NOT_LIVE_MARKET'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const report=[];
const assert=async (loc,value)=>{const t=await loc.innerText();if(!t.includes(value))throw Error('missing '+value+' in '+t);};
try{
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
    const context=await browser.newContext({viewport,deviceScaleFactor:1});
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
    let mode='timeout';
    let providerCalls=0;
    await context.route('**/api/ai/**',route=>{providerCalls++;return route.abort()});
    await context.route('**/api/scheduler/status',async route=>{
      if(route.request().method()!=='GET')throw Error('non-readonly scheduler access');
      if(mode==='offline')return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"synthetic offline"}'});
      const p=structuredClone(post),s=structuredClone(scan);
      if(mode==='missing')delete p.ai_summary;
      if(mode==='ready')p.ai_summary.status='COMPLETED';
      if(mode==='not-configured')p.ai_summary.status='NOT_CONFIGURED';
      if(mode==='failure')p.status='ERROR';
      if(mode==='legacy')s.scan_coverage=null;
      return route.fulfill({json:{...safe,recent_runs:[p,s]}});
    });
    await context.route('**/api/workbench',async route=>{
      if(route.request().method()!=='GET')throw Error('non-readonly workbench access');
      const a=structuredClone(stock);
      if(mode==='ready'){a.snapshot_id='b'.repeat(64);a.book_status='ACTIVE';}
      if(mode==='legacy')a.book_status='SEEDED_DEFAULT';
      return route.fulfill({json:{...safe,stock_account:a,fund_account:{as_of:'2024-01-01'}}});
    });
    const page=await context.newPage();
    await page.clock.setFixedTime(new Date('2024-01-02T09:00:00Z'));
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:15000});
    const cockpit=page.getByTestId('decision-cockpit');
    const scanCard=cockpit.getByTestId('cockpit-scan');
    const review=cockpit.getByTestId('cockpit-review');
    const ai=cockpit.getByTestId('cockpit-ai-status');
    const account=cockpit.getByTestId('cockpit-account');
    const waitText=async(loc,t)=>loc.getByText(t,{exact:false}).first().waitFor({state:'visible',timeout:15000});
    await cockpit.waitFor({state:'visible',timeout:15000});
    await waitText(ai,'AI 超时');
    await assert(scanCard,'候选 0');await assert(review,'未知或缺失规则 3');await assert(account,'股票台账记录为空');
    const size=await page.evaluate(()=>({w:innerWidth,sw:document.documentElement.scrollWidth}));
    if(size.sw>size.w+2)throw Error('cockpit overflow '+JSON.stringify(size));
    await cockpit.scrollIntoViewIfNeeded();
    const shot=await cockpit.screenshot({type:'jpeg',quality:65});
    const name='r08_cockpit_'+viewport.width+'.jpg';
    fs.writeFileSync(path.join(out,name),shot);
    const digest=crypto.createHash('sha256').update(shot).digest('hex');
    if(shot.length<=150000){const b64=shot.toString('base64');for(let i=0;i<b64.length;i+=5000)console.log('R08_COCKPIT_IMAGE '+name+' '+(i/5000)+' '+b64.slice(i,i+5000));}
    let revision=0;
    const refresh=async()=>{revision++;await cockpit.getByRole('button',{name:'重新读取',exact:true}).click();await page.locator(`[data-testid=decision-cockpit][data-read-revision="${revision}"]`).waitFor({state:'visible',timeout:15000});};
    mode='offline';await refresh();await waitText(scanCard,'候选数未知');await waitText(review,'覆盖未知');await waitText(account,'股票台账记录为空');
    if((await scanCard.innerText()).includes('候选 0'))throw Error('stale zero shown');
    mode='ready';await refresh();await waitText(ai,'非事实准入');await waitText(account,'bbbbbbbbbbbb');
    await assert(review,'规则扫描 8/10');
    mode='not-configured';await refresh();await waitText(ai,'模型未就绪');await assert(review,'规则扫描 8/10');
    mode='missing';await refresh();await waitText(ai,'状态未知');await assert(review,'规则扫描 8/10');
    mode='failure';await refresh();await waitText(review,'覆盖未知');
    mode='legacy';await refresh();await waitText(scanCard,'候选数未知');await waitText(account,'不沿用历史或演示账户');
    if(errors.length||providerCalls)throw Error('unexpected page error/provider calls '+JSON.stringify({errors,providerCalls}));
    report.push({viewport,scope:'SYNTHETIC_UI_ONLY',image:name,bytes:shot.length,sha256:digest,
      observedZero:true,aiTimeout:true,aiCompletedResearchOnly:true,aiNotConfigured:true,aiUnknown:true,offlineIndependentAccount:true,latestFailureWithheld:true,referenceAccountVersion:true,noOverflow:true,providerCalls});
    await context.close();
  }
}finally{await browser.close()}
fs.writeFileSync(path.join(out,'r08_cockpit_report.json'),JSON.stringify(report,null,2));
console.log('R08_COCKPIT_REPORT '+JSON.stringify(report));
