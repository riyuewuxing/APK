import type { Theme } from '@/contexts/themeTypes';
import {
  DEFAULT_DARK_PRESET,
  DEFAULT_LIGHT_PRESET,
  getThemePresetSpec,
  type ThemePresetId,
} from '@/themes/presets';

export interface ChartColors {
  rise: string;
  fall: string;
  flat: string;
  borderPrimary: string;
  borderSecondary: string;
  textTertiary: string;
  bgElevated: string;
  textPrimary: string;
  accent: string;
  accent2: string;
  bgCard: string;
  tooltipBg: string;
  gridLine: string;
}

export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.trim();
  if (!clean.startsWith('#') || (clean.length !== 7 && clean.length !== 4)) {
    return clean;
  }
  const full =
    clean.length === 4
      ? `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`
      : clean;
  const value = Number.parseInt(full.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export interface CrosshairOptions {
  linkAllAxes?: boolean;
  labelPrecision?: number;
}

/**
 * 构造 ECharts `tooltip.axisPointer` 金融级横竖交叉十字准星。
 */
export function buildCrosshairAxisPointer(
  colors: ChartColors,
  options?: CrosshairOptions
) {
  const precision = options?.labelPrecision ?? 2;
  const lineStyle = {
    color: withAlpha(colors.accent, 0.58),
    width: 1,
    type: 'dashed' as const,
  };
  return {
    type: 'cross' as const,
    snap: true,
    lineStyle,
    crossStyle: lineStyle,
    label: {
      show: true,
      precision,
      backgroundColor: colors.bgElevated,
      borderColor: colors.accent,
      borderWidth: 1,
      color: colors.textPrimary,
      fontSize: 10.5,
      padding: [3, 6] as [number, number],
      borderRadius: 3,
    },
  };
}

/**
 * 构造 ECharts 顶层联动 `axisPointer`（用于 K 线 + 成交量/副图多网格）。
 */
export function buildCrosshairGlobalAxisPointer(
  colors: ChartColors,
  options?: CrosshairOptions
) {
  return {
    ...(options?.linkAllAxes !== false ? { link: [{ xAxisIndex: 'all' as const }] } : {}),
    lineStyle: {
      color: withAlpha(colors.accent, 0.58),
      width: 1,
      type: 'dashed' as const,
    },
    label: {
      show: true,
      backgroundColor: colors.bgElevated,
      borderColor: colors.accent,
      borderWidth: 1,
      color: colors.textPrimary,
      fontSize: 10.5,
      padding: [3, 6] as [number, number],
      borderRadius: 3,
    },
  };
}

/**
 * 构造单轴边沿数字/时间胶囊指针标签（支持自定义格式化回调）。
 */
export function buildAxisPointerLabel(
  colors: ChartColors,
  formatter?: (params: { value: unknown }) => string
) {
  return {
    show: true,
    lineStyle: {
      color: withAlpha(colors.accent, 0.58),
      width: 1,
      type: 'dashed' as const,
    },
    label: {
      show: true,
      backgroundColor: colors.bgElevated,
      borderColor: colors.accent,
      borderWidth: 1,
      color: colors.textPrimary,
      fontSize: 10.5,
      padding: [3, 6] as [number, number],
      borderRadius: 3,
      ...(formatter ? { formatter } : {}),
    },
  };
}

export function getChartColors(
  theme: Theme,
  colorMode: 'red-rise' | 'green-rise',
  preset?: ThemePresetId
): ChartColors {
  const resolvedPreset =
    preset ?? (theme === 'light' ? DEFAULT_LIGHT_PRESET : DEFAULT_DARK_PRESET);
  const spec = getThemePresetSpec(resolvedPreset);
  const isLight = spec.polarity === 'light';
  const rise =
    colorMode === 'green-rise'
      ? isLight
        ? '#059669'
        : '#10b981'
      : isLight
        ? '#dc2626'
        : '#ef4444';
  const fall =
    colorMode === 'green-rise'
      ? isLight
        ? '#dc2626'
        : '#ef4444'
      : isLight
        ? '#059669'
        : '#10b981';
  return {
    ...spec.chart,
    rise,
    fall,
    flat: spec.chart.textTertiary,
  };
}
