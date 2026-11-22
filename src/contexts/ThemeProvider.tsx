/**
 * 主题上下文 Provider - 6 维金融主题引擎、View Transitions 涟漪转场与原生状态栏桥接
 */

import React, { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  THEME_PRESETS,
  getDefaultPresetForPolarity,
  getThemePresetSpec,
  isValidDensityLevel,
  isValidMotionLevel,
  isValidRadiusMode,
  isValidThemePreset,
  migrateLegacyThemeToPreset,
  type DensityLevel,
  type MotionLevel,
  type RadiusMode,
  type ThemePresetId,
} from '@/themes/presets';
import {
  getStoredDensityLevel,
  getStoredMotionLevel,
  getStoredRadiusMode,
  getStoredTextureEnabled,
  getStoredThemePreset,
  saveStoredDensityLevel,
  saveStoredMotionLevel,
  saveStoredRadiusMode,
  saveStoredTextureEnabled,
  saveStoredThemePreset,
} from '@/services/storage';
import { ThemeContext } from './themeContext';
import type { Theme, ThemeTransitionOrigin } from './themeTypes';

const LEGACY_STORAGE_KEY = 'app.theme';

interface AndroidThemeBridgeApi {
  syncSystemBars?: (hexColor: string, isLightBackground: boolean) => void;
  triggerHaptic?: (kind: string) => void;
}

function getAndroidThemeBridge(): AndroidThemeBridgeApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { AndroidThemeBridge?: AndroidThemeBridgeApi }).AndroidThemeBridge;
}

function getLegacyTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return null;
}

function getSystemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveInitialPreset(): ThemePresetId {
  const storedPreset = getStoredThemePreset();
  if (isValidThemePreset(storedPreset)) return storedPreset;
  const migrated = migrateLegacyThemeToPreset(getLegacyTheme());
  if (migrated) return migrated;
  return getDefaultPresetForPolarity(getSystemTheme());
}

function persistPresetAndPolarity(presetId: ThemePresetId, polarity: Theme): void {
  saveStoredThemePreset(presetId);
  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, polarity);
  } catch {
    // ignore
  }
}

function syncMetaAndNativeBars(presetId: ThemePresetId): void {
  const spec = getThemePresetSpec(presetId);
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', spec.themeColor);
    }
    getAndroidThemeBridge()?.syncSystemBars?.(spec.themeColor, spec.polarity === 'light');
  } catch {
    // 桌面浏览器或无桥接环境静默回退
  }
}

function applyPresetToDom(presetId: ThemePresetId, polarity: Theme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme-preset', presetId);
  root.setAttribute('data-theme', polarity);
  syncMetaAndNativeBars(presetId);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preset, setPresetState] = useState<ThemePresetId>(resolveInitialPreset);
  const [motionLevel, setMotionLevelState] = useState<MotionLevel>(() => {
    const stored = getStoredMotionLevel();
    return isValidMotionLevel(stored) ? stored : 'full';
  });
  const [density, setDensityState] = useState<DensityLevel>(() => {
    const stored = getStoredDensityLevel();
    return isValidDensityLevel(stored) ? stored : 'comfortable';
  });
  const [radiusMode, setRadiusModeState] = useState<RadiusMode>(() => {
    const stored = getStoredRadiusMode();
    return isValidRadiusMode(stored) ? stored : 'preset';
  });
  const [textureEnabled, setTextureEnabledState] = useState<boolean>(getStoredTextureEnabled);

  const theme: Theme = getThemePresetSpec(preset).polarity;

  useEffect(() => {
    applyPresetToDom(preset, theme);
  }, [preset, theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-motion', motionLevel);
  }, [motionLevel]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  useEffect(() => {
    document.documentElement.setAttribute('data-radius-mode', radiusMode);
  }, [radiusMode]);

  useEffect(() => {
    document.documentElement.setAttribute('data-texture', textureEnabled ? 'true' : 'false');
  }, [textureEnabled]);

  // 仅当用户从未显式选择时跟随系统深浅切换
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (!getStoredThemePreset() && !getLegacyTheme()) {
        setPresetState(getDefaultPresetForPolarity(e.matches ? 'dark' : 'light'));
      }
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  const runWithRippleTransition = useCallback(
    (nextPreset: ThemePresetId, origin?: ThemeTransitionOrigin) => {
      const nextSpec = getThemePresetSpec(nextPreset);
      persistPresetAndPolarity(nextPreset, nextSpec.polarity);
      if (motionLevel !== 'off') {
        try {
          getAndroidThemeBridge()?.triggerHaptic?.('confirm');
        } catch {
          // ignore
        }
      }

      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => { ready: Promise<void> };
      };
      const reducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

      if (
        typeof doc.startViewTransition !== 'function' ||
        motionLevel === 'off' ||
        reducedMotion
      ) {
        applyPresetToDom(nextPreset, nextSpec.polarity);
        setPresetState(nextPreset);
        return;
      }

      const x = origin?.x ?? window.innerWidth - 48;
      const y = origin?.y ?? 28;
      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      const transition = doc.startViewTransition(() => {
        flushSync(() => {
          applyPresetToDom(nextPreset, nextSpec.polarity);
          setPresetState(nextPreset);
        });
      });

      transition.ready
        .then(() => {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${endRadius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: motionLevel === 'subtle' ? 240 : 420,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              pseudoElement: '::view-transition-new(root)',
            }
          );
        })
        .catch(() => {
          // ignore view transition cancellation
        });
    },
    [motionLevel]
  );

  const setPreset = useCallback(
    (nextPreset: ThemePresetId, origin?: ThemeTransitionOrigin) => {
      if (!isValidThemePreset(nextPreset) || nextPreset === preset) return;
      runWithRippleTransition(nextPreset, origin);
    },
    [preset, runWithRippleTransition]
  );

  const setTheme = useCallback(
    (newTheme: Theme, origin?: ThemeTransitionOrigin) => {
      const currentPolarity = getThemePresetSpec(preset).polarity;
      if (newTheme === currentPolarity) return;
      runWithRippleTransition(getDefaultPresetForPolarity(newTheme), origin);
    },
    [preset, runWithRippleTransition]
  );

  const toggleTheme = useCallback(
    (origin?: ThemeTransitionOrigin) => {
      const nextPolarity: Theme = theme === 'dark' ? 'light' : 'dark';
      runWithRippleTransition(getDefaultPresetForPolarity(nextPolarity), origin);
    },
    [theme, runWithRippleTransition]
  );

  const setMotionLevel = useCallback((level: MotionLevel) => {
    if (!isValidMotionLevel(level)) return;
    saveStoredMotionLevel(level);
    document.documentElement.setAttribute('data-motion', level);
    setMotionLevelState(level);
  }, []);

  const setDensity = useCallback((nextDensity: DensityLevel) => {
    if (!isValidDensityLevel(nextDensity)) return;
    saveStoredDensityLevel(nextDensity);
    document.documentElement.setAttribute('data-density', nextDensity);
    setDensityState(nextDensity);
  }, []);

  const setRadiusMode = useCallback((mode: RadiusMode) => {
    if (!isValidRadiusMode(mode)) return;
    saveStoredRadiusMode(mode);
    document.documentElement.setAttribute('data-radius-mode', mode);
    setRadiusModeState(mode);
  }, []);

  const setTextureEnabled = useCallback((enabled: boolean) => {
    saveStoredTextureEnabled(enabled);
    document.documentElement.setAttribute('data-texture', enabled ? 'true' : 'false');
    setTextureEnabledState(enabled);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        preset,
        motionLevel,
        density,
        radiusMode,
        textureEnabled,
        availablePresets: THEME_PRESETS,
        toggleTheme,
        setTheme,
        setPreset,
        setMotionLevel,
        setDensity,
        setRadiusMode,
        setTextureEnabled,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
