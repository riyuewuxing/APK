/**
 * 按钮组件（含流光按压与全站 Ripple 水波纹）
 */

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { triggerClickRipple } from './useClickRipple';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
  block?: boolean;
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  block = false,
  className = '',
  disabled,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (!disabled && !loading) {
      triggerClickRipple(e, variant === 'primary' ? 'confirm' : 'tick');
    }
    onClick?.(e);
  };

  return (
    <button
      {...rest}
      type={type}
      className={`${styles.button} ${styles[variant]} ${styles[size]} ${block ? styles.block : ''} ${className}`}
      disabled={disabled || loading}
      onClick={handleClick}
    >
      {loading ? (
        <span className={styles.loadingIcon} />
      ) : icon ? (
        <span className={styles.icon}>{icon}</span>
      ) : null}
      {children && <span className={styles.text}>{children}</span>}
    </button>
  );
}
