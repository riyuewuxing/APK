import type { Theme } from '@/contexts/themeTypes';

export type ThemePresetId =
  | 'obsidian-pro'
  | 'emerald-desk'
  | 'amber-terminal'
  | 'daylight-swiss'
  | 'crimson-silk';

export type MotionLevel = 'full' | 'subtle' | 'off';
export type DensityLevel = 'compact' | 'comfortable' | 'spacious';
export type RadiusMode = 'preset' | 'sharp' | 'rounded';
export type BackdropType =
  | 'aurora-grid'
  | 'emerald-matrix'
  | 'amber-hud'
  | 'swiss-blueprint'
  | 'silk-paper';

export interface ThemePresetChartPalette {
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

export interface ThemePresetSpec {
  id: ThemePresetId;
  polarity: Theme;
  name: string;
  englishName: string;
  desc: string;
  scene: string;
  themeColor: string;
  backdropType: BackdropType;
  fontHeadingStyle: 'quant' | 'terminal' | 'editorial';
  hollowBull?: boolean;
  previewColors: [string, string, string, string];
  chart: ThemePresetChartPalette;
}

export const DEFAULT_DARK_PRESET: ThemePresetId = 'obsidian-pro';
export const DEFAULT_LIGHT_PRESET: ThemePresetId = 'daylight-swiss';

export const THEME_PRESETS: readonly ThemePresetSpec[] = [
  {
    id: 'obsidian-pro',
    polarity: 'dark',
    name: '黑曜量化',
    englishName: 'Obsidian Quant',
    desc: '深空蓝黑磨砂玻璃 · 胶片噪点与径向坐标网格',
    scene: '主力全能高频看盘',
    themeColor: '#050811',
    backdropType: 'aurora-grid',
    fontHeadingStyle: 'quant',
    previewColors: ['#050811', '#0d1424', '#38bdf8', '#3b82f6'],
    chart: {
      borderPrimary: '#1e293b',
      borderSecondary: '#0f172a',
      textTertiary: '#94a3b8',
      bgElevated: '#162033',
      textPrimary: '#f1f5f9',
      accent: '#38bdf8',
      accent2: '#3b82f6',
      bgCard: '#0d1424',
      tooltipBg: 'rgba(11, 17, 32, 0.96)',
      gridLine: 'rgba(148, 163, 184, 0.08)',
    },
  },
  {
    id: 'emerald-desk',
    polarity: 'dark',
    name: '翡翠交易台',
    englishName: 'Emerald Desk',
    desc: '深墨翠底极光雾 · 赛博点阵与雷达扫描弧',
    scene: '深夜长时间盯盘',
    themeColor: '#040d0a',
    backdropType: 'emerald-matrix',
    fontHeadingStyle: 'quant',
    previewColors: ['#040d0a', '#081813', '#10b981', '#06b6d4'],
    chart: {
      borderPrimary: '#14332a',
      borderSecondary: '#091f19',
      textTertiary: '#86a99e',
      bgElevated: '#0f2820',
      textPrimary: '#ecfdf5',
      accent: '#10b981',
      accent2: '#06b6d4',
      bgCard: '#081813',
      tooltipBg: 'rgba(6, 20, 15, 0.96)',
      gridLine: 'rgba(16, 185, 129, 0.09)',
    },
  },
  {
    id: 'amber-terminal',
    polarity: 'dark',
    name: '经典琥珀终端',
    englishName: 'Bloomberg Pro',
    desc: '零模糊硬朗微直角 · 刻度标尺与空心机构蜡烛',
    scene: '机构硬核极速扫表',
    themeColor: '#080705',
    backdropType: 'amber-hud',
    fontHeadingStyle: 'terminal',
    hollowBull: true,
    previewColors: ['#080705', '#12100c', '#f59e0b', '#fbbf24'],
    chart: {
      borderPrimary: '#2c2519',
      borderSecondary: '#18140d',
      textTertiary: '#a89f8d',
      bgElevated: '#1f1a12',
      textPrimary: '#fef3c7',
      accent: '#f59e0b',
      accent2: '#fbbf24',
      bgCard: '#12100c',
      tooltipBg: 'rgba(20, 17, 12, 0.98)',
      gridLine: 'rgba(245, 158, 11, 0.08)',
    },
  },
  {
    id: 'daylight-swiss',
    polarity: 'light',
    name: '瑞士冰川日报',
    englishName: 'Swiss Editorial',
    desc: '冷珍珠岩底配建筑蓝图点阵与凝脂白浮雕卡',
    scene: '日间高精度看盘审阅',
    themeColor: '#eef2f7',
    backdropType: 'swiss-blueprint',
    fontHeadingStyle: 'quant',
    previewColors: ['#eef2f7', '#ffffff', '#1d4ed8', '#0284c7'],
    chart: {
      borderPrimary: '#dbe3ee',
      borderSecondary: '#e8eef5',
      textTertiary: '#64748b',
      bgElevated: '#e2e8f0',
      textPrimary: '#0f172a',
      accent: '#1d4ed8',
      accent2: '#0284c7',
      bgCard: '#ffffff',
      tooltipBg: 'rgba(255, 255, 255, 0.98)',
      gridLine: 'rgba(15, 23, 42, 0.07)',
    },
  },
  {
    id: 'crimson-silk',
    polarity: 'light',
    name: '朱砂宣纸',
    englishName: 'Editorial Silk',
    desc: '宣纸纤维SVG噪点底纹 · 象牙纸卡配朱砂瓷青',
    scene: '日间深度研报护眼阅读',
    themeColor: '#f5f1e8',
    backdropType: 'silk-paper',
    fontHeadingStyle: 'editorial',
    previewColors: ['#f5f1e8', '#fffdf8', '#c2410c', '#0f766e'],
    chart: {
      borderPrimary: '#e5dec9',
      borderSecondary: '#efe9d8',
      textTertiary: '#78716c',
      bgElevated: '#ebe4d1',
      textPrimary: '#1c1917',
      accent: '#c2410c',
      accent2: '#0f766e',
      bgCard: '#fffdf8',
      tooltipBg: 'rgba(255, 252, 244, 0.98)',
      gridLine: 'rgba(28, 25, 23, 0.07)',
    },
  },
];

export function isValidThemePreset(val: unknown): val is ThemePresetId {
  return THEME_PRESETS.some((p) => p.id === val);
}

export function isValidMotionLevel(val: unknown): val is MotionLevel {
  return val === 'full' || val === 'subtle' || val === 'off';
}

export function isValidDensityLevel(val: unknown): val is DensityLevel {
  return val === 'compact' || val === 'comfortable' || val === 'spacious';
}

export function isValidRadiusMode(val: unknown): val is RadiusMode {
  return val === 'preset' || val === 'sharp' || val === 'rounded';
}

export function getThemePresetSpec(presetId: ThemePresetId): ThemePresetSpec {
  return THEME_PRESETS.find((p) => p.id === presetId) ?? THEME_PRESETS[0];
}

export function getDefaultPresetForPolarity(polarity: Theme): ThemePresetId {
  return polarity === 'light' ? DEFAULT_LIGHT_PRESET : DEFAULT_DARK_PRESET;
}

export function migrateLegacyThemeToPreset(legacyTheme: Theme | null): ThemePresetId | null {
  if (legacyTheme === 'light') return DEFAULT_LIGHT_PRESET;
  if (legacyTheme === 'dark') return DEFAULT_DARK_PRESET;
  return null;
}
