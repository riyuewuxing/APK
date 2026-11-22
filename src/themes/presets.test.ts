import { describe, expect, it } from 'vitest';
import {
  THEME_PRESETS,
  getDefaultPresetForPolarity,
  getThemePresetSpec,
  isValidDensityLevel,
  isValidMotionLevel,
  isValidRadiusMode,
  isValidThemePreset,
  migrateLegacyThemeToPreset,
} from './presets';

describe('theme presets registry', () => {
  it('defines 5 orthogonal presets covering dark and light polarities and 6D tokens', () => {
    expect(THEME_PRESETS).toHaveLength(5);
    const ids = new Set(THEME_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(5);
    expect(THEME_PRESETS.some((p) => p.polarity === 'dark')).toBe(true);
    expect(THEME_PRESETS.some((p) => p.polarity === 'light')).toBe(true);
    for (const p of THEME_PRESETS) {
      expect(p.previewColors).toHaveLength(4);
      expect(p.themeColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(p.backdropType.length).toBeGreaterThan(0);
      expect(p.fontHeadingStyle.length).toBeGreaterThan(0);
      expect(p.chart.accent).toMatch(/^#/);
      expect(p.chart.tooltipBg.length).toBeGreaterThan(0);
    }
  });

  it('validates preset, motion, density and radius identifiers safely', () => {
    expect(isValidThemePreset('obsidian-pro')).toBe(true);
    expect(isValidThemePreset('amber-terminal')).toBe(true);
    expect(isValidThemePreset('daylight-swiss')).toBe(true);
    expect(isValidThemePreset('crimson-silk')).toBe(true);
    expect(isValidThemePreset('unknown-theme')).toBe(false);

    expect(isValidMotionLevel('full')).toBe(true);
    expect(isValidMotionLevel('subtle')).toBe(true);
    expect(isValidMotionLevel('off')).toBe(true);
    expect(isValidMotionLevel('turbo')).toBe(false);

    expect(isValidDensityLevel('compact')).toBe(true);
    expect(isValidDensityLevel('comfortable')).toBe(true);
    expect(isValidDensityLevel('spacious')).toBe(true);
    expect(isValidDensityLevel('ultra')).toBe(false);

    expect(isValidRadiusMode('preset')).toBe(true);
    expect(isValidRadiusMode('sharp')).toBe(true);
    expect(isValidRadiusMode('rounded')).toBe(true);
    expect(isValidRadiusMode('pill')).toBe(false);
  });

  it('migrates legacy dark/light app.theme values without visual regression', () => {
    expect(getDefaultPresetForPolarity('dark')).toBe('obsidian-pro');
    expect(getDefaultPresetForPolarity('light')).toBe('daylight-swiss');
    expect(migrateLegacyThemeToPreset('dark')).toBe('obsidian-pro');
    expect(migrateLegacyThemeToPreset('light')).toBe('daylight-swiss');
    expect(migrateLegacyThemeToPreset(null)).toBeNull();
    expect(getThemePresetSpec('emerald-desk').polarity).toBe('dark');
    expect(getThemePresetSpec('crimson-silk').polarity).toBe('light');
    expect(getThemePresetSpec('amber-terminal').hollowBull).toBe(true);
  });
});
