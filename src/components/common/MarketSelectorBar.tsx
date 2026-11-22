import { useId } from 'react';
import { motion } from 'framer-motion';
import { GLOBAL_MARKET_LIST, type GlobalMarketId } from '@/services/globalMarketsApi';
import { triggerClickRipple } from './useClickRipple';
import styles from './MarketSelectorBar.module.css';

interface MarketSelectorBarProps {
  value: string;
  onChange: (market: string) => void;
  showWatchlistTab?: boolean;
  sessionStates?: Partial<Record<GlobalMarketId, 'TRADING' | 'CLOSED' | '24H' | 'DAILY'>>;
  testIdPrefix?: string;
}

export function MarketSelectorBar({
  value,
  onChange,
  showWatchlistTab = false,
  sessionStates,
  testIdPrefix = 'market-tab',
}: MarketSelectorBarProps) {
  const uid = useId();
  const layoutId = `market-pill-${uid}`;

  return (
    <div className={styles.bar} role="tablist" aria-label="全球市场切换">
      {showWatchlistTab && (
        <button
          type="button"
          role="tab"
          aria-selected={value === 'watchlist'}
          data-testid={`${testIdPrefix}-watchlist`}
          className={`${styles.item} ${value === 'watchlist' ? styles.active : ''}`}
          onClick={(e) => {
            triggerClickRipple(e, 'tick');
            onChange('watchlist');
          }}
        >
          {value === 'watchlist' && (
            <motion.span
              layoutId={layoutId}
              className={styles.activeBg}
              transition={{ type: 'spring', stiffness: 450, damping: 34 }}
            />
          )}
          <span className={styles.badge}>自选</span>
          <span className={styles.itemLabel}>我的自选</span>
        </button>
      )}
      {GLOBAL_MARKET_LIST.map((m) => {
        const isActive = value === m.id;
        const sess = sessionStates?.[m.id];
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`${testIdPrefix}-${m.id}`}
            className={`${styles.item} ${isActive ? styles.active : ''}`}
            onClick={(e) => {
              triggerClickRipple(e, 'tick');
              onChange(m.id);
            }}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className={styles.activeBg}
                transition={{ type: 'spring', stiffness: 450, damping: 34 }}
              />
            )}
            <span className={styles.badge}>{m.badge}</span>
            <span className={styles.itemLabel}>{m.label}</span>
            {sess && (
              <span
                className={`${styles.dot} ${sess === 'TRADING' || sess === '24H' ? styles.dotLive : styles.dotClosed}`}
                title={sess === 'TRADING' ? '盘中' : '已休市'}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
