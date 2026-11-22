/**
 * 格式化工具函数
 */

/**
 * 格式化数字（千分位）
 */
export function formatNumber(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * 格式化价格
 */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  return value.toFixed(2);
}

/**
 * 格式化涨跌幅
 */
export function formatPercent(
  value: number | null | undefined,
  showSign = true
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  // (-0.004).toFixed(2) === '-0.00'，微跌会显示成带负号的零
  const fixed = value.toFixed(2) === '-0.00' ? '0.00' : value.toFixed(2);
  const sign = showSign && value > 0 && fixed !== '0.00' ? '+' : '';
  return `${sign}${fixed}%`;
}

/**
 * 格式化涨跌额
 */
export function formatChange(
  value: number | null | undefined,
  showSign = true
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  const fixed = value.toFixed(2) === '-0.00' ? '0.00' : value.toFixed(2);
  const sign = showSign && value > 0 && fixed !== '0.00' ? '+' : '';
  return `${sign}${fixed}`;
}

/**
 * 格式化成交量（手）
 */
export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  if (value >= 100000000) {
    return `${(value / 100000000).toFixed(2)}亿`;
  }
  if (value >= 10000) {
    return `${(value / 10000).toFixed(2)}万`;
  }
  return value.toFixed(0);
}

/**
 * 格式化成交额（万元）
 */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  if (value >= 10000) {
    return `${(value / 10000).toFixed(2)}亿`;
  }
  if (value >= 1) {
    return `${value.toFixed(2)}万`;
  }
  return `${(value * 10000).toFixed(0)}元`;
}

/**
 * 格式化金额（元）
 */
export function formatYuanAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }

  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absValue >= 1000000000000) {
    return `${sign}${(absValue / 1000000000000).toFixed(2)}万亿`;
  }
  if (absValue >= 100000000) {
    return `${sign}${(absValue / 100000000).toFixed(2)}亿`;
  }
  if (absValue >= 10000) {
    return `${sign}${(absValue / 10000).toFixed(2)}万`;
  }

  return `${sign}${absValue.toFixed(0)}元`;
}

/**
 * 格式化通用大数（非金额）
 */
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }

  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absValue >= 100000000) {
    return `${sign}${(absValue / 100000000).toFixed(2)}亿`;
  }
  if (absValue >= 10000) {
    return `${sign}${(absValue / 10000).toFixed(2)}万`;
  }

  return `${sign}${absValue.toFixed(0)}`;
}

/**
 * 格式化市值（亿）
 */
export function formatMarketCap(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  if (value >= 10000) {
    return `${(value / 10000).toFixed(2)}万亿`;
  }
  return `${value.toFixed(2)}亿`;
}

/**
 * 格式化换手率
 */
export function formatTurnover(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  return `${value.toFixed(2)}%`;
}

/**
 * 格式化量比
 */
export function formatVolumeRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  return value.toFixed(2);
}

/**
 * 格式化 PE/PB
 */
export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  if (value < 0) {
    return '亏损';
  }
  return value.toFixed(2);
}

/**
 * 获取涨跌颜色类名
 */
export function getChangeColorClass(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value) || value === 0) {
    return 'text-flat';
  }
  return value > 0 ? 'text-rise' : 'text-fall';
}

/**
 * 资产所属市场标识
 */
export type AssetMarketId = 'cn' | 'hk' | 'us' | 'jp' | 'kr' | 'eu';

const OUTER_PREFIX_RE = /^(hk|us|jp|kr|kq|eu)(.+)$/i;

/**
 * 判定股票/标的所属市场（优先匹配明确外围前缀，防止 kr005930 等与 6 位 A 股冲突）
 */
export function detectAssetMarket(code: string): AssetMarketId {
  const trimmed = String(code ?? '').trim();
  const match = trimmed.match(OUTER_PREFIX_RE);
  if (match) {
    const prefix = match[1].toLowerCase();
    if (prefix === 'kq') return 'kr';
    return prefix as AssetMarketId;
  }
  return 'cn';
}

/**
 * 按货币格式化价格（适配 JPY/KRW 整数、LSE GBX 便士与美港欧小数）
 */
export function formatCurrencyPrice(
  value: number | null | undefined,
  currency: string = 'CNY'
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  const cur = currency.trim();
  const curUp = cur.toUpperCase();
  if (curUp === 'JPY' || curUp === 'KRW') {
    const sym = curUp === 'JPY' ? '¥' : '₩';
    return `${sym}${Math.round(value).toLocaleString('en-US')}`;
  }
  if (cur === 'GBp' || curUp === 'GBX') {
    return `${value.toFixed(1)} GBX`;
  }
  const symMap: Record<string, string> = {
    USD: '$',
    HKD: 'HK$',
    EUR: '€',
    GBP: '£',
    CHF: 'CHF ',
    CNY: '¥',
  };
  const prefix = symMap[curUp] ?? `${curUp} `;
  const decimals = Math.abs(value) < 10 ? 3 : 2;
  return `${prefix}${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * 按货币格式化市值或成交额（日元/韩元使用兆/亿，其余使用万亿/亿）
 */
export function formatMarketValueByCurrency(
  value: number | null | undefined,
  currency: string = 'USD'
): string {
  if (value === null || value === undefined || isNaN(value) || value <= 0) {
    return '--';
  }
  const curUp = currency.trim().toUpperCase();
  const symMap: Record<string, string> = {
    USD: '$',
    HKD: 'HK$',
    EUR: '€',
    GBP: '£',
    GBX: '£',
    CHF: 'CHF ',
    JPY: '¥',
    KRW: '₩',
    CNY: '¥',
  };
  const prefix = symMap[curUp] ?? '';
  const effective = curUp === 'GBX' ? value / 100 : value;
  if (curUp === 'JPY' || curUp === 'KRW') {
    if (effective >= 1e12) return `${prefix}${(effective / 1e12).toFixed(2)}兆`;
    if (effective >= 1e8) return `${prefix}${(effective / 1e8).toFixed(1)}亿`;
    return `${prefix}${Math.round(effective).toLocaleString('en-US')}`;
  }
  if (effective >= 1e12) return `${prefix}${(effective / 1e12).toFixed(2)}万亿`;
  if (effective >= 1e8) return `${prefix}${(effective / 1e8).toFixed(2)}亿`;
  if (effective >= 1e4) return `${prefix}${(effective / 1e4).toFixed(1)}万`;
  return `${prefix}${effective.toFixed(0)}`;
}

/**
 * 解析股票代码，返回市场和代码
 */
export function parseStockCode(code: string): { market: string; symbol: string } {
  const trimmed = code.trim();
  if (!trimmed) return { market: '', symbol: '' };

  // 1. 优先识别明确的非 A 股市场前缀（绝不走 6 位纯数字推断）
  const outerMatch = trimmed.match(OUTER_PREFIX_RE);
  if (outerMatch) {
    const prefix = outerMatch[1].toLowerCase();
    const raw = outerMatch[2].trim();
    if (prefix === 'hk' && /^\d+$/.test(raw)) {
      return { market: 'hk', symbol: raw.padStart(5, '0') };
    }
    if (prefix === 'us' || prefix === 'eu' || prefix === 'jp') {
      return { market: prefix, symbol: raw.toUpperCase() };
    }
    return { market: prefix, symbol: raw.toUpperCase() };
  }

  const prefixMatch = trimmed.match(/^(sh|sz|bj)\.?(\d{6})$/i);
  if (prefixMatch) {
    return {
      market: prefixMatch[1].toLowerCase(),
      symbol: prefixMatch[2],
    };
  }

  const suffixMatch = trimmed.match(/^(\d{6})\.(sh|sz|bj)$/i);
  if (suffixMatch) {
    return {
      market: suffixMatch[2].toLowerCase(),
      symbol: suffixMatch[1],
    };
  }

  const numericMatch = trimmed.match(/^\d{6}$/);
  if (numericMatch) {
    // 根据代码推断市场（仅 6 位 A 股）
    if (trimmed.startsWith('6')) {
      return { market: 'sh', symbol: trimmed };
    }
    if (trimmed.startsWith('0') || trimmed.startsWith('3')) {
      return { market: 'sz', symbol: trimmed };
    }
    if (
      trimmed.startsWith('4') ||
      trimmed.startsWith('8') ||
      trimmed.startsWith('92')
    ) {
      return { market: 'bj', symbol: trimmed };
    }
  }

  return { market: '', symbol: trimmed };
}

/**
 * 标准化股票代码（带市场前缀）
 */
export function normalizeStockCode(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return '';
  const { market, symbol } = parseStockCode(trimmed);
  if (market) {
    return `${market}${symbol}`;
  }
  return trimmed;
}

export function toYmd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}${month}${day}`;
}

export function yearsAgoYmd(years: number, from: Date = new Date()): string {
  const date = new Date(from);
  date.setFullYear(date.getFullYear() - years);
  return toYmd(date);
}

/**
 * 腾讯 s_pk 大单占比兼容 0~1 小数与 0~100 百分比两种口径，统一输出百分比数值。
 */
export function normalizeLargeOrderRatios(order: {
  buyLargeRatio?: number | null;
  buySmallRatio?: number | null;
  sellLargeRatio?: number | null;
  sellSmallRatio?: number | null;
}): {
  buyLargePct: number;
  buySmallPct: number;
  sellLargePct: number;
  sellSmallPct: number;
  hasData: boolean;
} {
  const buyLarge = Number(order.buyLargeRatio ?? 0);
  const buySmall = Number(order.buySmallRatio ?? 0);
  const sellLarge = Number(order.sellLargeRatio ?? 0);
  const sellSmall = Number(order.sellSmallRatio ?? 0);
  const total = buyLarge + buySmall + sellLarge + sellSmall;
  if (!Number.isFinite(total) || total <= 0) {
    return {
      buyLargePct: 0,
      buySmallPct: 0,
      sellLargePct: 0,
      sellSmallPct: 0,
      hasData: false,
    };
  }
  const scale = total <= 1.5 ? 100 : 1;
  return {
    buyLargePct: buyLarge * scale,
    buySmallPct: buySmall * scale,
    sellLargePct: sellLarge * scale,
    sellSmallPct: sellSmall * scale,
    hasData: true,
  };
}
