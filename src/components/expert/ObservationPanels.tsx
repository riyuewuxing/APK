import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/common';
import { apiRequestJson, subscribeApiAuthorizationChanges } from '@/services/apiClient';
import styles from '@/pages/ExpertRadar/ExpertRadar.module.css';

type Dict = Record<string, unknown>;
const record = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 4096;
const day = (v: unknown): v is string => text(v) && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const stamp = (v: unknown): number => text(v) && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
const unknown = (v: unknown): boolean => v == null;
const optionalCount = (v: unknown): boolean => unknown(v) || count(v);
const displayCount = (v: unknown): string => count(v) ? String(v) : '未知';
const percent = (v: unknown): string => number(v) && v >= 0 && v <= 1 ? (v * 100).toFixed(1) + '%' : '未知';
const bounds = (v: unknown, min = 0): string => Array.isArray(v) && v.length === 2
  && v.every(x => number(x) && x >= min && x <= 1) && v[0] <= v[1]
  ? `[${(v[0] * 100).toFixed(0)}%, ${(v[1] * 100).toFixed(0)}%]` : '未知';
const shDay = (now: number): string => {
  const fields = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get = (key: string) => fields.find(p => p.type === key)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const assets = ['A股', '场外基金', 'ETF', '申万一级行业'] as const;
type CoverageRow = {
  asset: string; denominator: number; available: number | null; eligible: number | null; matches: number | null;
  comparison_day: string | null; observed_day_dated_rows?: number | null; observed_day_eligible?: number | null;
  observed_day_matches?: number | null; scope_note: string; source_run: number;
};
type CoverageIssue = {asset: string; status: 'UNAVAILABLE' | 'INVALID'};
type Industry = {code: string; industry: string; long_price_return_pct: number; short_price_return_pct: number};
export type MarketCoverageView = {
  status: 'UNAVAILABLE' | 'INVALID' | 'OBSERVED_WARN' | 'PARTIAL_WARN' | 'STALE';
  observed_day: string | null; oldest_log_at: string | null; latest_log_at: string | null;
  source_ref: string | null; reason: string; rows: CoverageRow[]; asset_issues?: CoverageIssue[];
  industries: Industry[]; industry_dates: string[]; research_only: true; execution_allowed: false; formal_admission: false;
};
type CoverageStatus = MarketCoverageView['status'];
function validRow(r: unknown): r is CoverageRow {
  if (!record(r) || !assets.includes(r.asset as typeof assets[number]) || !count(r.denominator)
      || !count(r.source_run) || r.source_run === 0 || !text(r.scope_note)
      || !(unknown(r.comparison_day) || day(r.comparison_day))) return false;
  const vals = [r.available, r.eligible, r.matches, r.observed_day_dated_rows, r.observed_day_eligible, r.observed_day_matches];
  if (!vals.every(optionalCount) || vals.some(v => count(v) && v > (r.denominator as number))) return false;
  if (count(r.available) && count(r.eligible) && r.eligible > r.available) return false;
  if (count(r.matches) && (!count(r.available) || r.matches > r.available || (count(r.eligible) && r.matches > r.eligible))) return false;
  if (count(r.observed_day_eligible) !== count(r.observed_day_matches)) return false;
  if (count(r.observed_day_eligible) && count(r.observed_day_matches)
      && (r.observed_day_matches > r.observed_day_eligible || (count(r.observed_day_dated_rows) && r.observed_day_eligible > r.observed_day_dated_rows))) return false;
  return true;
}
export function marketCoverageState(value: unknown, now: number, cached: boolean): {status: CoverageStatus; view?: MarketCoverageView} {
  if (value == null) return {status:'UNAVAILABLE'};
  if (!record(value) || value.research_only !== true || value.execution_allowed !== false || value.formal_admission !== false
      || !['UNAVAILABLE','INVALID','OBSERVED_WARN','PARTIAL_WARN','STALE'].includes(String(value.status))
      || !text(value.reason) || !(unknown(value.source_ref) || text(value.source_ref)) || !Array.isArray(value.rows) || value.rows.length > 4 || !value.rows.every(validRow)
      || !Array.isArray(value.industries) || value.industries.length > 10 || !value.industries.every(r =>
        record(r) && text(r.code) && text(r.industry) && number(r.long_price_return_pct) && r.long_price_return_pct < 0
        && number(r.short_price_return_pct) && r.short_price_return_pct > 0)
      || !Array.isArray(value.industry_dates) || !value.industry_dates.every(day)
      || (value.industries.length > 0 && value.industry_dates.length !== 3)) return {status:'INVALID'};
  const issues = value.asset_issues ?? [];
  if (!Array.isArray(issues) || issues.length > 4 || !issues.every(r => record(r)
      && assets.includes(r.asset as typeof assets[number]) && ['UNAVAILABLE','INVALID'].includes(String(r.status)))) return {status:'INVALID'};
  const identities = [...value.rows.map(r => r.asset), ...issues.map(r => r.asset)];
  if (new Set(identities).size !== identities.length) return {status:'INVALID'};
  const v = value as MarketCoverageView;
  if (v.status === 'INVALID' || v.status === 'UNAVAILABLE') {
    return v.rows.length || v.industries.length ? {status:'INVALID'} : {status:v.status,view:v};
  }
  if (!v.rows.length || !day(v.observed_day)) return {status:'INVALID'};
  const oldest = stamp(v.oldest_log_at), latest = stamp(v.latest_log_at);
  if (!Number.isFinite(now) || !Number.isFinite(oldest) || !Number.isFinite(latest)
      || oldest > latest || latest > now || shDay(oldest) !== v.observed_day || shDay(latest) !== v.observed_day
      || v.rows.some(r => r.comparison_day != null && r.comparison_day > v.observed_day!)) return {status:'INVALID'};
  if (v.status === 'STALE' || cached || now - oldest > 86_400_000 || shDay(now) !== v.observed_day)
    return {status:'STALE',view:v};
  return {status:issues.length || v.status === 'PARTIAL_WARN' ? 'PARTIAL_WARN' : 'OBSERVED_WARN',view:v};
}
export function MarketCoveragePanel({coverage, cached = false, clock}: {coverage?: unknown; cached?: boolean; clock?: number}) {
  const [now,setNow] = useState(() => Date.now());
  useEffect(() => {
    if (clock !== undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  },[clock]);
  const {status,view:v} = marketCoverageState(coverage, clock ?? now, cached);
  const label = {STALE:'历史观察 / 已过期或离线缓存',PARTIAL_WARN:'部分资产可观察 / WARN',
    OBSERVED_WARN:'公开供应商观察 / WARN',INVALID:'观察回执无效',UNAVAILABLE:'暂无观察'}[status];
  return <Card title="多资产观察回执 · 非正式准入">
    <section data-testid="market-coverage-observation">
      <div className={styles.semanticsBanner} role="status"><strong>{label}</strong>
        <span>{v?.reason ?? '无可核验观察；不能用历史投影或零值代替当前市场。'}</span>
        {v?.observed_day && <span>观察日 {v.observed_day} · {v.latest_log_at ?? '时间未核验'}</span>}
      </div>
      {v?.asset_issues?.map(issue => <p key={issue.asset} className={styles.summaryText}>{issue.asset}：未知（{issue.status === 'INVALID' ? '回执无效' : '缺少可用回执'}），不等于零命中。</p>)}
      {!!v?.rows.length && <div className={styles.tableWrap}><table className={styles.dataTable}>
        <thead><tr><th>资产</th><th>供应商范围</th><th>数据匹配</th><th>比较日完整</th><th>比较日命中</th><th>比较日</th><th>观察日完整 / 命中</th><th>口径与来源</th></tr></thead>
        <tbody>{v.rows.map(r => <tr key={r.asset}>
          <td>{r.asset}</td><td>{r.denominator}</td><td>{displayCount(r.available)}</td><td>{displayCount(r.eligible)}</td><td>{displayCount(r.matches)}</td>
          <td>{r.comparison_day ?? '报价日未核验'}</td>
          <td>{r.asset === '场外基金' || r.asset === 'ETF'
            ? r.observed_day_eligible == null || r.observed_day_matches == null ? '未知（无可核验日期组）'
              : `${r.observed_day_eligible} / ${r.observed_day_matches}（仅样本内）` : '不适用'}</td>
          <td>{r.scope_note} · run {r.source_run}</td>
        </tr>)}</tbody></table></div>}
      {v?.rows.some(r => r.asset === 'ETF' || r.asset === '场外基金') && <p className={styles.summaryText}>基金和ETF的比较日是完整记录最多的单一日期组，观察日单列；缺行、样本内零命中均不代表全市场零机会。</p>}
      {!!v?.industries.length && <><p className={styles.summaryText}>行业价格回暖观察：{v.industry_dates.join(' / ')}。仅研究优先级，非基本面反转或买入信号。</p>
        <div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>行业</th><th>长周期价格变化</th><th>短周期价格变化</th></tr></thead>
          <tbody>{v.industries.map(r => <tr key={r.code}><td>{r.code} · {r.industry}</td><td>{r.long_price_return_pct.toFixed(2)}%</td><td>+{r.short_price_return_pct.toFixed(2)}%</td></tr>)}</tbody>
        </table></div></>}
      {v?.source_ref && <p style={{overflowWrap:'anywhere'}}>留存回执：{v.source_ref}</p>}
    </section>
  </Card>;
}

export function PredictionObservationContent({value, clock = Date.now()}: {value: unknown; clock?: number}) {
  if (!record(value) || value.scope !== 'RETAINED_PUBLIC_CONTROL_NOT_PRIVATE_EVENT_LEDGER'
      || value.model_validation_status !== 'NOT_VALIDATED' || value.probability_calibrated !== false
      || value.private_event_chain_verified !== false || value.original_vendor_bytes_verified !== false
      || value.research_only !== true || value.execution_allowed !== false || value.decision_authority !== false
      || value.model_promotion_allowed !== false || !record(value.pilot) || !record(value.cohort)
      || !(stamp(value.evaluated_at) <= clock)) return <p role="status">预测观察回执缺失、时间或权限无效；不推断任何结果。</p>;
  const p=value.pilot,c=value.cohort;
  const pilotOk=p.status==='RETAINED_TERMINAL' && p.normalized_receipt_pins_match===true
    && p.first_attempt_provenance_reverified_at_runtime===false && p.retry_authorized===false
    && day(p.target) && text(p.symbol) && ['UP','DOWN','FLAT'].includes(String(p.direction))
    && ['OBSERVED','UNAVAILABLE','UNTRADEABLE'].includes(String(p.outcome_status))
    && count(p.selected_count) && count(p.evaluable_count) && p.evaluable_count<=p.selected_count
    && (p.evaluable_count===0 ? p.accuracy===null && p.flat_accuracy===null : number(p.accuracy) && p.accuracy>=0 && p.accuracy<=1 && number(p.flat_accuracy) && p.flat_accuracy>=0 && p.flat_accuracy<=1)
    && !(p.outcome_status!=='OBSERVED' && p.evaluable_count!==0) && stamp(p.observed_at)<=clock;
  const cohortOk=['PREREGISTERED_NOT_STARTED','REGISTERED_RECEIPTS_NOT_CHECKED'].includes(String(c.status))
    && c.protocol_pin_matches===true && c.receipt_index_verified===false
    && c.activation_authorized===false && c.retry_authorized===false && c.backfill_authorized===false
    && day(c.first) && day(c.last) && c.first<=c.last && count(c.expected_sessions) && count(c.expected_slots)
    && Array.isArray(c.symbols) && c.symbols.length>0 && c.symbols.every(text)
    && c.expected_slots===c.expected_sessions*c.symbols.length && Number.isFinite(stamp(c.first_planning_at));
  const before=cohortOk && c.status==='PREREGISTERED_NOT_STARTED' && clock<stamp(c.first_planning_at) && c.evaluable_count===0;
  return <section data-testid="prediction-observation">
    <div className={styles.semanticsBanner}><strong>NOT_VALIDATED · 未验证预测能力</strong>
      <span>已留存公开对照，不是私有账户事件账本、实际成交或已校准概率。</span></div>
    <h3>已封存单次试点</h3>
    {pilotOk ? <div className={styles.tableWrap}><table className={styles.dataTable}>
      <thead><tr><th>目标日 / 标的</th><th>冻结方向</th><th>终局状态</th><th>可评估 / 入选</th><th>方向准确率</th><th>缺失敏感性范围</th></tr></thead>
      <tbody><tr><td>{String(p.target)} / {String(p.symbol)}</td><td>{String(p.direction)}</td><td>{String(p.outcome_status)}</td>
        <td>{displayCount(p.evaluable_count)} / {displayCount(p.selected_count)}</td><td>{percent(p.accuracy)}</td><td>{bounds(p.accuracy_bounds)}</td></tr></tbody>
      </table></div> : <p>单次试点：无可核验终局回执，保持未知。</p>}
    {pilotOk && p.outcome_status==='UNAVAILABLE' && <p>缺少观察不等于预测错误、零收益、FLAT 或停牌；不重采，不回填。</p>}
    {pilotOk && record(p.paired_diagnostics) && <p>相对 FLAT 的配对缺失敏感性范围：{bounds(p.paired_diagnostics.selected_paired_accuracy_delta_bounds,-1)}。不是置信区间。</p>}
    <h3>已登记后续计划</h3>
    {cohortOk ? <><p>{String(c.first)} 至 {String(c.last)} · {displayCount(c.expected_sessions)} 个交易日 / {displayCount(c.expected_slots)} 个预期观察槽。</p>
      <p>{before ? '等待计划窗口；尚未到期，0 个可评估。' : '未核验最新回执索引，可评估数量未知；不以零替代。'} 首次计划窗口 {String(c.first_planning_at)}。</p></>
      : <p>登记计划：未核验，保持未知。</p>}
    <p>此入口只读；不启动预测、重试、回填或升级模型，不代表私域预测账本已验收。</p>
  </section>;
}

export function PredictionObservationPanel() {
  const [value,setValue]=useState<unknown>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(true);
  const [revision,setRevision]=useState(0);
  const [clock,setClock]=useState(Date.now);
  useEffect(() => {const timer=setInterval(()=>setClock(Date.now()),30_000); return ()=>clearInterval(timer);},[]);
  const request=useRef<AbortController|null>(null);
  useEffect(() => {
    const unsubscribe=subscribeApiAuthorizationChanges(() => {
      request.current?.abort(); setValue(null); setBusy(false); setError('鉴权状态已变化；请重新读取。');
    });
    return () => { unsubscribe(); request.current?.abort(); };
  },[]);
  useEffect(() => {
    request.current?.abort();
    const ac=new AbortController(); request.current=ac;
    setBusy(true); setError(''); setValue(null);
    void apiRequestJson<unknown>('/api/research-observations/prediction',{signal:ac.signal,timeoutMs:10000,fallbackToCache:false})
      .then(data=>{if(!ac.signal.aborted)setValue(data);})
      .catch(()=>{if(!ac.signal.aborted)setError('预测观察读取失败；不使用旧缓存。');})
      .finally(()=>{if(!ac.signal.aborted)setBusy(false);});
    return ()=>ac.abort();
  },[revision]);
  return <Card title="预测与复盘 · 已封存公开对照" extra={<button type="button" disabled={busy} onClick={()=>setRevision(x=>x+1)}>重新读取</button>}>
    {busy ? <p role="status">读取留存回执中…</p> : error ? <p role="alert">{error}</p> : <PredictionObservationContent value={value} clock={clock}/>}
  </Card>;
}
