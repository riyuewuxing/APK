/**
 * 顶栏主题与 6 维视觉材质弹出器（桌面 Popover / 移动 Portal Bottom Sheet）
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Palette, Sparkles, X } from 'lucide-react';
import { useTheme } from '@/hooks';
import { registerModalCloser } from '@/platform/modalStack';
import {
  getThemePresetSpec,
  type DensityLevel,
  type MotionLevel,
  type RadiusMode,
} from '@/themes/presets';
import { triggerClickRipple } from './useClickRipple';
import styles from './ThemeSwitcher.module.css';

const MOTION_OPTIONS: { value: MotionLevel; label: string }[] = [
  { value: 'full', label: '完整' },
  { value: 'subtle', label: '轻柔' },
  { value: 'off', label: '关闭' },
];

const DENSITY_OPTIONS: { value: DensityLevel; label: string }[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'comfortable', label: '均衡' },
  { value: 'spacious', label: '宽松' },
];

const RADIUS_OPTIONS: { value: RadiusMode; label: string }[] = [
  { value: 'preset', label: '随主题' },
  { value: 'sharp', label: '锐角' },
  { value: 'rounded', label: '圆润' },
];

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 768px)').matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

export function ThemeSwitcher() {
  const {
    preset,
    motionLevel,
    density,
    radiusMode,
    textureEnabled,
    availablePresets,
    setPreset,
    setMotionLevel,
    setDensity,
    setRadiusMode,
    setTextureEnabled,
  } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobileViewport();

  const activeSpec = getThemePresetSpec(preset);

  useEffect(() => {
    if (!open) return undefined;
    const unregisterModal = registerModalCloser('theme-switcher', () => setOpen(false));
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || sheetRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      unregisterModal();
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const panelBody = (
    <>
      <div className={styles.presetList}>
        {availablePresets.map((item) => {
          const isSelected = item.id === preset;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`theme-preset-${item.id}`}
              className={`${styles.presetItem} ${isSelected ? styles.presetActive : ''}`}
              onClick={(e) => {
                triggerClickRipple(e);
                setPreset(item.id, { x: e.clientX, y: e.clientY });
              }}
            >
              <div
                className={styles.previewChip}
                style={{
                  background: item.previewColors[0],
                  borderColor: item.previewColors[2],
                }}
              >
                <span
                  className={styles.previewBar}
                  style={{ background: item.previewColors[1] }}
                />
                <span
                  className={styles.previewAccent}
                  style={{ background: item.previewColors[2] }}
                />
                <span
                  className={styles.previewAccent2}
                  style={{ background: item.previewColors[3] }}
                />
              </div>
              <div className={styles.presetMeta}>
                <div className={styles.presetNameRow}>
                  <span className={styles.presetName}>{item.name}</span>
                  <span className={styles.polarityTag}>
                    {item.polarity === 'dark' ? '深色' : '浅色'}
                  </span>
                </div>
                <span className={styles.presetScene}>{item.scene}</span>
              </div>
              {isSelected && (
                <span className={styles.checkBadge}>
                  <Check size={13} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className={styles.controlSection}>
        <div className={styles.controlRow}>
          <div className={styles.motionLabel}>
            <Sparkles size={13} />
            <span>动效</span>
          </div>
          <div className={styles.motionGroup}>
            {MOTION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                data-testid={`theme-motion-${opt.value}`}
                className={`${styles.motionBtn} ${
                  motionLevel === opt.value ? styles.motionBtnActive : ''
                }`}
                onClick={(e) => {
                  triggerClickRipple(e);
                  setMotionLevel(opt.value);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlRow}>
          <span className={styles.motionLabel}>密度</span>
          <div className={styles.motionGroup}>
            {DENSITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                data-testid={`theme-density-${opt.value}`}
                className={`${styles.motionBtn} ${
                  density === opt.value ? styles.motionBtnActive : ''
                }`}
                onClick={(e) => {
                  triggerClickRipple(e);
                  setDensity(opt.value);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlRow}>
          <span className={styles.motionLabel}>圆角</span>
          <div className={styles.motionGroup}>
            {RADIUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                data-testid={`theme-radius-${opt.value}`}
                className={`${styles.motionBtn} ${
                  radiusMode === opt.value ? styles.motionBtnActive : ''
                }`}
                onClick={(e) => {
                  triggerClickRipple(e);
                  setRadiusMode(opt.value);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlRow}>
          <span className={styles.motionLabel}>背景纹理</span>
          <div className={styles.motionGroup}>
            <button
              type="button"
              data-testid="theme-texture-on"
              className={`${styles.motionBtn} ${textureEnabled ? styles.motionBtnActive : ''}`}
              onClick={(e) => {
                triggerClickRipple(e);
                setTextureEnabled(true);
              }}
            >
              开启
            </button>
            <button
              type="button"
              data-testid="theme-texture-off"
              className={`${styles.motionBtn} ${!textureEnabled ? styles.motionBtnActive : ''}`}
              onClick={(e) => {
                triggerClickRipple(e);
                setTextureEnabled(false);
              }}
            >
              纯净
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className={styles.wrapper} ref={rootRef}>
      <button
        type="button"
        data-testid="theme-switcher-trigger"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={(e) => {
          triggerClickRipple(e);
          setOpen((v) => !v);
        }}
        title="切换金融终端主题与 6 维视觉材质"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span
          className={styles.triggerSwatch}
          style={{
            background: `linear-gradient(135deg, ${activeSpec.previewColors[2]}, ${activeSpec.previewColors[3]})`,
          }}
        />
        <Palette size={15} className={styles.triggerIcon} />
        <span className={styles.triggerLabel}>{activeSpec.name}</span>
        <ChevronDown
          size={13}
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
        />
      </button>

      {open && !isMobile && (
        <div
          className={styles.popover}
          role="dialog"
          aria-label="终端主题预设"
          data-testid="theme-switcher-popover"
        >
          <div className={styles.popoverHeader}>
            <span className={styles.popoverTitle}>金融终端主题</span>
            <span className={styles.popoverSub}>6 维材质与密度引擎</span>
          </div>
          {panelBody}
        </div>
      )}

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && isMobile && (
              <motion.div
                className={styles.mobileSheetBackdrop}
                role="presentation"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setOpen(false)}
              >
                <motion.div
                  ref={sheetRef}
                  className={styles.mobileSheet}
                  role="dialog"
                  aria-label="终端主题预设抽屉"
                  data-testid="theme-switcher-sheet"
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className={styles.sheetGrabber} />
                  <div className={styles.popoverHeader}>
                    <div>
                      <div className={styles.popoverTitle}>金融终端主题</div>
                      <div className={styles.popoverSub}>6 维材质 · 系统栏同步</div>
                    </div>
                    <button
                      type="button"
                      className={styles.sheetCloseBtn}
                      aria-label="关闭主题抽屉"
                      onClick={() => setOpen(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className={styles.mobileSheetScroll}>{panelBody}</div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
