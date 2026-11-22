/**
 * 卡片容器组件（支持局部鼠标径向聚光、材质联动与克制流光 BorderBeam）
 */

import { useCallback, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { BorderBeam } from './BorderBeam';
import { triggerClickRipple } from './useClickRipple';
import styles from './Card.module.css';

interface CardProps {
  children: ReactNode;
  title?: string;
  extra?: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  style?: CSSProperties;
  animate?: boolean;
  spotlight?: boolean;
  beam?: boolean;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function Card({
  children,
  title,
  extra,
  padding = 'md',
  className = '',
  style,
  animate = true,
  spotlight = true,
  beam = false,
  onClick,
}: CardProps) {
  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!spotlight) return;
      const rect = e.currentTarget.getBoundingClientRect();
      e.currentTarget.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
      e.currentTarget.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
    },
    [spotlight]
  );

  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!onClick) return;
      triggerClickRipple(e, 'tick');
      onClick(e);
    },
    [onClick]
  );

  return (
    <div
      className={`${styles.card} ${spotlight ? styles.spotlight : ''} ${animate ? styles.animate : ''} ${className}`}
      style={style}
      onMouseMove={spotlight ? handleMouseMove : undefined}
      onClick={onClick ? handleClick : undefined}
    >
      {beam && <BorderBeam />}
      {(title || extra) && (
        <div className={styles.header}>
          {title && <h3 className={styles.title}>{title}</h3>}
          {extra && <div className={styles.extra}>{extra}</div>}
        </div>
      )}
      <div className={`${styles.body} ${styles[`padding-${padding}`]}`}>
        {children}
      </div>
    </div>
  );
}
