import { describe, expect, it } from 'vitest';
import {
  formatTerminalCodeLabel,
  globalRowToTerminalQuote,
  isSupportedWatchlistCode,
} from './watchlistGlobalAdapter';

describe('watchlistGlobalAdapter', () => {
  it('converts outer global stock row into compatible TerminalQuote', () => {
    const tq = globalRowToTerminalQuote({
      symbol: 'kr005930',
      raw_code: '005930',
      market: 'kr',
      name: '三星电子',
      en_name: 'Samsung Electronics',
      currency: 'KRW',
      price: 183100,
      change_pct: -7.01,
      volume: 17518562,
      market_cap: 1.17e15,
      amount: 3.21e12,
      pe_ttm: 5.73,
      sector_key: 'electronic_technology',
      sector: '电子科技',
      industry: '半导体',
    });

    expect(tq.code).toBe('kr005930');
    expect(tq.__currency).toBe('KRW');
    expect(tq.__market).toBe('kr');
    expect(tq.changePercent).toBe(-7.01);
    expect(tq.prevClose).toBeGreaterThan(196000);
  });

  it('validates mixed A-share and global watchlist codes and labels', () => {
    expect(isSupportedWatchlistCode('600900')).toBe(true);
    expect(isSupportedWatchlistCode('kr005930')).toBe(true);
    expect(isSupportedWatchlistCode('usBRK.B')).toBe(true);
    expect(isSupportedWatchlistCode('euASML.AS')).toBe(true);
    expect(isSupportedWatchlistCode('invalid_xyz')).toBe(false);

    expect(formatTerminalCodeLabel('sh600900')).toBe('600900');
    expect(formatTerminalCodeLabel('kr005930')).toBe('kr005930');
  });
});
