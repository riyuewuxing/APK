/**
 * 全局 GPU 点击/触控涟漪反馈 + 原生短震同步（零 React 重渲染）
 */

import type { MouseEvent } from 'react';
import styles from './Ripple.module.css';

interface AndroidHapticBridge {
  triggerHaptic?: (kind: string) => void;
}

export function triggerNativeHaptic(kind: 'tick' | 'tap' | 'confirm' = 'tick'): void {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'off') {
    return;
  }
  try {
    (window as Window & { AndroidThemeBridge?: AndroidHapticBridge })
      .AndroidThemeBridge?.triggerHaptic?.(kind);
  } catch {
    // 非安卓壳静默跳过
  }
}

export function triggerClickRipple(
  event: MouseEvent<HTMLElement>,
  hapticKind: 'tick' | 'tap' | 'confirm' = 'tick'
): void {
  if (typeof document === 'undefined') return;
  if (document.documentElement.getAttribute('data-motion') === 'off') return;

  triggerNativeHaptic(hapticKind);

  const rawTarget = event.currentTarget;
  if (!rawTarget) return;
  // <tr> 无法可靠作为 absolute 定位容器，改挂至首个可见 <td> 内
  const host =
    rawTarget.tagName === 'TR'
      ? (rawTarget.firstElementChild as HTMLElement | null) ?? rawTarget
      : rawTarget;

  const rect = host.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const computed = window.getComputedStyle(host);
  if (computed.position === 'static') {
    host.style.position = 'relative';
  }
  if (computed.overflow === 'visible') {
    host.style.overflow = 'hidden';
  }

  const size = Math.max(rect.width, rect.height) * 2.1;
  const x = event.clientX ? event.clientX - rect.left : rect.width / 2;
  const y = event.clientY ? event.clientY - rect.top : rect.height / 2;

  const ink = document.createElement('span');
  ink.className = styles.rippleInk;
  ink.style.width = `${size}px`;
  ink.style.height = `${size}px`;
  ink.style.left = `${x}px`;
  ink.style.top = `${y}px`;

  host.appendChild(ink);
  const cleanup = () => {
    if (ink.parentNode) {
      ink.parentNode.removeChild(ink);
    }
  };
  ink.addEventListener('animationend', cleanup, { once: true });
  window.setTimeout(cleanup, 520);
}

export function useClickRipple(hapticKind: 'tick' | 'tap' | 'confirm' = 'tick') {
  return (event: MouseEvent<HTMLElement>) => {
    triggerClickRipple(event, hapticKind);
  };
}
