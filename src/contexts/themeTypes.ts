/**
 * 主题类型定义（6 维正交主题引擎）
 */

import type {
  DensityLevel,
  MotionLevel,
  RadiusMode,
  ThemePresetId,
  ThemePresetSpec,
} from '@/themes/presets';

export type Theme = 'light' | 'dark';

export interface ThemeTransitionOrigin {
  x: number;
  y: number;
}

export interface ThemeContextValue {
  theme: Theme;
  preset: ThemePresetId;
  motionLevel: MotionLevel;
  density: DensityLevel;
  radiusMode: RadiusMode;
  textureEnabled: boolean;
  availablePresets: readonly ThemePresetSpec[];
  toggleTheme: (origin?: ThemeTransitionOrigin) => void;
  setTheme: (theme: Theme, origin?: ThemeTransitionOrigin) => void;
  setPreset: (preset: ThemePresetId, origin?: ThemeTransitionOrigin) => void;
  setMotionLevel: (level: MotionLevel) => void;
  setDensity: (density: DensityLevel) => void;
  setRadiusMode: (mode: RadiusMode) => void;
  setTextureEnabled: (enabled: boolean) => void;
}
