import { formatYuanAmount } from '@/utils/format';

export function formatNorthboundDisplay(
  snapshot:
    | {
        netInflow?: number | null;
        netBuyAmount?: number | null;
        remainAmount?: number | null;
      }
    | null
    | undefined
): { label: string; suspended: boolean } {
  if (!snapshot) {
    return { label: '--', suspended: false };
  }
  const netInflow = snapshot.netInflow ?? 0;
  const netBuy = snapshot.netBuyAmount ?? 0;
  const remain = snapshot.remainAmount ?? 0;
  if (netInflow === 0 && netBuy === 0 && remain === 0) {
    return { label: '--（盘中已停披露）', suspended: true };
  }
  return {
    label: formatYuanAmount(snapshot.netInflow ?? snapshot.netBuyAmount),
    suspended: false,
  };
}

export function formatHotBoardBreadth(item: {
  riseCount?: number | null;
  fallCount?: number | null;
  constituentCount?: number | null;
}):
  | { mode: 'riseFall'; rise: number | null | undefined; fall: number | null | undefined }
  | { mode: 'text'; text: string } {
  if (item.riseCount == null && item.fallCount == null) {
    return {
      mode: 'text',
      text: item.constituentCount != null ? `共 ${item.constituentCount} 只成分股` : '--',
    };
  }
  return {
    mode: 'riseFall',
    rise: item.riseCount,
    fall: item.fallCount,
  };
}
