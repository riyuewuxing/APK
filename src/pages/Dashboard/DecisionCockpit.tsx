import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequestJson } from '@/services/apiClient';
import { Card, Button } from '@/components/common';
import { projectDecisionCockpit } from './cockpitModel';
import styles from './DecisionCockpit.module.css';

export function DecisionCockpit() {
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const [read, setRead] = useState<{scheduler:unknown;account:unknown;observedAt:number;revision:number}|null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal:controller.signal, fallbackToCache:false, timeoutMs:15000 };
    void Promise.allSettled([
      apiRequestJson<unknown>('/api/scheduler/status', options),
      apiRequestJson<unknown>('/api/workbench', options),
    ]).then(([scheduler,account]) => {
      if (controller.signal.aborted) return;
      setRead({scheduler:scheduler.status==='fulfilled'?scheduler.value:null,
        account:account.status==='fulfilled'?account.value:null, observedAt:Date.now(),revision});
    });
    return () => controller.abort();
  }, [revision]);
  const current = read?.revision === revision ? read : null;
  const view = projectDecisionCockpit(current?.scheduler,current?.account,Date.now());
  return (
    <section aria-label="今日决策驾驶舱" data-testid="decision-cockpit">
      <Card title="今日决策驾驶舱" extra={<Button size="sm" onClick={()=>setRevision(n=>n+1)}>重新读取</Button>}>
        <div className={styles.meta}>
          中国交易日期 {view.today} · {current ? '读取时间 '+new Date(current.observedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' CST' : '读取中'}
        </div>
        <p className={styles.notice}>仅汇总已保存的观察与待核研究入口。不是实时买卖信号；AI 或数据不可用时，不替代确定性证据。</p>
        <div className={styles.grid}>
          <div className={styles.item} data-testid="cockpit-scan" data-state={view.scan.status}>
            <h4>市场与机会</h4><strong>{view.scan.title}</strong><p>{view.scan.text}</p>
            <div className={styles.actions}><Button size="sm" onClick={()=>navigate('/expert-radar')}>机会雷达</Button><Button size="sm" onClick={()=>navigate('/eod-picker')}>尾盘观察</Button></div>
          </div>
          <div className={styles.item} data-testid="cockpit-review" data-state={view.review.status}>
            <h4>风险与复盘</h4><p>{view.review.text}</p>
            <p data-testid="cockpit-ai-status">AI：{view.aiLabel}；确定性观察独立保留。</p>
            <Button size="sm" onClick={()=>navigate('/settings')}>研究简报与设置</Button>
          </div>
          <div className={styles.item} data-testid="cockpit-account">
            <h4>持仓研究入口</h4><p>{view.account.text}</p>
            <p>股票快照日期：{view.account.stockState ? view.account.stockDay : '未知'} · 版本 {view.account.stockId?.slice(0,12) ?? '未知'}</p>
            <p>基金记录日期：{view.account.fundDay ?? '未知'}（仅历史参考；不代表当前赎回状态）</p>
            <Button size="sm" onClick={()=>navigate('/expert')}>组合工作台</Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
