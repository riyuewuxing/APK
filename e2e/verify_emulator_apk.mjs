import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {
    baseUrl: 'http://127.0.0.1:8502',
    cdpUrl: 'http://127.0.0.1:9222',
    outDir: 'e2e_artifacts_emulator',
    apkMetaJson: '',
    packageName: 'com.riyuewuxing.touzizhuanjia',
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base-url' && argv[i + 1]) out.baseUrl = argv[++i];
    if (argv[i] === '--cdp-url' && argv[i + 1]) out.cdpUrl = argv[++i];
    if (argv[i] === '--out-dir' && argv[i + 1]) out.outDir = argv[++i];
    if (argv[i] === '--apk-meta-json' && argv[i + 1]) out.apkMetaJson = argv[++i];
    if (argv[i] === '--package-name' && argv[i + 1]) out.packageName = argv[++i];
  }
  return out;
}

function adbText(args) {
  return execFileSync('adb', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function adbScreencap(outPath) {
  const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], {
    maxBuffer: 25 * 1024 * 1024,
  });
  fs.writeFileSync(outPath, png);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWebViewSocket(timeoutMs = 35000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const unixOut = adbText(['shell', 'cat', '/proc/net/unix']);
      const matches = unixOut.match(/webview_devtools_remote_\d+/g);
      if (matches && matches.length > 0) {
        return matches[0];
      }
    } catch {
      // Retry while process starts
    }
    await sleep(600);
  }
  throw new Error('Timed out waiting for webview_devtools_remote_<pid> socket in /proc/net/unix');
}

function queryWindowFocusLine() {
  const chunks = [];
  for (const args of [
    ['shell', 'dumpsys', 'window'],
    ['shell', 'dumpsys', 'activity', 'activities'],
  ]) {
    try {
      const out = adbText(args);
      const lines = out
        .split(/\r?\n/)
        .filter((l) => /mCurrentFocus|mFocusedApp|topResumedActivity|mResumedActivity/i.test(l));
      chunks.push(...lines.slice(0, 6));
    } catch {
      // Ignore transient dumpsys failure
    }
  }
  return chunks.join(' | ');
}

class CdpPage {
  constructor(ws, pageErrors) {
    this.ws = ws;
    this.pageErrors = pageErrors;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (typeof msg.id === 'number') {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(`CDP error (${msg.error.code}): ${msg.error.message}`));
        } else {
          entry.resolve(msg.result || {});
        }
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const det = msg.params?.exceptionDetails;
        const text = det?.exception?.description || det?.text || 'Unknown WebView JS exception';
        this.pageErrors.push(text);
      }
    });

    ws.addEventListener('close', () => {
      this.closed = true;
      for (const [, entry] of this.pending) {
        entry.reject(new Error('CDP WebSocket closed'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, timeoutMs = 15000) {
    if (this.closed) {
      return Promise.reject(new Error(`CDP socket already closed before ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evalJson(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Eval failed';
      throw new Error(`WebView eval exception: ${desc}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async tapBox(box) {
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: cx,
      y: cy,
      button: 'left',
      clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: cx,
      y: cy,
      button: 'left',
      clickCount: 1,
    });
  }

  async waitForSelector(selector, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const box = await this.evalJson(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r0 = el.getBoundingClientRect();
        if (r0.width <= 0 || r0.height <= 0) return null;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      })()`).catch(() => null);
      if (box) return box;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for selector: ${selector}`);
  }

  async waitForElement({ scopeSelector = '', selector = '*', textExact = '', textRegex = '', timeoutMs = 15000 }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const box = await this.evalJson(`(() => {
        const root = ${scopeSelector ? `document.querySelector(${JSON.stringify(scopeSelector)})` : 'document.body'};
        if (!root) return null;
        const rx = ${textRegex ? `new RegExp(${JSON.stringify(textRegex)})` : 'null'};
        const exact = ${JSON.stringify(textExact)};
        const nodes = Array.from(root.querySelectorAll(${JSON.stringify(selector)}));
        const matches = [];
        for (const el of nodes) {
          const r0 = el.getBoundingClientRect();
          if (r0.width <= 0 || r0.height <= 0) continue;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          const txt = (el.innerText || el.textContent || '').trim();
          if (exact && txt !== exact) continue;
          if (rx && !rx.test(txt)) continue;
          matches.push({ el, area: r0.width * r0.height, txt });
        }
        if (matches.length === 0) return null;
        matches.sort((a, b) => a.area - b.area);
        const picked = matches[0].el;
        picked.scrollIntoView({ block: 'center', inline: 'nearest' });
        const r = picked.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height, text: matches[0].txt };
      })()`).catch(() => null);
      if (box) return box;
      await sleep(250);
    }
    const diag = await this.evalJson(
      'JSON.stringify({ url: location.href, text: (document.body?.innerText || "").slice(0, 320) })'
    ).catch(() => 'unavailable');
    throw new Error(
      `Timed out waiting for element (${JSON.stringify({ scopeSelector, selector, textExact, textRegex })}) state=${diag}`
    );
  }

  async fillTextarea(selector, value) {
    const box = await this.waitForSelector(selector, 12000);
    await this.tapBox(box);
    await this.evalJson(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Missing input element');
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, '');
      else el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await this.send('Input.insertText', { text: value });
    const actual = await this.evalJson(`document.querySelector(${JSON.stringify(selector)})?.value || ''`);
    if (actual !== value) {
      await this.evalJson(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, ${JSON.stringify(value)});
        else el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    }
  }

  close() {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      // Ignore close error
    }
  }
}

async function connectActiveWebView(cdpBaseUrl, pageErrors, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${cdpBaseUrl}/json/list`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const targets = await resp.json();
      const pageTarget =
        targets.find(
          (t) =>
            t.type === 'page' &&
            t.webSocketDebuggerUrl &&
            typeof t.url === 'string' &&
            !t.url.startsWith('devtools://')
        ) || targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);

      if (pageTarget) {
        const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 8000);
          ws.addEventListener('open', () => {
            clearTimeout(timer);
            resolve();
          });
          ws.addEventListener('error', (ev) => {
            clearTimeout(timer);
            reject(new Error(ev?.message || 'WebSocket connection failed'));
          });
        });
        const client = new CdpPage(ws, pageErrors);
        await client.send('Runtime.enable');
        await client.send('Page.enable');
        const ready = await client.evalJson('document.readyState');
        if (ready) {
          return client;
        }
        client.close();
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(400);
  }
  throw new Error(`No responsive WebView page target at ${cdpBaseUrl}/json/list (${lastErr})`);
}

async function navigateDrawer(cdp, label) {
  const moreTab = await cdp.waitForElement({
    scopeSelector: '[aria-label="移动端主导航"]',
    textExact: '更多',
    timeoutMs: 12000,
  });
  await cdp.tapBox(moreTab);

  await cdp.waitForSelector('[aria-label="更多功能导航"]', 8000);
  const item = await cdp.waitForElement({
    scopeSelector: '[aria-label="更多功能导航"]',
    textExact: label,
    timeoutMs: 8000,
  });
  await cdp.tapBox(item);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const expectedMeta =
    args.apkMetaJson && fs.existsSync(args.apkMetaJson)
      ? JSON.parse(fs.readFileSync(args.apkMetaJson, 'utf-8'))
      : {};

  const socketName = await waitForWebViewSocket(35000);
  adbText(['forward', '--remove-all']);
  adbText(['forward', 'tcp:9222', `localabstract:${socketName}`]);

  const pageErrors = [];
  const screenshots = [];
  let cdp = await connectActiveWebView(args.cdpUrl, pageErrors, 25000);

  try {
    await cdp.waitForSelector('[aria-label="移动端主导航"]', 25000);
    await sleep(1000);
    adbScreencap(path.join(outDir, 'emulator_01_launch.png'));
    screenshots.push('emulator_01_launch.png');

    const capInfo = await cdp.evalJson(`(async () => {
      const cap = window.Capacitor;
      const isNative = Boolean(cap?.isNativePlatform?.());
      const info = await cap?.Plugins?.AppUpdate?.getInstalledInfo?.();
      const themeBridgeOk = Boolean(
        typeof window.AndroidThemeBridge?.syncSystemBars === 'function' &&
        typeof window.AndroidThemeBridge?.triggerHaptic === 'function'
      );
      return { isNative, info, themeBridgeOk };
    })()`);

    const expectedVersionCode = Number(expectedMeta.version_code || 1004);
    const expectedSigningSha = String(expectedMeta.signing_sha256 || '').toLowerCase();
    const actualSigningSha = String(capInfo?.info?.signingSha256 || '').toLowerCase();

    const nativeContractOk = Boolean(
      capInfo?.isNative === true &&
        capInfo?.themeBridgeOk === true &&
        capInfo?.info?.packageName === args.packageName &&
        Number(capInfo?.info?.versionCode || 0) >= expectedVersionCode &&
        capInfo?.info?.canRequestPackageInstalls === true &&
        (!expectedSigningSha || actualSigningSha === expectedSigningSha)
    );
    if (!nativeContractOk) {
      throw new Error(`Native AppUpdate/ThemeBridge contract failed: ${JSON.stringify({ capInfo, expectedMeta })}`);
    }

    await navigateDrawer(cdp, '设置与简报');
    const mobileTabBtn = await cdp.waitForElement({
      scopeSelector: '[data-testid="settings-segment-tabs"]',
      textExact: '手机直连与OTA',
      timeoutMs: 10000,
    });
    await cdp.tapBox(mobileTabBtn);
    await cdp.waitForElement({ textRegex: '移动端连接与界面热更新', timeoutMs: 10000 });

    const pairingResp = await fetch(`${args.baseUrl}/api/mobile/pairing`);
    const pairingJson = await pairingResp.json();
    await cdp.fillTextarea('#mobile-pairing-input', pairingJson.pairing_code);

    const importBtn = await cdp.waitForElement({
      selector: 'button',
      textRegex: '导入并连接',
      timeoutMs: 8000,
    });
    await cdp.tapBox(importBtn);

    await cdp.waitForElement({ textRegex: '局域网直连已通', timeoutMs: 15000 });
    const toastBox = await cdp.evalJson(`(() => {
      const el = document.querySelector('[data-testid="toast-item"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
    })()`);
    await sleep(350);
    adbScreencap(path.join(outDir, 'emulator_02_paired_toast.png'));
    screenshots.push('emulator_02_paired_toast.png');

    // Verify 1-second JS OTA sync via @capgo/capacitor-updater
    const otaBtn = await cdp.waitForElement({
      selector: 'button',
      textRegex: '1 秒同步最新界面',
      timeoutMs: 12000,
    });
    await cdp.tapBox(otaBtn);

    // CapacitorUpdater.set() switches server base path & reloads WebView document
    await sleep(3000);
    cdp.close();
    cdp = await connectActiveWebView(args.cdpUrl, pageErrors, 25000);
    await cdp.waitForSelector('[aria-label="移动端主导航"]', 25000);
    const afterOtaPath = await cdp.evalJson('window.location.pathname');
    if (afterOtaPath !== '/settings') {
      await navigateDrawer(cdp, '设置与简报');
    }
    const postOtaMobileTab = await cdp.waitForElement({
      scopeSelector: '[data-testid="settings-segment-tabs"]',
      textExact: '手机直连与OTA',
      timeoutMs: 10000,
    });
    await cdp.tapBox(postOtaMobileTab);
    await cdp.waitForElement({
      selector: 'button',
      textRegex: '已是最新界面',
      timeoutMs: 20000,
    });
    // The visual label alone must not hide native rollback or stale JS state.
    const activeOta = await cdp.evalJson(`(async () => {
      const current = await window.Capacitor?.Plugins?.CapacitorUpdater?.current?.();
      return { id: current?.bundle?.id || '', version: current?.bundle?.version || '' };
    })()`);
    if (!activeOta?.id || activeOta.id === 'builtin' || activeOta.version !== 'ota-e2e-20261115') {
      throw new Error(`OTA native activation not verified: ${JSON.stringify(activeOta)}`);
    }
    console.log('OTA active native ID/version verified:', JSON.stringify(activeOta));
    await sleep(400);
    adbScreencap(path.join(outDir, 'emulator_03_ota_done.png'));
    screenshots.push('emulator_03_ota_done.png');

    // Verify in-app native APK self-update -> FileProvider -> Android System Installer
    const apkBtn = await cdp.waitForElement({
      selector: 'button',
      textRegex: '应用内下载并更新 APK',
      timeoutMs: 15000,
    });
    await cdp.tapBox(apkBtn);

    await cdp.waitForElement({ textRegex: '正在调起系统安装器', timeoutMs: 30000 });

    let installerFocus = '';
    const installerDeadline = Date.now() + 20000;
    while (Date.now() < installerDeadline) {
      const focus = queryWindowFocusLine();
      if (/packageinstaller|InstallStart|InstallStaging|PackageInstallerActivity/i.test(focus)) {
        installerFocus = focus;
        break;
      }
      await sleep(400);
    }
    if (installerFocus && !/PackageInstallerActivity/i.test(installerFocus)) {
      const activityDeadline = Date.now() + 4500;
      while (Date.now() < activityDeadline) {
        const focus = queryWindowFocusLine();
        if (/PackageInstallerActivity/i.test(focus)) {
          installerFocus = focus;
          break;
        }
        await sleep(350);
      }
    }
    await sleep(600);
    adbScreencap(path.join(outDir, 'emulator_04_app_installer.png'));
    screenshots.push('emulator_04_app_installer.png');

    for (let i = 0; i < 4; i += 1) {
      const focus = queryWindowFocusLine();
      if (focus.includes(args.packageName)) break;
      adbText(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
      await sleep(700);
    }

    if (cdp.closed) {
      cdp = await connectActiveWebView(args.cdpUrl, pageErrors, 15000);
    }
    const waitSettledBody = async (requiredPath, requiredRegex, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      let lastState = { path: '', text: '' };
      while (Date.now() < deadline) {
        const res = await cdp
          .evalJson(
            "({ path: window.location.pathname, text: (document.body?.innerText || '').trim() })"
          )
          .catch(() => null);
        if (res && typeof res.text === 'string') {
          lastState = res;
          if (
            res.path === requiredPath &&
            requiredRegex.test(res.text) &&
            !/正在加载|加载页面/.test(res.text)
          ) {
            return res.text;
          }
        }
        await sleep(300);
      }
      throw new Error(
        `Timed out waiting for settled view (path=${requiredPath} actual=${lastState.path}, missing=${requiredRegex}, bodyPreview=${lastState.text.slice(0, 260)})`
      );
    };

    const expertTab = await cdp.waitForElement({
      scopeSelector: '[aria-label="移动端主导航"]',
      textExact: '专家',
      timeoutMs: 12000,
    });
    await cdp.tapBox(expertTab);
    const expertBody = await waitSettledBody(
      '/expert',
      /双实证账户与持仓/,
      20000
    );
    await sleep(400);
    adbScreencap(path.join(outDir, 'emulator_05_expert.png'));
    screenshots.push('emulator_05_expert.png');

    await navigateDrawer(cdp, '多资产雷达');
    const radarBody = await waitSettledBody(
      '/expert-radar',
      /多资产机会雷达与数据源审计[\s\S]*真·困境反转观察/,
      20000
    );
    await sleep(400);
    adbScreencap(path.join(outDir, 'emulator_06_radar.png'));
    screenshots.push('emulator_06_radar.png');

    const hasRenderErr =
      expertBody.includes('Render error:') ||
      radarBody.includes('Render error:') ||
      expertBody.includes('Route error:') ||
      radarBody.includes('Route error:');
    const expertLoadedOk =
      !/正在加载|加载页面/.test(expertBody) && /双实证账户与持仓/.test(expertBody);
    const radarLoadedOk =
      !/正在加载|加载页面/.test(radarBody) &&
      /ClaimLedger:\s*SEALED_VERIFIED/.test(radarBody) &&
      /多资产机会雷达/.test(radarBody);

    const report = {
      passed:
        nativeContractOk &&
        Boolean(installerFocus) &&
        pageErrors.length === 0 &&
        !hasRenderErr &&
        expertLoadedOk &&
        radarLoadedOk,
      socketName,
      installedInfo: capInfo,
      pairedOk: true,
      otaOk: true,
      inAppApkInstallerOk: Boolean(installerFocus),
      expertLoadedOk,
      radarLoadedOk,
      installerWindowLine: installerFocus,
      toastBox,
      pageErrors,
      screenshots,
    };

    fs.writeFileSync(path.join(outDir, 'emulator_report.json'), JSON.stringify(report, null, 2), 'utf-8');
    console.log(JSON.stringify(report, null, 2));

    if (!report.passed) {
      process.exitCode = 1;
    }
  } finally {
    cdp.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
