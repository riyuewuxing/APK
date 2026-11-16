import type { HeatmapConfig } from '@/types';

export const COLOR_FIELD_OPTIONS = [
  { key: 'changePercent', label: '涨跌幅' },
  { key: 'turnoverRate', label: '换手率' },
  { key: 'volumeRatio', label: '量比' },
];

export const SIZE_FIELD_OPTIONS = [
  { key: 'totalMarketCap', label: '总市值' },
  { key: 'amount', label: '成交额' },
];

export function resolveHeatmapControls(
  dimension: HeatmapConfig['dimension'],
  config: Pick<HeatmapConfig, 'colorField' | 'sizeField'>
) {
  const isBoardDimension = dimension === 'industry' || dimension === 'concept';
  const colorFieldOptions = isBoardDimension
    ? COLOR_FIELD_OPTIONS.filter((option) => option.key === 'changePercent')
    : COLOR_FIELD_OPTIONS;
  const sizeFieldOptions = isBoardDimension
    ? SIZE_FIELD_OPTIONS.filter((option) => option.key === 'amount')
    : SIZE_FIELD_OPTIONS;
  const effectiveColorField: HeatmapConfig['colorField'] = isBoardDimension
    ? 'changePercent'
    : config.colorField;
  const effectiveSizeField: HeatmapConfig['sizeField'] = isBoardDimension
    ? 'amount'
    : config.sizeField;
  return {
    isBoardDimension,
    colorFieldOptions,
    sizeFieldOptions,
    effectiveColorField,
    effectiveSizeField,
  };
}
