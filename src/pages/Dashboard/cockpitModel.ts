/** Read-only projection of saved observations. No prediction, account admission or order logic. */
type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Obj : null;
const count = (x: unknown): number | null => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : null;
const isoDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x;
const clock = (x: unknown): number | null => typeof x === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x)
  && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;
export function chinaDay(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const get = (k:string) => parts.find(p=>p.type===k)?.value;
  return get('year')+'-'+get('month')+'-'+get('day');
}
function safeBoundary(x: Obj | null): x is Obj {
  return x !== null && x.research_only === true && x.execution_allowed === false;
}
function newest(payload: Obj, task: string): Obj | null {
  // The producer saves recent_runs in newest-first order. Never fall back
  // from a failed/latest incomplete record to an older successful one.
  if (!Array.isArray(payload.recent_runs)) return null;
  return obj(payload.recent_runs.find(raw => obj(raw)?.task_type === task));
}
function timing(run: Obj | null, today: string, now: number): 'CURRENT' | 'HISTORICAL' | 'UNKNOWN' {
  if (!run || !isoDay(run.trade_date)) return 'UNKNOWN';
  const start = clock(run.triggered_at);
  if (start === null || start > now || chinaDay(start) !== run.trade_date || run.trade_date > today) return 'UNKNOWN';
  return run.trade_date === today ? 'CURRENT' : 'HISTORICAL';
}
const observedRun = (r: Obj | null) => r?.status === 'OK' || r?.status === 'DEGRADED';
const knownAiStates: Record<string,string> = {
  DISABLED:'未启用 AI', CONTEXT_NOT_AUTHORIZED:'未授权模型上下文', OFFLINE:'AI 离线',
  NO_OBSERVATIONS:'没有适用观察', NOT_CONFIGURED:'模型未就绪', TIMED_OUT:'AI 超时',
  INVALID_OUTPUT:'AI 输出已丢弃', UNAVAILABLE:'AI 不可用', COMPLETED:'AI 复核重点已生成（非事实准入）',
};
export function projectDecisionCockpit(schedulerRaw: unknown, accountRaw: unknown, now: number) {
  const today = chinaDay(now);
  const scheduler = obj(schedulerRaw);
  const account = obj(accountRaw);
  const validScheduler = safeBoundary(scheduler);
  const scan = validScheduler ? newest(scheduler,'EOD_SCAN_1445') : null;
  const post = validScheduler ? newest(scheduler,'POST_CLOSE_1535') : null;
  const scanTiming = timing(scan,today,now);
  const postTiming = timing(post,today,now);
  const c = obj(scan?.scan_coverage);
  const scope = count(c?.scope_count), quoted = count(c?.quote_valid_count), basic = count(c?.basic_match_count);
  const examined = count(c?.examined_count), unavailable = count(c?.unavailable_count), candidates = count(scan?.candidate_count);
  const start = clock(scan?.triggered_at), finish = clock(scan?.observation_finished_at);
  const completeScan = scanTiming === 'CURRENT' && observedRun(scan) && scan?.scan_status === 'OBSERVED'
    && start !== null && finish !== null && start <= finish && finish <= now && chinaDay(finish) === today
    && scope !== null && quoted !== null && basic !== null && examined !== null && unavailable !== null && candidates !== null
    && candidates <= examined && examined <= basic && basic <= quoted && quoted <= scope
    && unavailable === 0;
  const regimeLabels: Record<string,string> = {GREEN:'绿灯',YELLOW:'黄灯',RED:'红灯'};
  const regime = completeScan && typeof scan?.regime === 'string' ? regimeLabels[scan.regime] : undefined;
  const review = obj(post?.post_close_review);
  const seenAt = clock(review?.observed_at), postStart = clock(post?.triggered_at);
  const reviewed = postTiming === 'CURRENT' && observedRun(post) && review?.trade_date === today
    && review.after_market_close === true && postStart !== null && seenAt !== null
    && postStart <= seenAt && seenAt <= now && chinaDay(seenAt) === today
    && ['OBSERVED_WITH_FULL_RULE_AND_QUOTE_COVERAGE','PARTIAL'].includes(String(review.coverage_status));
  const targets = count(review?.target_count), checked = count(review?.rule_scan_count), quotedToday = count(review?.same_day_quote_count);
  const red = count(review?.current_red_subject_count), unknown = count(review?.current_unknown_or_missing_rule_count);
  const coherentReview = reviewed && targets !== null && checked !== null && quotedToday !== null
    && checked <= targets && quotedToday <= targets && red !== null && red <= checked && unknown !== null;
  const ai = obj(post?.ai_summary);
  const aiLabel = coherentReview && safeBoundary(ai) && ai.admission_status === 'NOT_ADMITTED'
    && ai.context_scope === 'AGGREGATE_RULE_OBSERVATIONS_ONLY' && typeof ai.status === 'string'
    && Object.prototype.hasOwnProperty.call(knownAiStates, ai.status) ? knownAiStates[ai.status] : 'AI 状态未知或尚无适用记录';
  const stock = safeBoundary(account) ? obj(account.stock_account) : null;
  const fund = safeBoundary(account) ? obj(account.fund_account) : null;
  const stockDay = isoDay(stock?.as_of) && stock.as_of <= today ? stock.as_of : null;
  const stockId = typeof stock?.snapshot_id === 'string' && /^[0-9a-f]{64}$/.test(stock.snapshot_id) ? stock.snapshot_id : null;
  const stockState = stockDay && stockId && stock?.valuation_basis === 'LEDGER_REFERENCE_PRICES_NOT_LIVE_MARKET'
    && (stock.book_status === 'ACTIVE' || stock.book_status === 'EMPTY') ? stock.book_status : null;
  const fundDay = isoDay(fund?.as_of) && fund.as_of <= today ? fund.as_of : null;
  return {
    today,
    scan: completeScan
      ? { status:'OBSERVED' as const, title:regime ? '尾盘观察情绪 '+regime : '尾盘情绪未知',
          text:`有界扫描：候选 ${candidates}；有效报价 ${quoted}/${scope}；结构检查 ${examined}/${basic}。非全市场完整性证明。`,
          date: String(scan!.trade_date) }
      : {status:scanTiming === 'HISTORICAL' ? 'HISTORICAL' as const : 'UNKNOWN' as const, title:'当前市场方向未核验',
          text:scanTiming === 'HISTORICAL' ? '上次扫描 '+String(scan!.trade_date)+'；不作为今日观察。' : '本次没有完整可核的尾盘有界扫描；候选数未知。', date:null},
    review: coherentReview ? { status:'OBSERVED' as const,
      text:`盘后规则扫描 ${checked}/${targets}；同日行情 ${quotedToday}/${targets}；红旗标的 ${red}；未知或缺失规则 ${unknown}。规则输出非事实准入，不代表风险不存在。` }
      : { status:postTiming === 'HISTORICAL' ? 'HISTORICAL' as const : 'UNKNOWN' as const,
          text: postTiming === 'HISTORICAL' ? '上次盘后复盘 '+String(post!.trade_date)+'；今日覆盖未知。' : '当前盘后复盘覆盖未知或尚未完成；不能断言没有红旗。' },
    aiLabel,
    account: { stockState, stockDay, stockId: stockState ? stockId : null, fundDay,
      text: stockState === 'EMPTY' ? '股票台账记录为空；参考价格非实时估值。'
        : stockState === 'ACTIVE' ? '股票台账参考版本已读取；参考价格非实时估值，不构成持仓建议。'
        : '股票当前台账版本未核实；不沿用历史或演示账户。' },
  };
}
