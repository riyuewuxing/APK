import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

function parseArgs(argv) {
  const out = { baseUrl: 'http://127.0.0.1:8501', outDir: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base-url' && argv[i + 1]) {
      out.baseUrl = argv[i + 1].replace(/\/+$/, '');
      i += 1;
    } else if (argv[i] === '--out-dir' && argv[i + 1]) {
      out.outDir = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function loadPlaywright() {
  const candidates = [];
  if (process.env.PW_ROOT) {
    candidates.push(process.env.PW_ROOT);
    candidates.push(path.join(process.env.PW_ROOT, 'node_modules', 'playwright'));
    candidates.push(path.join(process.env.PW_ROOT, 'node_modules', 'playwright-core'));
    candidates.push(
      path.join(process.env.PW_ROOT, 'node_modules', '.pnpm', 'playwright@1.61.1', 'node_modules', 'playwright')
    );
  }
  candidates.push('playwright', 'playwright-core', '/tmp/pw/node_modules/playwright');
  const req = createRequire(import.meta.url);
  for (const cand of candidates) {
    try {
      return req(cand);
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Unable to resolve playwright module. Tried: ${candidates.join(', ')}`);
}

const ROUTES = [
  { path: '/', waitText: '全球投资终端' },
  { path: '/markets', waitText: '全球市场' },
  { path: '/expert', waitText: '正交研究结论' },
  { path: '/expert?symbol=022460&asset_type=fund', waitText: '正交研究结论' },
  { path: '/expert-radar', waitText: '多资产机会雷达' },
  { path: '/s/sh600900', waitText: '五档盘口' },
  { path: '/s/kr005930', waitText: '全球个股信息' },
  { path: '/boards', waitText: '板块' },
  { path: '/rankings', waitText: '行业板块' },
  { path: '/heatmap', waitText: '热力图' },
  { path: '/watchlist', waitText: '自选盯盘' },
  { path: '/scanner', waitText: '开始扫描' },
  { path: '/eod-picker', waitText: '尾盘' },
  { path: '/settings', waitText: '设置与简报' },
];

const DEMO_STOCK_META = {
  '601138': { name: '工业富联', price: '23.40', prev: '22.80', pct: '2.63', vr: '1.82', pe: '18.5' },
  '300476': { name: '胜宏科技', price: '45.20', prev: '43.52', pct: '3.86', vr: '2.15', pe: '29.4' },
  '600887': { name: '伊利股份', price: '27.85', prev: '27.95', pct: '-0.36', vr: '0.88', pe: '15.2' },
  '601088': { name: '中国神华', price: '40.12', prev: '39.80', pct: '0.80', vr: '1.05', pe: '13.6' },
  '600900': { name: '长江电力', price: '28.50', prev: '28.20', pct: '1.06', vr: '1.35', pe: '18.5' },
};

function buildTencentQuoteBody(rawUrl) {
  const u = new URL(rawUrl);
  const q = u.searchParams.get('q') || 'sh600900';
  const codes = q.split(',').map((s) => s.trim()).filter(Boolean);
  return codes
    .map((code) => {
      const bare = code.replace(/^(sh|sz|bj|hk)/i, '');
      const meta = DEMO_STOCK_META[bare] || {
        name: `Demo_${bare}`,
        price: '28.50',
        prev: '28.20',
        pct: '1.06',
        vr: '1.25',
        pe: '18.5',
      };
      const f = new Array(56).fill('0');
      f[0] = '1';
      f[1] = meta.name;
      f[2] = bare;
      f[3] = meta.price;
      f[4] = meta.prev;
      f[5] = meta.prev;
      f[6] = '120000';
      f[30] = '20261113150000';
      f[31] = (Number(meta.price) - Number(meta.prev)).toFixed(2);
      f[32] = meta.pct;
      f[33] = (Number(meta.price) + 0.3).toFixed(2);
      f[34] = (Number(meta.prev) - 0.1).toFixed(2);
      f[37] = '34200';
      f[38] = '0.52';
      f[39] = meta.pe;
      f[43] = '1.42';
      f[44] = '6800.0';
      f[45] = '6800.0';
      f[46] = '2.80';
      f[47] = (Number(meta.prev) * 1.1).toFixed(2);
      f[48] = (Number(meta.prev) * 0.9).toFixed(2);
      f[49] = meta.vr;
      f[51] = meta.price;
      f[52] = meta.pe;
      f[53] = meta.pe;
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

  if (host.includes('smartbox.gtimg.cn')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: 'v_hint="sz~300476~胜宏科技~shkj~GP-A^sh~600900~长江电力~cjdl~GP-A";',
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
    let codeList = ['sh600900', 'sz300476', 'sh601138', 'sh600887', 'sh601088', 'sh600519'];
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
    const dayBars = TRADING_DATES.slice(-25).map((dt, idx) => [
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
            qfqweek: dayBars,
            day: dayBars,
            data: {
              data: [
                '0930 28.20 1000 2820000',
                '0931 28.32 1800 5097600',
                '0932 28.44 2600 7394400',
                '1500 28.50 3200 9120000',
              ],
              date: '20261113',
            },
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

async function waitForRouteReady(page, waitText) {
  if (waitText) {
    await page.getByText(waitText).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
  }
  await page.waitForTimeout(500);
}

async function auditViewport(page, baseUrl, viewport, failures) {
  await page.setViewportSize(viewport);
  for (const rt of ROUTES) {
    await page.goto(`${baseUrl}${rt.path}`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, rt.waitText);
    const res = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      const text = (document.body?.innerText || '').trim();
      const crushed = [];
      for (const h of Array.from(document.querySelectorAll('h1, h2, h3, h4'))) {
        const s = window.getComputedStyle(h);
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        const r = h.getBoundingClientRect();
        const lh = parseFloat(s.lineHeight) || 22;
        const ht = (h.innerText || '').trim();
        if (r.width > 0 && ht.length >= 3 && r.width < 110 && r.height > lh * 1.8) {
          crushed.push({ text: ht.slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
      const imbalances = [];
      for (const el of Array.from(document.querySelectorAll('div'))) {
        const cls = typeof el.className === 'string' ? el.className : '';
        if (!cls.includes('workspaceGrid') && !cls.includes('mainGrid')) continue;
        const cols = Array.from(el.children).map((c) => c.getBoundingClientRect());
        if (cols.length >= 2 && Math.abs(cols[0].top - cols[1].top) < 40) {
          const maxH = Math.max(cols[0].height, cols[1].height);
          const minH = Math.min(cols[0].height, cols[1].height);
          if (maxH - minH > 550 && maxH / Math.max(minH, 1) > 1.65) {
            imbalances.push({
              cls: cls.slice(0, 32),
              h0: Math.round(cols[0].height),
              h1: Math.round(cols[1].height),
              diff: Math.round(maxH - minH),
            });
          }
        }
      }
      return {
        vw,
        sw,
        textLen: text.length,
        hasRenderError: text.includes('Render error:') || text.includes('Route error:'),
        crushed,
        imbalances,
      };
    });
    if (res.sw > res.vw + 2 || res.hasRenderError || res.textLen < 12 || res.crushed.length > 0 || res.imbalances.length > 0) {
      failures.push({ viewport: `${viewport.width}x${viewport.height}`, route: rt.path, ...res });
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  const executablePath =
    process.env.PW_EXECUTABLE_PATH ||
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    undefined;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath && fs.existsSync(executablePath) ? { executablePath } : {}),
  });

  const failures = [];
  const pageErrors = [];
  let modalCheck = null;
  let eodCheck = null;
  let xrayCheck = null;
  let minesweeperCheck = null;
  let debateCheck = null;
  let schedulerCheck = null;
  let watchlistTerminalCheck = null;
  let sidebarCollapseCheck = null;
  let globalPulseCheck = null;
  let heatmapSectorCheck = null;
  let cnHeatmapCheck = null;
  let crosshairHoverCheck = null;
  let popoverAlphaCheck = null;
  let commandPaletteCheck = null;
  let watchlistViewportCheck = null;
  let themeMatrixCheck = null;

  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      locale: 'zh-CN',
    });
    await context.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1') {
        return route.continue();
      }
      return handleExternalQuoteRoute(route);
    });
    const page = await context.newPage();
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await auditViewport(page, args.baseUrl, { width: 1920, height: 1080 }, failures);
    await auditViewport(page, args.baseUrl, { width: 1440, height: 900 }, failures);
    await auditViewport(page, args.baseUrl, { width: 1280, height: 800 }, failures);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${args.baseUrl}/expert`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, '正交研究结论');
    await page.getByText('QuantStats 机构级报告').first().click();
    await page.waitForTimeout(300);
    await page.getByText('窗口内全屏展开报告').first().click();
    await page.waitForTimeout(400);
    modalCheck = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const sidePt = document.elementFromPoint(100, 300);
      return {
        exists: Boolean(dialog),
        inBody: dialog?.parentElement?.tagName === 'BODY',
        aboveSidebar: Boolean(dialog && sidePt && dialog.contains(sidePt)),
      };
    });
    if (!modalCheck.exists || !modalCheck.inBody || !modalCheck.aboveSidebar) {
      failures.push({ viewport: '1440x900', route: '/expert#modal', modalCheck });
    }

    // M1 实测：/eod-picker 双 Tab 切换 + 情绪条 + 历史胜率统计渲染
    await page.goto(`${args.baseUrl}/eod-picker`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, '尾盘筛选与安检');
    eodCheck = { dualTab: false, regimeBar: false, historyStats: false, vettingApi: false };
    eodCheck.dualTab = (await page.getByText('历史验证与方案胜率').count()) > 0;
    eodCheck.regimeBar = /上涨占比|情绪数据暂不可用|刷新中/.test(await page.locator('body').innerText());
    await page.getByText('历史验证与方案胜率').first().click();
    await page.waitForTimeout(400);
    const historyText = await page.locator('body').innerText();
    eodCheck.historyStats = /方案胜率验证|T\+1 开盘胜率/.test(historyText);
    // 批量排雷接口实测：mock 侧确定性响应须含安检状态与结构因子（CANDIDATE_VETTING_ONLY）
    const vettingResp = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/eod/analyze-vetting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates: [{ code: 'sz300476', pick_price: 45.2 }], trade_date: '2026-11-17' }),
      });
      if (!r.ok) return null;
      return r.json();
    }, args.baseUrl);
    eodCheck.vettingApi = Boolean(
      vettingResp
      && vettingResp.disclaimer === 'CANDIDATE_VETTING_ONLY'
      && vettingResp.items?.[0]?.vetting?.vetting_status
      && vettingResp.items?.[0]?.structure_factors
    );
    if (!eodCheck.dualTab || !eodCheck.regimeBar || !eodCheck.historyStats || !eodCheck.vettingApi) {
      failures.push({ viewport: '1440x900', route: '/eod-picker#m1', eodCheck });
    }

    // M2 实测：/expert「组合 X-Ray 穿透」Tab + 账号切换 + 未归因保护 + API 只读隐私校验
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${args.baseUrl}/expert`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, '正交研究结论');
    await page.getByText('组合 X-Ray 穿透').first().click();
    const xrayPanel = page.locator('[data-testid="portfolio-xray-panel"]');
    await xrayPanel.waitFor({ state: 'visible', timeout: 8000 });
    await xrayPanel.getByText('UNATTRIBUTED_FUND_RESIDUAL').first().waitFor({ state: 'visible', timeout: 8000 });
    const allXrayText = await xrayPanel.innerText();
    const xrayOverflow1280 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await xrayPanel.getByRole('button', { name: '支付宝股票 (STK)' }).click();
    await xrayPanel.getByText('纯直持股票（无季报滞后）').waitFor({ state: 'visible', timeout: 8000 });
    const stkXrayText = await xrayPanel.innerText();
    const xrayApiResp = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/portfolio/xray?account_id=ALL`);
      if (!r.ok) return null;
      return r.json();
    }, args.baseUrl);
    xrayCheck = {
      tabLoaded: /UNATTRIBUTED_FUND_RESIDUAL/.test(allXrayText) && /工业富联/.test(allXrayText) && /已穿透总股票暴露/.test(allXrayText),
      switchedAccount: /长江电力/.test(stkXrayText) && /0\.00%/.test(stkXrayText),
      noOverflow1280: !xrayOverflow1280,
      apiPrivacy: Boolean(
        xrayApiResp
        && xrayApiResp.include_amounts === false
        && xrayApiResp.total_equity_cny === null
        && xrayApiResp.research_only === true
        && xrayApiResp.execution_allowed === false
      ),
    };
    if (!xrayCheck.tabLoaded || !xrayCheck.switchedAccount || !xrayCheck.noOverflow1280 || !xrayCheck.apiPrivacy) {
      failures.push({ viewport: '1280x800', route: '/expert#xray', xrayCheck });
    }

    // M4a 实测：/s/sh600900 财报排雷 30 条清单折叠/展开与溢界校验
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${args.baseUrl}/s/sh600900`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, '五档盘口');
    const msToggle = page.locator('[data-testid="minesweeper-toggle-btn"]');
    await msToggle.waitFor({ state: 'visible', timeout: 8000 });
    await msToggle.click();
    const msExpanded = page.locator('[data-testid="minesweeper-expanded-list"]');
    await msExpanded.waitFor({ state: 'visible', timeout: 8000 });
    const msText = await msExpanded.innerText();
    const msOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    minesweeperCheck = {
      panelRendered: (await page.locator('[data-testid="stock-minesweeper-panel"]').count()) > 0,
      has30FilterChip: /全部 \(30\)/.test(msText),
      hasFm01: /FM-01/.test(msText),
      hasFm30: /FM-30/.test(msText),
      noOverflow: !msOverflow,
    };
    if (!minesweeperCheck.panelRendered || !minesweeperCheck.has30FilterChip || !minesweeperCheck.hasFm01 || !minesweeperCheck.hasFm30 || !minesweeperCheck.noOverflow) {
      failures.push({ viewport: '1440x900', route: '/s/sh600900#minesweeper', minesweeperCheck });
    }

    // M4b 实测：/expert「多空对抗视图」4 视角 + claim_id / VerificationStatus 核验标识
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${args.baseUrl}/expert`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, '正交研究结论');
    await page.getByText('多空对抗视图').first().click();
    const debatePanel = page.locator('[data-testid="debate-synthesis-panel"]');
    await debatePanel.waitFor({ state: 'visible', timeout: 8000 });
    await debatePanel.locator('[data-testid="debate-perspective-OPPORTUNITY_COST"]').waitFor({ state: 'visible', timeout: 8000 });
    const debateText = await debatePanel.innerText();
    const debateOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const perspectiveCount = await debatePanel.locator('[data-testid^="debate-perspective-"]').count();
    debateCheck = {
      tabLoaded: perspectiveCount === 4,
      hasClaimId: /CLM-600900-/.test(debateText),
      hasVerificationBadges: /SUPPORTED/.test(debateText) && /CONFLICTED/.test(debateText),
      hasConvictionScale: /\+71\.0 \/ ±100/.test(debateText),
      noOverflow1280: !debateOverflow,
    };
    if (!debateCheck.tabLoaded || !debateCheck.hasClaimId || !debateCheck.hasVerificationBadges || !debateCheck.hasConvictionScale || !debateCheck.noOverflow1280) {
      failures.push({ viewport: '1280x800', route: '/expert#debate', debateCheck });
    }

    // M5 实测：/settings 桌面端三段 Tab 切换与「盘中/盘后自动化简报」配置保存、手动试跑与无溢出校验
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${args.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, '设置与简报');
    const settingsTabs = page.locator('[data-testid="settings-segment-tabs"]');
    await settingsTabs.waitFor({ state: 'visible', timeout: 8000 });
    const schedCard = page.locator('[data-testid="scheduler-settings-card"]');
    const schedForm = page.locator('[data-testid="scheduler-desktop-form"]');
    await schedForm.waitFor({ state: 'visible', timeout: 8000 });
    await schedCard.locator('[data-testid="scheduler-save-btn"]').click();
    await schedCard.locator('[data-testid="scheduler-run-eod-btn"]').click();
    await page.waitForTimeout(400);
    const schedText = await schedCard.innerText();
    await settingsTabs.getByText('手机直连与OTA').click();
    await page.getByText('手机端配对凭证（桌面端）').waitFor({ state: 'visible', timeout: 5000 });
    await settingsTabs.getByText('行情与指标偏好').click();
    await page.getByText('刷新频率').waitFor({ state: 'visible', timeout: 5000 });
    await settingsTabs.getByText('定时简报').click();
    await schedForm.waitFor({ state: 'visible', timeout: 5000 });
    const schedOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    schedulerCheck = {
      desktopFormRendered: (await schedForm.count()) === 1,
      readonlyBannerAbsent: (await schedCard.locator('[data-testid="scheduler-readonly-banner"]').count()) === 0,
      briefingVisible: /14:45 尾盘观察简报/.test(schedText),
      noOverflow1280: !schedOverflow,
    };
    if (!schedulerCheck.desktopFormRendered || !schedulerCheck.readonlyBannerAbsent || !schedulerCheck.briefingVisible || !schedulerCheck.noOverflow1280) {
      failures.push({ viewport: '1280x800', route: '/settings#m5', schedulerCheck });
    }

    // Plan A 实测 1：/watchlist 桌面三区联动盯盘终端（15列行情表 + 分时/K线双图联动 + 键盘↑↓ + 研究Dock 3 Tab + 侧栏折叠）
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${args.baseUrl}/watchlist`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, '自选盯盘');
    const previewPane = page.locator('[data-testid="watchlist-preview-pane"]');
    await previewPane.waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="watchlist-preview-timeline"] canvas').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="watchlist-preview-kline"] canvas').first().waitFor({ state: 'visible', timeout: 10000 });

    const headerText = await page.locator('table thead').innerText();
    const hasHighDensityCols = /涨速/.test(headerText) && /量比/.test(headerText) && /市盈\(动\)/.test(headerText);
    const firstRowCode = await page.locator('table tbody tr').nth(0).getAttribute('data-code');
    const secondRowCode = await page.locator('table tbody tr').nth(1).getAttribute('data-code');
    const thirdRowCode = await page.locator('table tbody tr').nth(2).getAttribute('data-code');
    const initialPreviewText = await previewPane.innerText();
    await page.locator('table tbody tr').nth(1).click();
    await page.waitForTimeout(300);
    const clickedPreviewText = await previewPane.innerText();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    const arrowPreviewText = await previewPane.innerText();

    const dock = page.locator('[data-testid="watchlist-research-dock"]');
    await dock.waitFor({ state: 'visible', timeout: 8000 });
    const dockToggle = dock.locator('[data-testid="watchlist-dock-toggle"]');
    if ((await dockToggle.getAttribute('aria-expanded')) !== 'true') {
      await dockToggle.click();
    }
    await dock.getByText('长江电力').first().waitFor({ state: 'visible', timeout: 8000 });
    const radarTabText = await dock.innerText();
    await dock.getByRole('tab', { name: '尾盘 2.0 记录' }).click();
    await dock.getByText('胜宏科技').first().waitFor({ state: 'visible', timeout: 8000 });
    const eodTabText = await dock.innerText();
    await dock.getByRole('tab', { name: '实证持仓对照' }).click();
    await dock.getByText('持有观察').first().waitFor({ state: 'visible', timeout: 8000 });
    const portTabText = await dock.innerText();
    const watchlistOverflow1440 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(250);
    const watchlistOverflow1280 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

    watchlistTerminalCheck = {
      hasHighDensityCols,
      previewHasBothCharts:
        (await page.locator('[data-testid="watchlist-preview-timeline"] canvas').count()) >= 1
        && (await page.locator('[data-testid="watchlist-preview-kline"] canvas').count()) >= 1,
      initialMatchedFirst: Boolean(firstRowCode && initialPreviewText.includes(firstRowCode.slice(-6))),
      clickSwitchedSecond: Boolean(secondRowCode && clickedPreviewText.includes(secondRowCode.slice(-6))),
      arrowDownSwitchedThird: Boolean(thirdRowCode && arrowPreviewText.includes(thirdRowCode.slice(-6))),
      dockTabsLoaded:
        /600900/.test(radarTabText)
        && /300476/.test(eodTabText)
        && /持有观察/.test(portTabText),
      noOverflow1440: !watchlistOverflow1440,
      noOverflow1280: !watchlistOverflow1280,
    };
    if (
      !watchlistTerminalCheck.hasHighDensityCols
      || !watchlistTerminalCheck.previewHasBothCharts
      || !watchlistTerminalCheck.initialMatchedFirst
      || !watchlistTerminalCheck.clickSwitchedSecond
      || !watchlistTerminalCheck.arrowDownSwitchedThird
      || !watchlistTerminalCheck.dockTabsLoaded
      || !watchlistTerminalCheck.noOverflow1440
      || !watchlistTerminalCheck.noOverflow1280
    ) {
      failures.push({ viewport: '1440x900', route: '/watchlist#terminal', watchlistTerminalCheck });
    }

    // Plan A 实测 2：全局侧边栏折叠（220px <-> 56px）并恢复展开态
    const collapseBtn = page.locator('[data-testid="sidebar-collapse-btn"]');
    await collapseBtn.click();
    await page.waitForTimeout(250);
    const collapsedBox = await page.locator('aside').first().boundingBox();
    const collapsedAttr = await page.evaluate(() => document.documentElement.getAttribute('data-sidebar-collapsed'));
    await collapseBtn.click();
    await page.waitForTimeout(250);
    const expandedBox = await page.locator('aside').first().boundingBox();
    const expandedAttr = await page.evaluate(() => document.documentElement.getAttribute('data-sidebar-collapsed'));
    sidebarCollapseCheck = {
      collapsedTo56: Boolean(collapsedBox && collapsedBox.width <= 60 && collapsedAttr === 'true'),
      restoredTo220: Boolean(expandedBox && expandedBox.width >= 210 && expandedAttr === 'false'),
    };
    if (!sidebarCollapseCheck.collapsedTo56 || !sidebarCollapseCheck.restoredTo220) {
      failures.push({ viewport: '1280x800', route: '#sidebar-collapse', sidebarCollapseCheck });
    }

    // 侧边栏 8 项收口验证 + /expert 首屏分段导航直达（取消 sh600900 硬编码）+ /markets 与 /watchlist 跨市场切换
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${args.baseUrl}/expert?symbol=300476`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, '正交研究结论');
    const sidebarLinkCount = await page.locator('aside nav a').count();
    if (sidebarLinkCount !== 8) {
      failures.push({ viewport: '1280x800', route: '#sidebar-count', sidebarLinkCount });
    }
    const expertTopBar = page.locator('[data-testid="expert-top-segment-bar"]');
    await expertTopBar.waitFor({ state: 'visible', timeout: 8000 });
    await expertTopBar.getByText('组合 X-Ray', { exact: true }).click();
    await page.locator('[data-testid="portfolio-xray-panel"]').waitFor({ state: 'visible', timeout: 8000 });
    await expertTopBar.getByText('多空对抗', { exact: true }).click();
    await page.locator('[data-testid="debate-synthesis-panel"]').waitFor({ state: 'visible', timeout: 8000 });
    await expertTopBar.getByText('30条财报排雷', { exact: true }).click();
    await page.locator('[data-testid="expert-minesweeper-panel"]').waitFor({ state: 'visible', timeout: 8000 });
    if (!page.url().includes('300476')) {
      failures.push({ viewport: '1280x800', route: '/expert#minesweeper-subject', url: page.url() });
    }

    // /markets 三合一页先校验大 A 默认热力图高度 >= 500，再切换外围美股/韩股 & 榜单/板块
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${args.baseUrl}/markets`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="markets-selector-cn"]').click();
    const cnHeatmapCanvas = page.locator('canvas').first();
    await cnHeatmapCanvas.waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(450);
    const cnHeatmapBox = await cnHeatmapCanvas.boundingBox();
    cnHeatmapCheck = {
      heightPx: cnHeatmapBox ? Math.round(cnHeatmapBox.height) : 0,
      widthPx: cnHeatmapBox ? Math.round(cnHeatmapBox.width) : 0,
    };
    if (!cnHeatmapBox || cnHeatmapBox.height < 500) {
      failures.push({ viewport: '1440x900', route: '/markets#cn-heatmap-height', cnHeatmapCheck });
    }
    if (args.outDir) {
      fs.mkdirSync(args.outDir, { recursive: true });
      await page.screenshot({ path: path.join(args.outDir, 'desktop_markets_cn_heatmap.png'), fullPage: false });
    }

    await page.locator('[data-testid="markets-selector-us"]').click();
    const usHeatmapCanvas = page.locator('canvas').first();
    await usHeatmapCanvas.waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(450);
    const usHeatmapBox = await usHeatmapCanvas.boundingBox();
    if (!usHeatmapBox || usHeatmapBox.height < 540) {
      failures.push({ viewport: '1440x900', route: '/markets#us-heatmap-height', usHeatmapBox });
    }
    if (args.outDir) {
      fs.mkdirSync(args.outDir, { recursive: true });
      await page.screenshot({ path: path.join(args.outDir, 'desktop_markets_us_sector_heatmap.png'), fullPage: false });
    }
    // 切换 行业×龙头双层全景 -> 再切回 纯行业板块图，校验中心区域非空白且存在多色阶砖块与文字像素
    await page.getByRole('button', { name: '行业×龙头双层全景' }).click();
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: '纯行业板块图' }).click();
    await page.waitForTimeout(450);
    const sectorPixelsOk = await page.evaluate(() => {
      const cvs = document.querySelector('canvas');
      if (!cvs) return false;
      const ctx = cvs.getContext('2d');
      if (!ctx || cvs.width < 100 || cvs.height < 100) return false;
      const sx = Math.floor(cvs.width * 0.2);
      const sy = Math.floor(cvs.height * 0.2);
      const sw = Math.floor(cvs.width * 0.6);
      const sh = Math.floor(cvs.height * 0.6);
      const data = ctx.getImageData(sx, sy, sw, sh).data;
      const distinct = new Set();
      let whiteTextPixels = 0;
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 20) continue;
        distinct.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
        if (r > 210 && g > 210 && b > 210) {
          whiteTextPixels += 1;
        }
      }
      return distinct.size >= 4 && whiteTextPixels >= 5;
    });
    heatmapSectorCheck = {
      heightPx: usHeatmapBox ? Math.round(usHeatmapBox.height) : 0,
      sectorPixelsOk,
    };
    if (!sectorPixelsOk) {
      failures.push({ viewport: '1440x900', route: '/markets#sector-roundtrip-pixels', heatmapSectorCheck });
    }

    await page.locator('[data-testid="markets-selector-kr"]').click();
    const outerHeatmapCanvas = page.locator('canvas').first();
    await outerHeatmapCanvas.waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(350);
    const outerHeatmapBox = await outerHeatmapCanvas.boundingBox();
    if (!outerHeatmapBox || outerHeatmapBox.height < 500) {
      failures.push({ viewport: '1440x900', route: '/markets#outer-heatmap-height', outerHeatmapBox });
    }
    if (args.outDir) {
      fs.mkdirSync(args.outDir, { recursive: true });
      await page.screenshot({ path: path.join(args.outDir, 'desktop_markets_kr_heatmap.png'), fullPage: false });
    }
    await page.locator('[data-testid="markets-view-rankings"]').click();
    await page.getByText('三星电子').first().waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(350);
    if (args.outDir) {
      await page.screenshot({ path: path.join(args.outDir, 'desktop_markets_kr_rankings.png'), fullPage: false });
    }
    await page.locator('[data-testid="markets-view-boards"]').click();
    await page.getByText('板块成分股下钻').first().waitFor({ state: 'visible', timeout: 8000 });
    // 复原为大 A 以保持后续默认偏好干净
    await page.locator('[data-testid="markets-selector-cn"]').click();

    // /watchlist 切韩股分市场盯盘并验证右栏分时/K线与 1440x900 视口底缘覆满
    await page.goto(`${args.baseUrl}/watchlist`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="watchlist-market-kr"]').click();
    await page.getByText('三星电子').first().waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('[data-testid="watchlist-preview-timeline"] canvas').first().waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('[data-testid="watchlist-preview-kline"] canvas').first().waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(300);

    const timelineCanvas = page.locator('[data-testid="watchlist-preview-timeline"] canvas').first();
    const tlBox = await timelineCanvas.boundingBox();
    if (tlBox && tlBox.width > 60 && tlBox.height > 60) {
      await page.mouse.move(tlBox.x + tlBox.width * 0.45, tlBox.y + tlBox.height * 0.48);
      await page.waitForTimeout(200);
      crosshairHoverCheck = { hovered: true, x: Math.round(tlBox.x + tlBox.width * 0.45), y: Math.round(tlBox.y + tlBox.height * 0.48) };
      if (args.outDir) {
        await page.screenshot({ path: path.join(args.outDir, 'desktop_watchlist_crosshair.png'), fullPage: false });
      }
    } else {
      crosshairHoverCheck = { hovered: false };
      failures.push({ viewport: '1440x900', route: '/watchlist#crosshair-hover', crosshairHoverCheck });
    }

    const previewPaneBox = await page.locator('[data-testid="watchlist-preview-pane"]').boundingBox();
    watchlistViewportCheck = {
      paneTop: previewPaneBox ? Math.round(previewPaneBox.y) : 0,
      paneBottom: previewPaneBox ? Math.round(previewPaneBox.y + previewPaneBox.height) : 0,
      paneHeight: previewPaneBox ? Math.round(previewPaneBox.height) : 0,
    };
    if (!previewPaneBox || previewPaneBox.y + previewPaneBox.height < 700) {
      failures.push({ viewport: '1440x900', route: '/watchlist#preview-pane-height', watchlistViewportCheck });
    }
    if (args.outDir) {
      await page.screenshot({ path: path.join(args.outDir, 'desktop_watchlist_kr.png'), fullPage: false });
      await page.screenshot({ path: path.join(args.outDir, 'desktop_watchlist_1440.png'), fullPage: false });
    }

    // Global Market Pulse 实测：/ 折叠8核心+展开16项4分组 + /eod-picker 亚太参考条 + /watchlist Dock 第4Tab 外围定价锚
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${args.baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, '市场总览');
    const strip = page.locator('[data-testid="global-pulse-strip"]');
    await strip.waitFor({ state: 'visible', timeout: 8000 });
    await strip.getByText('纳指100').first().waitFor({ state: 'visible', timeout: 8000 });
    const collapsedStripText = await strip.innerText();
    const collapsedHasCore =
      collapsedStripText.includes('纳指100')
      && collapsedStripText.includes('日经225')
      && collapsedStripText.includes('韩国综合')
      && collapsedStripText.includes('德国DAX')
      && collapsedStripText.includes('离岸人民币');

    await strip.locator('[data-testid="global-pulse-toggle"]').click();
    const matrix = strip.locator('[data-testid="global-pulse-matrix"]');
    await matrix.waitFor({ state: 'visible', timeout: 5000 });
    const expandedMatrixText = await matrix.innerText();
    const expandedHasAll16 =
      expandedMatrixText.includes('美洲市场')
      && expandedMatrixText.includes('亚太日盘')
      && expandedMatrixText.includes('欧洲缩影')
      && expandedMatrixText.includes('汇率·大宗·利率')
      && expandedMatrixText.includes('10年期美债')
      && expandedMatrixText.includes('WTI原油')
      && expandedMatrixText.includes('台湾加权');
    const pulseOverflow1440 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);
    const pulseOverflow1280 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await strip.locator('[data-testid="global-pulse-toggle"]').click();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${args.baseUrl}/eod-picker`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, '尾盘筛选与安检');
    const eodApac = page.locator('[data-testid="eod-apac-pulse"]');
    await eodApac.waitFor({ state: 'visible', timeout: 8000 });
    await eodApac.getByText('离岸人民币').first().waitFor({ state: 'visible', timeout: 8000 });
    const eodApacText = await eodApac.innerText();
    const eodApacRendered =
      eodApacText.includes('恒指')
      && eodApacText.includes('恒科')
      && eodApacText.includes('日经225')
      && eodApacText.includes('韩国综合')
      && eodApacText.includes('离岸人民币');

    await page.goto(`${args.baseUrl}/watchlist`, { waitUntil: 'domcontentloaded' });
    await waitForRouteReady(page, '自选盯盘');
    const wlDock = page.locator('[data-testid="watchlist-research-dock"]');
    await wlDock.waitFor({ state: 'visible', timeout: 8000 });
    await wlDock.getByRole('tab', { name: '外围定价锚' }).click();
    const wlGlobalPane = wlDock.locator('[data-testid="watchlist-global-pulse-pane"]');
    await wlGlobalPane.waitFor({ state: 'visible', timeout: 8000 });
    const wlGlobalText = await wlGlobalPane.innerText();
    const watchlistDockGlobalTab =
      wlGlobalText.includes('跨境 ETF 隔夜定价参照')
      && wlGlobalText.includes('美债10Y')
      && wlGlobalText.includes('离岸人民币');
    const wlGlobalOverflow1440 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

    globalPulseCheck = {
      collapsedHasCore,
      expandedHasAll16,
      pulseNoOverflow1440: !pulseOverflow1440,
      pulseNoOverflow1280: !pulseOverflow1280,
      eodApacRendered,
      watchlistDockGlobalTab,
      wlGlobalNoOverflow1440: !wlGlobalOverflow1440,
    };
    if (
      !globalPulseCheck.collapsedHasCore
      || !globalPulseCheck.expandedHasAll16
      || !globalPulseCheck.pulseNoOverflow1440
      || !globalPulseCheck.pulseNoOverflow1280
      || !globalPulseCheck.eodApacRendered
      || !globalPulseCheck.watchlistDockGlobalTab
      || !globalPulseCheck.wlGlobalNoOverflow1440
    ) {
      failures.push({ viewport: '1440x900', route: '#global-pulse', globalPulseCheck });
    }

    // 多主题切换与视觉截图矩阵验收（obsidian-pro / amber-terminal / daylight-swiss）
    const themeTargets = [
      { id: 'obsidian-pro', polarity: 'dark', file: 'desktop_theme_obsidian_pro.png' },
      { id: 'amber-terminal', polarity: 'dark', file: 'desktop_theme_amber_terminal.png' },
      { id: 'daylight-swiss', polarity: 'light', file: 'desktop_theme_daylight_swiss.png' },
    ];
    themeMatrixCheck = [];
    for (const target of themeTargets) {
      await page.goto(`${args.baseUrl}/settings?tab=preferences`, { waitUntil: 'domcontentloaded' });
      const presetCard = page.locator(`[data-testid="settings-preset-${target.id}"]`);
      await presetCard.waitFor({ state: 'visible', timeout: 8000 });
      await presetCard.click();
      await page.waitForTimeout(480);
      await page.goto(`${args.baseUrl}/`, { waitUntil: 'domcontentloaded' });
      await waitForRouteReady(page, '市场总览');
      await page.waitForTimeout(350);
      const themeEval = await page.evaluate(() => ({
        preset: document.documentElement.getAttribute('data-theme-preset'),
        theme: document.documentElement.getAttribute('data-theme'),
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      }));
      const ok =
        themeEval.preset === target.id
        && themeEval.theme === target.polarity
        && themeEval.scrollW <= themeEval.innerW + 1;
      themeMatrixCheck.push({ target: target.id, ...themeEval, ok });
      if (!ok) {
        failures.push({ viewport: '1440x900', route: `#theme-${target.id}`, ...themeEval });
      }
      if (args.outDir) {
        await page.screenshot({ path: path.join(args.outDir, target.file), fullPage: false });
      }
    }
    // 复原默认主题并实测 Header ThemeSwitcher 实底弹出层透明度 + Ctrl+K 指挥台
    await page.locator('[data-testid="theme-switcher-trigger"]').click();
    const popoverLoc = page.locator('[data-testid="theme-switcher-popover"]');
    await popoverLoc.waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('[data-testid="theme-preset-crimson-silk"]').click();
    await page.locator('[data-testid="theme-density-compact"]').click();
    await page.waitForTimeout(420);
    const popoverStyle = await popoverLoc.evaluate((el) => {
      const bg = window.getComputedStyle(el).backgroundColor || '';
      const rgbaMatch = bg.match(/rgba?\(([^)]+)\)/i);
      let alpha = 1;
      if (rgbaMatch) {
        const parts = rgbaMatch[1].split(',').map((s) => Number(s.trim()));
        if (parts.length >= 4 && Number.isFinite(parts[3])) {
          alpha = parts[3];
        }
      }
      return {
        bg,
        alpha,
        preset: document.documentElement.getAttribute('data-theme-preset'),
        density: document.documentElement.getAttribute('data-density'),
      };
    });
    popoverAlphaCheck = {
      ...popoverStyle,
      ok: popoverStyle.alpha >= 0.9 && popoverStyle.preset === 'crimson-silk' && popoverStyle.density === 'compact',
    };
    if (!popoverAlphaCheck.ok) {
      failures.push({ viewport: '1440x900', route: '#crimson-popover-alpha', popoverAlphaCheck });
    }
    if (args.outDir) {
      await page.screenshot({ path: path.join(args.outDir, 'desktop_crimson_popover.png'), fullPage: false });
    }
    await page.keyboard.press('Escape');
    await popoverLoc.waitFor({ state: 'hidden', timeout: 5000 });

    await page.keyboard.press('Control+k');
    const cmdDialog = page.locator('[data-testid="command-palette-dialog"]');
    await cmdDialog.waitFor({ state: 'visible', timeout: 5000 });
    const cmdInput = cmdDialog.locator('input').first();
    await cmdInput.fill('琥珀');
    await page.waitForTimeout(220);
    const hasAmberAction = (await cmdDialog.innerText()).includes('琥珀终端');
    await cmdInput.fill('自选');
    await page.waitForTimeout(220);
    const hasWatchlistAction = (await cmdDialog.innerText()).includes('自选实时盯盘');
    await page.keyboard.press('Escape');
    await cmdDialog.waitFor({ state: 'hidden', timeout: 5000 });
    commandPaletteCheck = {
      hasAmberAction,
      hasWatchlistAction,
      closedOnEsc: !(await cmdDialog.isVisible()),
    };
    if (!commandPaletteCheck.hasAmberAction || !commandPaletteCheck.hasWatchlistAction || !commandPaletteCheck.closedOnEsc) {
      failures.push({ viewport: '1440x900', route: '#command-palette', commandPaletteCheck });
    }

    await page.goto(`${args.baseUrl}/settings?tab=preferences`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="settings-preset-obsidian-pro"]').click();
    await page.locator('[data-testid="settings-density-comfortable"]').click();
    await page.waitForTimeout(250);

    await context.close();
  } finally {
    await browser.close();
  }

  const report = {
    passed: pageErrors.length === 0 && failures.length === 0,
    pageErrors,
    failures,
    modalCheck,
    eodCheck,
    xrayCheck,
    minesweeperCheck,
    debateCheck,
    schedulerCheck,
    watchlistTerminalCheck,
    sidebarCollapseCheck,
    globalPulseCheck,
    heatmapSectorCheck,
    cnHeatmapCheck,
    crosshairHoverCheck,
    popoverAlphaCheck,
    commandPaletteCheck,
    watchlistViewportCheck,
    themeMatrixCheck,
  };
  if (args.outDir) {
    fs.mkdirSync(args.outDir, { recursive: true });
    fs.writeFileSync(path.join(args.outDir, 'desktop_ui_report.json'), JSON.stringify(report, null, 2), 'utf-8');
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
