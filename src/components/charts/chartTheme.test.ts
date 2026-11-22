import { describe, expect, it } from 'vitest';
import {
  buildAxisPointerLabel,
  buildCrosshairAxisPointer,
  buildCrosshairGlobalAxisPointer,
  getChartColors,
} from './chartTheme';

describe('chartTheme crosshair & preset tokens', () => {
  it('builds dashed crosshair axisPointer with high-contrast label badge', () => {
    const colors = getChartColors('dark', 'red-rise', 'amber-terminal');
    const pointer = buildCrosshairAxisPointer(colors);

    expect(pointer.type).toBe('cross');
    expect(pointer.lineStyle.type).toBe('dashed');
    expect(pointer.label.show).toBe(true);
    expect(pointer.label.backgroundColor).toBe(colors.bgElevated);
    expect(pointer.label.borderColor).toBe(colors.accent);
  });

  it('builds global linked crosshair pointer for multi-grid K-line charts', () => {
    const colors = getChartColors('light', 'red-rise', 'crimson-silk');
    const globalPointer = buildCrosshairGlobalAxisPointer(colors);

    expect(globalPointer.link).toEqual([{ xAxisIndex: 'all' }]);
    expect(globalPointer.lineStyle.type).toBe('dashed');
    expect(globalPointer.label.color).toBe(colors.textPrimary);
  });

  it('builds axis edge pointer labels with optional custom formatter', () => {
    const colors = getChartColors('dark', 'green-rise', 'obsidian-pro');
    const fmt = ({ value }: { value: unknown }) => `${Number(value).toFixed(2)}%`;
    const pointer = buildAxisPointerLabel(colors, fmt);

    expect(pointer.show).toBe(true);
    expect(pointer.label.borderColor).toBe(colors.accent);
    expect(pointer.label.formatter?.({ value: 3.456 })).toBe('3.46%');
  });
});
