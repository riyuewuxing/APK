/**
 * 分主题专属空间氛围与 SVG 纹理背景组件（对标 Magic UI Dot/Grid + SVG Turbulence）
 */

import { useId } from 'react';
import { useTheme } from '@/hooks';
import { getThemePresetSpec } from '@/themes/presets';
import styles from './ThemeBackdrop.module.css';

export function ThemeBackdrop() {
  const { preset, textureEnabled } = useTheme();
  const uid = useId().replace(/:/g, '');

  if (!textureEnabled) {
    return null;
  }

  const { backdropType } = getThemePresetSpec(preset);
  const patternId = `bd-pat-${uid}`;
  const noiseId = `bd-noise-${uid}`;

  return (
    <div className={styles.backdrop} data-backdrop={backdropType} aria-hidden="true">
      {backdropType === 'aurora-grid' && (
        <>
          <div className={styles.auroraObsidian} />
          <svg className={styles.svgLayer}>
            <defs>
              <pattern id={patternId} width="32" height="32" patternUnits="userSpaceOnUse">
                <path
                  d="M 32 0 L 0 0 0 32"
                  fill="none"
                  stroke="rgba(148, 163, 184, 0.08)"
                  strokeWidth="0.75"
                />
              </pattern>
              <filter id={noiseId}>
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.85"
                  numOctaves="2"
                  stitchTiles="stitch"
                />
              </filter>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${patternId})`} className={styles.radialFade} />
            <rect width="100%" height="100%" filter={`url(#${noiseId})`} opacity="0.032" />
          </svg>
        </>
      )}

      {backdropType === 'emerald-matrix' && (
        <>
          <div className={styles.auroraEmerald} />
          <svg className={styles.svgLayer}>
            <defs>
              <pattern id={patternId} width="22" height="22" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="rgba(16, 185, 129, 0.22)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${patternId})`} className={styles.radialFade} />
            <circle
              cx="88%"
              cy="18%"
              r="340"
              fill="none"
              stroke="rgba(16, 185, 129, 0.08)"
              strokeWidth="1"
              strokeDasharray="6 8"
            />
            <circle
              cx="88%"
              cy="18%"
              r="520"
              fill="none"
              stroke="rgba(6, 182, 212, 0.06)"
              strokeWidth="1"
            />
          </svg>
        </>
      )}

      {backdropType === 'amber-hud' && (
        <>
          <svg className={styles.svgLayer}>
            <defs>
              <pattern id={patternId} width="24" height="24" patternUnits="userSpaceOnUse">
                <path
                  d="M 12 8 L 12 16 M 8 12 L 16 12"
                  fill="none"
                  stroke="rgba(245, 158, 11, 0.16)"
                  strokeWidth="0.8"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${patternId})`} opacity="0.7" />
          </svg>
          <div className={styles.amberScanlines} />
        </>
      )}

      {backdropType === 'swiss-blueprint' && (
        <>
          <div className={styles.swissColumnGuide} />
          <svg className={styles.svgLayer}>
            <defs>
              <pattern id={patternId} width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1.5" cy="1.5" r="1.1" fill="rgba(15, 23, 42, 0.09)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${patternId})`} />
          </svg>
        </>
      )}

      {backdropType === 'silk-paper' && (
        <>
          <div className={styles.silkWash} />
          <svg className={styles.svgLayer}>
            <defs>
              <filter id={noiseId}>
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.78"
                  numOctaves="3"
                  stitchTiles="stitch"
                />
                <feColorMatrix type="saturate" values="0.2" />
              </filter>
            </defs>
            <rect width="100%" height="100%" filter={`url(#${noiseId})`} opacity="0.045" />
          </svg>
        </>
      )}
    </div>
  );
}
