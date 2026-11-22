/**
 * 榜单页面
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, BarChart2, RefreshCw } from 'lucide-react';
import { Card, Tabs, Loading, triggerClickRipple } from '@/components/common';
import { useBoardData } from '@/contexts';
import { buildBoardRoute } from '@/services/sdk';
import {
  formatPercent,
  getChangeColorClass,
} from '@/utils/format';
import {
  formatRankingMetricCell,
  getRankingColumnHeader,
  sortBoards,
  type BoardExtraFields,
  type SortKey,
} from './rankingHelpers';
import styles from './Rankings.module.css';

// 榜单类型
const RANKING_TYPES = [
  { key: 'rise', label: '涨幅榜', icon: <TrendingUp size={14} /> },
  { key: 'fall', label: '跌幅榜', icon: <TrendingDown size={14} /> },
  { key: 'amount', label: '成交额榜', icon: <BarChart2 size={14} /> },
  { key: 'netInflow', label: '主力净流', icon: <RefreshCw size={14} /> },
];

export function Rankings() {
  const navigate = useNavigate();
  const { industryList, conceptList, loading } = useBoardData();
  const [rankType, setRankType] = useState<SortKey>('rise');

  const sections = useMemo(
    () => [
      { title: '行业板块', type: 'industry' as const, list: sortBoards(industryList, rankType) },
      { title: '概念板块', type: 'concept' as const, list: sortBoards(conceptList, rankType) },
    ],
    [industryList, conceptList, rankType]
  );

  const handleBoardClick = (code: string, type: 'industry' | 'concept') => {
    navigate(buildBoardRoute(type, code));
  };

  if (loading) {
    return <Loading fullScreen text="加载榜单数据..." />;
  }

  return (
    <div className={styles.rankings}>
      <div className={styles.controls}>
        <Tabs
          items={RANKING_TYPES}
          activeKey={rankType}
          onChange={(key) => setRankType(key as SortKey)}
        />
      </div>

      <div className={styles.content}>
        {sections.map((section) => (
          <Card key={section.type} title={section.title} padding="sm">
            <div className={styles.rankTable}>
              <div className={styles.tableHeader}>
                <span className={styles.colRank}>排名</span>
                <span className={styles.colName}>名称</span>
                <span className={styles.colChange}>涨跌幅</span>
                <span className={styles.colLeader}>领涨股</span>
                <span className={styles.colStats}>涨跌/家数</span>
                <span className={styles.colTurnover}>{getRankingColumnHeader(rankType)}</span>
              </div>
              <div className={styles.tableBody}>
                {section.list.map((item, index) => {
                  const extra = item as typeof item & BoardExtraFields;
                  const metricCell = formatRankingMetricCell(extra, rankType);
                  return (
                    <motion.div
                      key={item.code}
                      className={styles.tableRow}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      onClick={(e) => {
                        triggerClickRipple(e);
                        handleBoardClick(item.code, section.type);
                      }}
                    >
                      <span className={styles.colRank}>
                        <span className={`${styles.rankNum} ${index < 3 ? styles.top3 : ''}`}>
                          {index + 1}
                        </span>
                      </span>
                      <span className={styles.colName} title={item.name}>{item.name}</span>
                      <span className={`${styles.colChange} ${getChangeColorClass(item.changePercent)}`}>
                        {formatPercent(item.changePercent)}
                      </span>
                      <div className={styles.colLeader}>
                        <span className={styles.leaderName}>{item.leadingStock || '--'}</span>
                        <span className={getChangeColorClass(item.leadingStockChangePercent)}>
                          {formatPercent(item.leadingStockChangePercent)}
                        </span>
                      </div>
                      <span className={styles.colStats}>
                        {item.riseCount == null && item.fallCount == null ? (
                          <span>{extra.constituentCount != null ? `${extra.constituentCount}家` : '--'}</span>
                        ) : (
                          <>
                            <span className="text-rise">{item.riseCount ?? '--'}</span>
                            <span>/</span>
                            <span className="text-fall">{item.fallCount ?? '--'}</span>
                          </>
                        )}
                      </span>
                      <span className={`${styles.colTurnover} ${metricCell.colorClass}`}>
                        {metricCell.text}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
