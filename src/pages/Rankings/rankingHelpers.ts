import type { IndustryBoard } from 'stock-sdk';
import { formatAmount, getChangeColorClass } from '@/utils/format';

export type SortKey = 'rise' | 'fall' | 'amount' | 'netInflow';

export interface BoardExtraFields {
  amount?: number | null;
  netInflowYi?: number | null;
  constituentCount?: number | null;
}

export function getRankingColumnHeader(rankType: SortKey): string {
  return rankType === 'netInflow' ? '主力净流' : '成交额';
}

export function formatRankingMetricCell(
  item: IndustryBoard & BoardExtraFields,
  rankType: SortKey
): { text: string; colorClass: string } {
  if (rankType === 'netInflow') {
    const val = item.netInflowYi;
    if (val === null || val === undefined || !Number.isFinite(val)) {
      return { text: '--', colorClass: 'text-flat' };
    }
    const sign = val > 0 ? '+' : '';
    return {
      text: `${sign}${val.toFixed(2)}亿`,
      colorClass: getChangeColorClass(val),
    };
  }
  return {
    text: formatAmount(item.amount),
    colorClass: '',
  };
}

export function sortBoards(list: IndustryBoard[], rankType: SortKey): IndustryBoard[] {
  const sorted = [...list];
  switch (rankType) {
    case 'fall':
      sorted.sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
      break;
    case 'netInflow':
      sorted.sort((a, b) => {
        const aRaw = (a as BoardExtraFields).netInflowYi;
        const bRaw = (b as BoardExtraFields).netInflowYi;
        const aValid = typeof aRaw === 'number' && Number.isFinite(aRaw);
        const bValid = typeof bRaw === 'number' && Number.isFinite(bRaw);
        if (!aValid && !bValid) return 0;
        if (!aValid) return 1;
        if (!bValid) return -1;
        return (bRaw as number) - (aRaw as number);
      });
      break;
    case 'amount':
      sorted.sort((a, b) => {
        const aRaw = (a as BoardExtraFields).amount ?? a.totalMarketCap;
        const bRaw = (b as BoardExtraFields).amount ?? b.totalMarketCap;
        const aValid = typeof aRaw === 'number' && Number.isFinite(aRaw);
        const bValid = typeof bRaw === 'number' && Number.isFinite(bRaw);
        if (!aValid && !bValid) return 0;
        if (!aValid) return 1;
        if (!bValid) return -1;
        return (bRaw as number) - (aRaw as number);
      });
      break;
    case 'rise':
    default:
      sorted.sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
      break;
  }
  return sorted.slice(0, 50);
}
