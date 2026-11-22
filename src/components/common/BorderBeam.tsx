/**
 * 克制巡航流光描边组件（对标 Magic UI BorderBeam；仅完整动效下可见）
 */

import type { CSSProperties } from 'react';
import styles from './BorderBeam.module.css';

interface BorderBeamProps {
  duration?: number;
  size?: string;
  colorFrom?: string;
  colorTo?: string;
  className?: string;
}

export function BorderBeam({
  duration = 6,
  size = '220%',
  colorFrom,
  colorTo,
  className = '',
}: BorderBeamProps) {
  const vars = {
    '--beam-duration': `${duration}s`,
    '--beam-size': size,
    ...(colorFrom ? { '--beam-from': colorFrom } : {}),
    ...(colorTo ? { '--beam-to': colorTo } : {}),
  } as CSSProperties;

  return (
    <span className={`${styles.beam} ${className}`.trim()} style={vars} aria-hidden="true">
      <span className={styles.beamSpinner} />
    </span>
  );
}
