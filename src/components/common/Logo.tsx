/**
 * 终端品牌矢量标（随当前主题 --color-accent / --color-accent-2 自适应着色）
 */

import { useId } from 'react';

interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 32, className }: LogoProps) {
  const uid = useId().replace(/:/g, '');
  const strokeGradId = `logo-stroke-${uid}`;
  const glowGradId = `logo-glow-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="全球投资终端 Logo"
    >
      <defs>
        <linearGradient id={strokeGradId} x1="8" y1="8" x2="92" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--color-accent)" />
          <stop offset="100%" stopColor="var(--color-accent-2)" />
        </linearGradient>
        <linearGradient id={glowGradId} x1="16" y1="74" x2="84" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--color-accent-2)" stopOpacity="0.32" />
        </linearGradient>
      </defs>
      <rect
        x="6"
        y="6"
        width="88"
        height="88"
        rx="20"
        fill="var(--bg-elevated)"
        stroke={`url(#${strokeGradId})`}
        strokeWidth="4.5"
      />
      <rect x="13" y="13" width="74" height="74" rx="14" fill={`url(#${glowGradId})`} opacity="0.45" />
      <path
        d="M22 68 L36 53 L49 59 L64 33 L74 44 L82 26"
        stroke={`url(#${strokeGradId})`}
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="36" cy="53" r="3.8" fill="var(--bg-primary)" stroke="var(--color-accent)" strokeWidth="2.5" />
      <circle cx="64" cy="33" r="3.8" fill="var(--bg-primary)" stroke="var(--color-accent-2)" strokeWidth="2.5" />
      <circle cx="82" cy="26" r="5" fill="var(--color-accent)" />
    </svg>
  );
}
