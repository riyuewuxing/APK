/**
 * Tabs 组件（物理弹簧切换胶囊，useId 多实例隔离）
 */

import { useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import styles from './Tabs.module.css';

interface TabItem {
  key: string;
  label: string;
  icon?: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  size?: 'sm' | 'md';
}

export function Tabs({ items, activeKey, onChange, size = 'md' }: TabsProps) {
  const uid = useId();
  const layoutId = `tabs-indicator-${uid}`;

  return (
    <div className={`${styles.tabs} ${styles[size]}`}>
      {items.map((item) => {
        const isActive = activeKey === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={`${styles.tab} ${isActive ? styles.active : ''}`}
            onClick={() => onChange(item.key)}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className={styles.indicator}
                transition={{ type: 'spring', stiffness: 460, damping: 34 }}
              />
            )}
            {item.icon && <span className={styles.icon}>{item.icon}</span>}
            <span className={styles.labelText}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
