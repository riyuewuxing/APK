import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pwDir = process.env.PW_ROOT;
let chromium;
try {
  ({ chromium } = pwDir
    ? require(path.resolve(pwDir, 'node_modules', 'playwright'))
    : require('playwright'));
} catch {
  ({ chromium } = pwDir
    ? require(path.resolve(pwDir, 'node_modules', 'playwright-core'))
    : require('playwright-core'));
}

function parseArgs(argv) {
  const out = { baseUrl: 'http://127.0.0.1:8502', outDir: 'e2e_artifacts_ui' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base-url' && argv[i + 1]) out.baseUrl = argv[++i];
    if (argv[i] === '--out-dir' && argv[i + 1]) out.outDir = argv[++i];
  }
  return out;
}

function buildTencentQuoteBody(rawUrl) {
  const u = new URL(rawUrl);
  const q = u.searchParams.get('q') || 'sh600900';
  const codes = q.split(',').map((s) => s.trim()).filter(Boolean);
  return codes
    .map((code) => {
      const bare = code.replace(/^(sh|sz|bj|hk)/i, '');
      const f = new Array(55).fill('0');
      f[0] = '1';
      f[1] = `Demo_${bare}`;
      f[2] = bare;
      f[3] = '28.50';
      f[4] = '28.20';
      f[5] = '28.30';
      f[6] = '120000';
      f[30] = '20261113150000';
      f[31] = '0.30';
      f[32] = '1.06';
      f[33] = '28.60';
      f[34] = '28.10';
      f[37] = '34200';
      f[38] = '0.52';
      f[39] = '18.5';
      f[44] = '6800.0';
      f[45] = '6800.0';
      f[46] = '2.80';
      f[47] = '31.02';
      f[48] = '25.38';
      return `v_${code}="${f.join('~')}";`;
    })
    .join('\n');
}

function buildTradingDates(count = 60) {
  const dates = [];
  const cur = new Date('2026-11-13T00:00:00Z');
  while (dates.length < count) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.unshift(cur.toISOString().slice(0, 10));
    }
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return dates;
}

const TRADING_DATES = buildTradingDates(60);

function handleExternalQuoteRoute(route) {
  const reqUrl = route.request().url();
  const u = new URL(reqUrl);
  const host = u.hostname.toLowerCase();

  if (host === 'qt.gtimg.cn') {
    return route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=gbk',
      body: buildTencentQuoteBody(reqUrl),
    });
  }

  if (host.includes('linkdiary.cn')) {
    const p = u.pathname.toLowerCase();
    if (p.includes('trade-data-list')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: TRADING_DATES.join(','),
      });
    }
    let codeList = ['sh600900', 'sz300476', 'sh600426', 'sz000001', 'sh601318', 'sh600519'];
    if (p.includes('us_list')) codeList = ['105.AAPL', '105.MSFT'];
    else if (p.includes('hk_list')) codeList = ['00700', '09988'];
    else if (p.includes('fund_list')) codeList = ['sh510300', 'sz159915'];
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ success: true, list: codeList }),
    });
  }

  if (host.includes('ifzq.gtimg.cn')) {
    const param = u.searchParams.get('param') || u.searchParams.get('code') || 'sh600900';
    const sym = param.split(',')[0] || 'sh600900';
    const dayBars = TRADING_DATES.slice(-20).map((dt, idx) => [
      dt,
      (27.5 + idx * 0.05).toFixed(2),
      (27.7 + idx * 0.05).toFixed(2),
      (28.0 + idx * 0.05).toFixed(2),
      (27.3 + idx * 0.05).toFixed(2),
      String(100000 + idx * 1200),
    ]);
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        code: 0,
        msg: '',
        data: {
          [sym]: {
            qfqday: dayBars,
            day: dayBars,
            data: { data: ['0930 28.20 1000 2820000', '1500 28.50 1200 3420000'], date: '20261113' },
            qt: { [sym]: ['1', 'Demo', sym.slice(-6), '28.50', '28.20'] },
          },
        },
      }),
    });
  }

  const klineRows = TRADING_DATES.map((dt, idx) => {
    const open = (26.8 + idx * 0.03).toFixed(2);
    const close = (26.95 + idx * 0.03).toFixed(2);
    const high = (27.15 + idx * 0.03).toFixed(2);
    const low = (26.65 + idx * 0.03).toFixed(2);
    const vol = 90000 + idx * 1000;
    const amt = Math.round(vol * 28);
    return `${dt},${open},${close},${high},${low},${vol},${amt},1.85,0.56,0.15,0.42`;
  });

  const payload = {
    rc: 0,
    rt: 6,
    data: {
      code: '600900',
      name: 'Demo',
      total: 1,
      diff: [],
      klines: klineRows,
      trends: ['2026-11-13 09:30,28.20,28.20,28.20,28.20,1000,28200,28.20'],
    },
    result: { pages: 1, data: [] },
  };
  const cb = u.searchParams.get('callback') || u.searchParams.get('cb');
  if (cb) {
    return route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: `${cb}(${JSON.stringify(payload)});`,
    });
  }
  return route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload),
  });
}

async function settleAndAuditRoute(page, routeLabel, shotPath, overflowRoutes, renderErrors, crushedHeadingRoutes) {
  await page.waitForTimeout(700);
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const text = (document.body?.innerText || '').trim();
    const tabBar = document.querySelector('[aria-label="移动端主导航"]');
    const tabRect = tabBar ? tabBar.getBoundingClientRect() : null;
    const crushedHeadings = [];
    for (const h of Array.from(document.querySelectorAll('h1, h2, h3, h4'))) {
      const style = window.getComputedStyle(h);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const r = h.getBoundingClientRect();
      const lh = parseFloat(style.lineHeight) || 22;
      const hText = (h.innerText || '').trim();
      if (r.width > 0 && hText.length >= 3 && r.width < 48 && r.height > lh * 1.8) {
        crushedHeadings.push({ text: hText.slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return {
      innerWidth: window.innerWidth,
      scrollWidth: doc.scrollWidth,
      textLen: text.length,
      hasRenderError: text.includes('Render error:') || text.includes('Route error:'),
      snippet: text.slice(0, 120),
      tabBottom: tabRect ? Math.round(tabRect.bottom) : null,
      crushedHeadings,
    };
  });

  if (metrics.scrollWidth > metrics.innerWidth + 2) {
    overflowRoutes.push({
      route: routeLabel,
      scrollWidth: metrics.scrollWidth,
      innerWidth: metrics.innerWidth,
    });
  }
  if (metrics.hasRenderError || metrics.textLen < 12) {
    renderErrors.push({ route: routeLabel, ...metrics });
  }
  if (metrics.crushedHeadings.length > 0) {
    crushedHeadingRoutes.push({ route: routeLabel, crushedHeadings: metrics.crushedHeadings });
  }
  await page.screenshot({ path: shotPath, fullPage: false });
  return metrics;
}

async function clickBottomTab(page, label) {
  const nav = page.locator('[aria-label="移动端主导航"]');
  await nav.getByText(label, { exact: true }).click();
}

async function clickMoreDrawerItem(page, label) {
  await clickBottomTab(page, '更多');
  const drawer = page.locator('[aria-label="更多功能导航"]');
  await drawer.waitFor({ state: 'visible', timeout: 8000 });
  await drawer.getByText(label, { exact: true }).click();
  await drawer.waitFor({ state: 'hidden', timeout: 8000 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  let initialDeviceToken = '';
  try {
    const prePairing = await fetch(`${args.baseUrl}/api/mobile/pairing`);
    if (prePairing.ok) {
      const preJson = await prePairing.json();
      initialDeviceToken = String(preJson?.device_token || '');
    }
  } catch {
    // Allow direct localhost usage without pairing endpoint
  }

  const executablePath = process.env.PW_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });

  await context.addInitScript(
    ({ baseUrl, token }) => {
      window.CapacitorCustomPlatform = { name: 'android' };
      try {
        const existing = window.localStorage.getItem('tz.mobile.connection.v1');
        if (!existing) {
          window.localStorage.setItem(
            'tz.mobile.connection.v1',
            JSON.stringify({
              lanUrl: baseUrl,
              remoteUrl: '',
              deviceToken: token,
              autoWebBundleSync: false,
            })
          );
        }
      } catch {
        // Ignore storage init restriction
      }
    const applySafeArea = () => {
      if (document.documentElement) {
        document.documentElement.style.setProperty('--safe-top', '38px');
        document.documentElement.style.setProperty('--safe-bottom', '24px');
      }
    };
    applySafeArea();
    if (!document.documentElement) {
      try {
        new MutationObserver((_, obs) => {
          if (document.documentElement) {
            applySafeArea();
            obs.disconnect();
          }
        }).observe(document, { childList: true });
      } catch {
        // Fallback handled by DOMContentLoaded listener below
      }
    }
    window.addEventListener('DOMContentLoaded', applySafeArea, { once: true });
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => undefined, readText: async () => '' },
        configurable: true,
      });
    } catch {
      // Ignore if read-only in strict context
    }
  },
  { baseUrl: args.baseUrl, token: initialDeviceToken });

  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1') {
      return route.continue();
    }
    return handleExternalQuoteRoute(route);
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const expectedHistoryUnavailable = [];
  const expectedHistoryConsoleErrors = [];
  const isExpectedHistoryRequest = (url) => {
    try {
      const u = new URL(url);
      return u.origin === new URL(args.baseUrl).origin && u.pathname === '/api/quantstats/tearsheet'
        && u.searchParams.get('account_id') === 'FND-TIANTIAN-002';
    } catch { return false; }
  };
  const server5xx = [];
  const overflowRoutes = [];
  const renderErrors = [];
  const crushedHeadingRoutes = [];
  const screenshots = [];

  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      if (isExpectedHistoryRequest(msg.location().url) && /status of 422/.test(msg.text())) {
        expectedHistoryConsoleErrors.push(msg.text());
      } else {
        consoleErrors.push(msg.text());
      }
    }
  });
  page.on('response', (res) => {
    const u = new URL(res.url());
    if (isExpectedHistoryRequest(res.url()) && res.status() === 422) expectedHistoryUnavailable.push(res.url());
    if ((u.hostname === '127.0.0.1' || u.hostname === 'localhost') && res.status() >= 500) {
      server5xx.push({ url: res.url(), status: res.status() });
    }
  });

  const visit = async (label, filename) => {
    const shotPath = path.join(outDir, filename);
    const metrics = await settleAndAuditRoute(page, label, shotPath, overflowRoutes, renderErrors, crushedHeadingRoutes);
    screenshots.push({ route: label, file: filename, ...metrics });
  };

  await page.goto(`${args.baseUrl}/expert`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[aria-label="移动端主导航"]', { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.getByText('天天基金 (FND)').first().click();
  await page.waitForTimeout(300);
  await page.getByText('QuantStats 机构级报告').first().click();
  await page.getByText('真实共同历史不足或账户快照不一致，不以合成收益代替。').waitFor({ state: 'visible', timeout: 8000 });
  await page.getByText('300476 胜宏科技').first().click();
  await page.waitForTimeout(400);
  await visit('/expert', '01_expert.png');

  await page.getByText('组合 X-Ray 穿透').first().click();
  await page.locator('[data-testid="portfolio-xray-panel"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.getByText('UNATTRIBUTED_FUND_RESIDUAL').first().waitFor({ state: 'visible', timeout: 8000 });
  await visit('/expert#xray', '01b_expert_xray.png');

  await page.getByText('多空对抗视图').first().click();
  await page.locator('[data-testid="debate-synthesis-panel"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('[data-testid="debate-perspective-OPPORTUNITY_COST"]').waitFor({ state: 'visible', timeout: 8000 });
  await visit('/expert#debate', '01c_expert_debate.png');

  await page.goto(`${args.baseUrl}/expert?symbol=600900&tab=opportunity`, { waitUntil: 'domcontentloaded' });
  const pendingComparison = page.locator('tr').filter({hasText: '[DEMO] 等待情景'});
  await pendingComparison.getByText('仅研究候选', {exact: true}).waitFor({state: 'visible', timeout: 8000});
  await pendingComparison.getByText('[DEMO] 比较期限未核验', {exact: true}).waitFor({state: 'visible', timeout: 8000});
  await pendingComparison.getByText('[DEMO] 缺独立证据', {exact: true}).waitFor({state: 'visible', timeout: 8000});
  if (await pendingComparison.getByText('[DEMO] 不应展示的旧优势', {exact: true}).count()) {
    throw new Error('unadmitted comparison displayed an unsupported advantage');
  }
  const verifiedComparison = page.locator('tr').filter({hasText: '沪深300ETF(基准)'});
  await verifiedComparison.getByText('已核验可比', {exact: true}).waitFor({state: 'visible', timeout: 8000});
  await verifiedComparison.getByText('单标的波动风险更低', {exact: true}).waitFor({state: 'visible', timeout: 8000});
  console.log('Synthetic comparison UI: gaps visible, unadmitted advantage withheld, admitted row retained');

  await page.goto(`${args.baseUrl}/expert?symbol=600900&tab=backtest`, { waitUntil: 'domcontentloaded' });
  const cashResearch = page.getByTestId('cash-execution-research');
  await cashResearch.getByText('[DEMO] 合成UI测试，非真实成交').waitFor({state: 'visible', timeout: 8000});
  await cashResearch.getByText('N/A / 0', {exact: true}).waitFor({state: 'visible', timeout: 8000});
  await cashResearch.scrollIntoViewIfNeeded();
  await visit('/expert#cash-execution-scenario', '01d_expert_backtest.png');
  await cashResearch.screenshot({path: path.join(outDir, '01d_cash_execution_module.png')});
  screenshots.push({route: '/expert#cash-execution-scenario-module', file: '01d_cash_execution_module.png', scope: 'LOCATOR_SCREENSHOT'});
  await page.goto(`${args.baseUrl}/expert?symbol=300476&tab=backtest`, { waitUntil: 'domcontentloaded' });
  await cashResearch.getByText('[DEMO] 缺少完整历史交易状态').waitFor({state: 'visible', timeout: 8000});
  if (await cashResearch.getByText('模拟成交 / 阻断订单', {exact: true}).count() !== 0) {
    throw new Error('blocked cash research displayed simulated fills');
  }
  await cashResearch.scrollIntoViewIfNeeded();
  await visit('/expert#cash-execution-blocked', '01e_expert_backtest_blocked.png');
  await cashResearch.screenshot({path: path.join(outDir, '01e_cash_execution_blocked_module.png')});
  screenshots.push({route: '/expert#cash-execution-blocked-module', file: '01e_cash_execution_blocked_module.png', scope: 'LOCATOR_SCREENSHOT'});

  await clickBottomTab(page, '市场');
  await page.locator('[data-testid="markets-selector-kr"]').click();
  await page.locator('[data-testid="markets-view-rankings"]').click();
  await page.getByText('三星电子').first().waitFor({ state: 'visible', timeout: 8000 });
  await visit('/markets', '06_markets_kr.png');
  await page.locator('[data-testid="markets-selector-cn"]').click();

  await clickBottomTab(page, '自选');
  await visit('/watchlist', '04_watchlist.png');

  await clickBottomTab(page, '市场');
  await page.locator('[data-testid="markets-selector-cn"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('[data-testid="markets-selector-cn"]').click();
  const mobileCnHeatmap = page.locator('canvas').first();
  await mobileCnHeatmap.waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(420);
  const mobileCnBox = await mobileCnHeatmap.boundingBox();
  if (!mobileCnBox || mobileCnBox.height < 380) {
    renderErrors.push({
      route: '/markets#mobile-cn-heatmap',
      reason: `mobile CN heatmap height too small: ${mobileCnBox ? Math.round(mobileCnBox.height) : 0}`,
    });
  }
  await visit('/markets', '04b_markets_cn_heatmap.png');

  await page.locator('[data-testid="markets-selector-kr"]').click();
  await page.waitForTimeout(380);
  await visit('/markets#kr', '04c_markets_kr_heatmap.png');
  await page.locator('[data-testid="markets-selector-cn"]').click();

  await page.locator('[data-testid="theme-switcher-trigger"]').click();
  const sheetLoc = page.locator('[data-testid="theme-switcher-sheet"]');
  await sheetLoc.waitFor({ state: 'visible', timeout: 6000 });
  await page.locator('[data-testid="theme-preset-crimson-silk"]').click();
  await page.locator('[data-testid="theme-density-compact"]').click();
  await page.waitForTimeout(350);
  const sheetBox = await sheetLoc.boundingBox();
  if (!sheetBox || sheetBox.width > 412.5 || sheetBox.y < 80) {
    renderErrors.push({ route: '#mobile-theme-sheet', reason: 'mobile theme sheet geometry out of bounds', sheetBox });
  }
  await page.screenshot({ path: path.join(outDir, '14_mobile_theme_sheet.png'), fullPage: false });
  await page.locator('[aria-label="关闭主题抽屉"]').click();
  await sheetLoc.waitFor({ state: 'hidden', timeout: 6000 });

  await clickBottomTab(page, '自选');
  await visit('/watchlist#crimson', '15_mobile_watchlist_crimson.png');

  await page.locator('[data-testid="theme-switcher-trigger"]').click();
  await sheetLoc.waitFor({ state: 'visible', timeout: 6000 });
  await page.locator('[data-testid="theme-preset-obsidian-pro"]').click();
  await page.locator('[data-testid="theme-density-comfortable"]').click();
  await page.locator('[aria-label="关闭主题抽屉"]').click();
  await sheetLoc.waitFor({ state: 'hidden', timeout: 6000 });

  await clickBottomTab(page, '更多');
  await page.locator('[aria-label="更多功能导航"]').waitFor({ state: 'visible', timeout: 8000 });
  await visit('more-drawer', '05_more_drawer.png');
  await page.locator('[aria-label="关闭更多导航"]').click();
  await page.locator('[aria-label="更多功能导航"]').waitFor({ state: 'hidden', timeout: 8000 });

  await clickMoreDrawerItem(page, '多资产雷达');
  await visit('/expert-radar', '02_radar.png');

  await clickBottomTab(page, '总览');
  await visit('/', '03_dashboard.png');

  await clickMoreDrawerItem(page, '信号扫描');
  await visit('/scanner', '09_scanner.png');

  await clickMoreDrawerItem(page, '尾盘选股');
  await visit('/eod-picker', '10_eod_picker.png');
  await page.getByText('历史参考价验证', {exact: true}).click();
  await page.getByText('方案参考价观察', {exact: true}).waitFor({state: 'visible', timeout: 8000});
  await page.getByText('T+3 收盘上涨占比', {exact: true}).waitFor({state: 'visible', timeout: 8000});
  await page.getByText('观察 0/1', {exact: true}).waitFor({state: 'visible', timeout: 8000});
  const t3Card = page.getByText('T+3 收盘上涨占比', {exact: true}).locator('..');
  await t3Card.getByText('N/A', {exact: true}).waitFor({state: 'visible', timeout: 8000});
  await page.getByText('方案参考价观察', {exact: true}).scrollIntoViewIfNeeded();
  await visit('/eod-picker#reference-observations', '10b_eod_reference.png');

  await page.goto(`${args.baseUrl}/s/sh600900`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[aria-label="移动端主导航"]', { timeout: 15000 });
  await page.locator('[data-testid="minesweeper-toggle-btn"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('[data-testid="minesweeper-toggle-btn"]').click();
  await page.locator('[data-testid="minesweeper-expanded-list"]').waitFor({ state: 'visible', timeout: 8000 });
  await visit('/s/sh600900', '11_stock_detail.png');

  await page.goto(`${args.baseUrl}/s/kr005930`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[aria-label="移动端主导航"]', { timeout: 15000 });
  await page.getByText('全球个股信息').waitFor({ state: 'visible', timeout: 8000 });
  await visit('/s/kr005930', '11b_stock_kr.png');

  await clickMoreDrawerItem(page, '设置与简报');
  await page.locator('[data-testid="scheduler-readonly-banner"]').waitFor({ state: 'visible', timeout: 8000 });
  const mobileSchedEditableCount = await page.locator('[data-testid="scheduler-desktop-form"]').count();
  if (mobileSchedEditableCount !== 0) {
    renderErrors.push({ route: '/settings#m5', reason: `mobile exposed ${mobileSchedEditableCount} writable scheduler form(s)` });
  }
  await page.locator('[data-testid="settings-segment-tabs"]').getByText('手机直连与OTA').click();
  await page.getByText('移动端连接与界面热更新').waitFor({ state: 'visible', timeout: 8000 });
  await visit('/settings', '12_settings.png');

  const pairingResp = await fetch(`${args.baseUrl}/api/mobile/pairing`);
  const pairingJson = await pairingResp.json();
  await page.locator('#mobile-pairing-input').fill(pairingJson.pairing_code);
  await page.getByRole('button', { name: '导入并连接' }).click();
  const toastLoc = page.locator('[data-testid="toast-item"]').first();
  await toastLoc.waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(250);
  const toastBox = await toastLoc.boundingBox();
  const toastText = await toastLoc.innerText();
  await page.screenshot({ path: path.join(outDir, '13_settings_toast.png'), fullPage: false });

  const toastSafeOk = Boolean(
    toastBox &&
      toastBox.y >= 38 &&
      toastBox.x >= 0 &&
      toastBox.x + toastBox.width <= 412.5 &&
      toastBox.width <= 400
  );
  screenshots.push({
    route: '/settings#toast',
    file: '13_settings_toast.png',
    toastSafeOk,
  });

  const report = {
    passed:
      pageErrors.length === 0 &&
      consoleErrors.length === 0 &&
      expectedHistoryUnavailable.length > 0 &&
      expectedHistoryConsoleErrors.length <= expectedHistoryUnavailable.length &&
      server5xx.length === 0 &&
      overflowRoutes.length === 0 &&
      renderErrors.length === 0 &&
      crushedHeadingRoutes.length === 0 &&
      toastSafeOk &&
      screenshots.length >= 13,
    pageErrors,
    consoleErrors,
    expectedHistoryUnavailable,
    expectedHistoryConsoleErrors,
    server5xx,
    overflowRoutes,
    renderErrors,
    crushedHeadingRoutes,
    toastCheck: { ok: toastSafeOk, box: toastBox, text: toastText },
    screenshots,
  };

  fs.writeFileSync(path.join(outDir, 'ui_report.json'), JSON.stringify(report, null, 2), 'utf-8');
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  if (!report.passed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
