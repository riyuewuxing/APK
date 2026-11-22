/**
 * 平滑插值数字展示组件（等宽防抖动 + 跳价红绿瞬闪反馈）
 */

import { useEffect, useRef } from 'react';
import { animate } from 'framer-motion';
import { useTheme } from '@/hooks';
import styles from './AnimatedNumber.module.css';

interface AnimatedNumberProps {
  value: number | null | undefined;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  format?: (n: number) => string;
  fallback?: string;
  className?: string;
  flashOnChange?: boolean;
}

export function AnimatedNumber({
  value,
  decimals = 2,
  prefix = '',
  suffix = '',
  format,
  fallback = '--',
  className = '',
  flashOnChange = false,
}: AnimatedNumberProps) {
  const { motionLevel } = useTheme();
  const spanRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef<number | null>(
    value != null && Number.isFinite(value) ? value : null
  );

  const formatNum = (n: number) => {
    if (format) {
      return `${prefix}${format(n)}${suffix}`;
    }
    return `${prefix}${n.toFixed(decimals)}${suffix}`;
  };

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    if (value == null || !Number.isFinite(value)) {
      prevRef.current = null;
      el.textContent = fallback;
      return;
    }

    const from = prevRef.current;
    prevRef.current = value;

    if (from === null || motionLevel === 'off' || Math.abs(from - value) < 1e-6) {
      el.textContent = formatNum(value);
      return;
    }

    if (flashOnChange && Math.abs(value - from) >= 1e-6) {
      const flashCls = value > from ? styles.flashRise : styles.flashFall;
      el.classList.remove(styles.flashRise, styles.flashFall);
      void el.offsetWidth;
      el.classList.add(flashCls);
    }

    const duration = motionLevel === 'subtle' ? 0.24 : 0.42;
    const controls = animate(from, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        if (spanRef.current) {
          spanRef.current.textContent = formatNum(latest);
        }
      },
      onComplete: () => {
        if (spanRef.current) {
          spanRef.current.textContent = formatNum(value);
        }
      },
    });

    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals, prefix, suffix, fallback, motionLevel, flashOnChange]);

  const initialText =
    value != null && Number.isFinite(value) ? formatNum(value) : fallback;

  return (
    <span ref={spanRef} className={`tabular-nums ${styles.numRoot} ${className}`.trim()}>
      {initialText}
    </span>
  );
}
