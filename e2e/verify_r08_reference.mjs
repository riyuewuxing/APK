import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(process.env.PW_ROOT || '/tmp/pw', 'node_modules', 'playwright'));
const base = process.env.R08_BASE || 'http://127.0.0.1:8502';
const out = process.env.R08_OUT || 'e2e_artifacts_ui';
fs.mkdirSync(out, { recursive: true });
const stats = (n, obs, rate) => ({
  sample_count: n, settled_count: obs, statistics_basis: 'RAW_REFERENCE_GROSS_NOT_TRADE_WIN_RATE',
  legacy_excluded_count: 0, t1_open_observation_count: obs, t1_close_observation_count: 0,
  t3_close_observation_count: 0, t1_open_win_rate_pct: rate,
  t1_close_win_rate_pct: null, t3_close_win_rate_pct: null, avg_open_premium_pct: null,
  profit_loss_ratio: null,
});
const payload = {
  snapshots: [], stats: {
    generated_at: '2024-01-05T00:00:00Z', snapshot_count: 2, candidate_count: 2,
    research_only: true, execution_allowed: false,
    statistics_scope: 'MIXED_CLIENT_REFERENCE_NOT_VALIDATED_FORECAST',
    model_validation_status: 'NOT_VALIDATED', probability_calibrated: false,
    schemes: [{ scheme_name: '[DEMO] 合成参考价记录', overall: stats(2, 1, 0), by_regime: {},
      same_day_server_recorded_reference: stats(1, 1, 0),
      retrospective_or_unverified_reference: stats(1, 0, null) }],
  }, journal_path: 'synthetic-only', research_only: true, execution_allowed: false,
};
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const report = [];
try {
  for (const viewport of [{width: 1440,height: 900},{width: 390,height: 844}]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
      ? route.continue() : route.abort());
    let mode = 'split';
    await context.route('**/api/eod/journal', async route => {
      if (mode === 'error') return route.fulfill({status: 503, contentType: 'application/json', body: '{"detail":"synthetic unavailable"}'});
      const body = structuredClone(payload);
      if (mode === 'legacy') delete body.stats.statistics_scope;
      return route.fulfill({json: body});
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base + '/eod-picker', {waitUntil: 'domcontentloaded', timeout: 15000});
    const history = page.getByText('历史参考价验证', {exact: true});
    await history.click({timeout: 15000});
    const groups = page.getByTestId('eod-reference-groups');
    await groups.waitFor({state: 'visible',timeout: 15000});
    const groupText = await groups.innerText();
    for (const text of ['交易日当天服务端记录','事后 / 时间来源未验证','0.0% · 观察 1/1','N/A · 观察 0/1','均未验证预测能力']) {
      if (!groupText.includes(text)) throw Error('missing R08 field: ' + text + '\n' + groupText);
    }
    const size = await page.evaluate(() => ({w: innerWidth, sw: document.documentElement.scrollWidth}));
    if (size.sw > size.w+2) throw Error('horizontal overflow: '+JSON.stringify(size));
    await groups.scrollIntoViewIfNeeded();
    const shot = await groups.screenshot({type: 'jpeg', quality: 65});
    const name = 'r08_reference_' + viewport.width + '.jpg';
    fs.writeFileSync(path.join(out,name), shot);
    const digest = crypto.createHash('sha256').update(shot).digest('hex');
    // Actual rendered crop of synthetic-only data; bounded inline evidence, independent of artifact quota.
    if (shot.length <= 150000) {
      const b64 = shot.toString('base64');
      for(let i=0; i<b64.length; i+=5000) console.log('R08_IMAGE '+name+' '+(i/5000)+' '+b64.slice(i,i+5000));
    }
    mode = 'legacy';
    await page.getByText('尾盘筛选与安检', {exact: true}).last().click();
    await history.click();
    await page.getByTestId('eod-reference-groups-unavailable').waitFor({state:'visible',timeout:10000});
    mode = 'error';
    await page.getByText('尾盘筛选与安检', {exact: true}).last().click();
    await history.click();
    await page.getByTestId('eod-journal-unavailable').waitFor({state:'visible',timeout:10000});
    if (await groups.count()) throw Error('stale groups shown after failure');
    mode = 'split';
    await page.getByText('重新读取账本', {exact:true}).click();
    await groups.waitFor({state:'visible',timeout:10000});
    if (errors.length) throw Error('page errors: '+JSON.stringify(errors));
    report.push({viewport, scope:'SYNTHETIC_UI_ONLY', image:name, bytes:shot.length, sha256:digest, split:true, nullVsZero:true, legacyWithheld:true, errorRecovery:true, noOverflow:true});
    await context.close();
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(out,'r08_reference_report.json'),JSON.stringify(report,null,2));
console.log('R08_REFERENCE_REPORT '+JSON.stringify(report));
