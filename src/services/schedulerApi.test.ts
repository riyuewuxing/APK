import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSchedulerStatus,
  runSchedulerTaskNow,
  saveSchedulerConfig,
  testSchedulerWebhook,
} from './schedulerApi';

describe('schedulerApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests GET /api/scheduler/status cleanly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        enabled: true,
        daemon_running: true,
        is_readonly_view: false,
        config_path: '',
        eod_scan_time: '14:45',
        post_close_time: '15:35',
        auto_record_journal: false,
        auto_settle_journal: true,
        windows_notify_enabled: true,
        webhook_type: 'feishu',
        webhook_configured: true,
        webhook_url_masked: 'https://open.feishu.cn/••••demo',
        webhook_verified: true,
        eod_scheme: {
          scheme_name: '默认尾盘强趋势',
          market_cap_min: 50,
          market_cap_max: 200,
          volume_ratio_min: 1.2,
          change_percent_min: 3,
          change_percent_max: 5,
          turnover_rate_min: 5,
          turnover_rate_max: 10,
          exclude_st: true,
          max_candidates: 5,
        },
        watchlist_codes: ['600900'],
        poll_interval_seconds: 20,
        last_eod_scan_date: '2026-11-18',
        last_post_close_date: null,
        tray_badge: { level: 'ok', text: '14:45 扫池 3 只 · GREEN' },
        latest_briefing: null,
        recent_runs: [],
        research_only: true,
        execution_allowed: false,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await fetchSchedulerStatus();
    expect(fetchMock).toHaveBeenCalledWith('/api/scheduler/status', expect.anything());
    expect(status.eod_scan_time).toBe('14:45');
    expect(status.webhook_url_masked).toContain('••••demo');
  });

  it('posts config, test-webhook and run-now endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ record: { status: 'OK' }, status: { enabled: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await saveSchedulerConfig({ enabled: true, eod_scan_time: '14:45' });
    await testSchedulerWebhook({ webhook_type: 'wecom', webhook_url: 'https://example.com/hook' });
    await runSchedulerTaskNow('post_close');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/scheduler/config',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/scheduler/test-webhook',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/scheduler/run-now',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
