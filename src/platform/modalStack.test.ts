import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearModalStackForTest,
  closeTopModal,
  isRootTabRoute,
  registerModalCloser,
} from './modalStack';

describe('modalStack & root route detection', () => {
  afterEach(() => {
    clearModalStackForTest();
  });

  it('closes modals in LIFO order and returns false when empty', () => {
    const first = vi.fn();
    const second = vi.fn();
    registerModalCloser('drawer', first);
    registerModalCloser('quantstats', second);

    expect(closeTopModal()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    expect(closeTopModal()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);

    expect(closeTopModal()).toBe(false);
  });

  it('distinguishes root tabs from sub-views', () => {
    expect(isRootTabRoute('/')).toBe(true);
    expect(isRootTabRoute('/expert')).toBe(true);
    expect(isRootTabRoute('/expert-radar')).toBe(true);
    expect(isRootTabRoute('/watchlist')).toBe(true);

    expect(isRootTabRoute('/expert', '?symbol=600519')).toBe(false);
    expect(isRootTabRoute('/stock/600519')).toBe(false);
    expect(isRootTabRoute('/settings')).toBe(false);
  });
});
