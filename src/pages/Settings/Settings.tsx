/**
 * 设置页面
 */

import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { RefreshCw, Palette, BarChart2, Info, Sparkles, Check } from 'lucide-react';
import { BorderBeam, Card, NumberField, triggerClickRipple } from '@/components/common';
import { useAppSettings } from '@/contexts';
import { useTheme } from '@/hooks';
import type { DensityLevel, MotionLevel, RadiusMode } from '@/themes/presets';
import { MobileSyncCard } from './MobileSyncCard';
import { SchedulerSettingsCard } from './SchedulerSettingsCard';
import styles from './Settings.module.css';

type SettingsTabKey = 'scheduler' | 'mobile' | 'preferences';

const SETTINGS_TABS: { key: SettingsTabKey; label: string }[] = [
  { key: 'scheduler', label: '定时简报' },
  { key: 'mobile', label: '手机直连与OTA' },
  { key: 'preferences', label: '行情与指标偏好' },
];

function parsePeriods(value: string, fallback: number[]) {
  const periods = value
    .split(/[，,\s]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);

  return periods.length > 0 ? periods : fallback;
}

function IndicatorNumberInput({
  value,
  min = 1,
  step,
  onChange,
}: {
  value: number;
  min?: number;
  step?: number | string;
  onChange: (value: number) => void;
}) {
  return (
    <NumberField
      className={styles.numberInput}
      value={value}
      min={min}
      step={step}
      onCommit={(v) => {
        if (v !== null) onChange(v);
      }}
    />
  );
}

export function Settings() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { settings, updateSettings } = useAppSettings();
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
  const [maDraft, setMaDraft] = useState(settings.indicatorConfig.ma.join(', '));
  const [rsiDraft, setRsiDraft] = useState(settings.indicatorConfig.rsi.join(', '));

  const tabRaw = searchParams.get('tab')?.trim() || '';
  const activeTab: SettingsTabKey =
    location.hash === '#scheduler'
      ? 'scheduler'
      : tabRaw === 'mobile' || tabRaw === 'preferences' || tabRaw === 'scheduler'
        ? tabRaw
        : 'scheduler';

  const handleTabChange = (nextTab: SettingsTabKey) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === 'scheduler') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', nextTab);
    }
    const qs = nextParams.toString();
    navigate({ pathname: '/settings', search: qs ? `?${qs}` : '' }, { replace: true });
  };

  const updateIndicatorConfig = (
    updates: Partial<typeof settings.indicatorConfig>
  ) => {
    updateSettings({
      indicatorConfig: {
        ...settings.indicatorConfig,
        ...updates,
      },
    });
  };

  return (
    <div className={styles.settings}>
      <div className={styles.headerRow}>
        <motion.h1
          className={styles.title}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          设置与简报
        </motion.h1>

        <div className={styles.segmentTabs} data-testid="settings-segment-tabs">
          {SETTINGS_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                className={`${styles.segmentTabBtn} ${isActive ? styles.segmentTabBtnActive : ''}`}
                onClick={(e) => {
                  triggerClickRipple(e);
                  handleTabChange(tab.key);
                }}
              >
                {isActive && (
                  <motion.span
                    layoutId="settings-segment-pill"
                    className={styles.segmentTabPill}
                    transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                  />
                )}
                <span className={styles.segmentTabLabel}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'mobile' && <MobileSyncCard />}

      {activeTab === 'scheduler' && (
        <div id="scheduler">
          <SchedulerSettingsCard />
        </div>
      )}

      {activeTab === 'preferences' && (
        <div className={styles.prefGrid}>

          <Card className={styles.prefFullSpan}>
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <Sparkles size={18} className={styles.sectionIcon} />
                <h3>外观主题与动效系统</h3>
              </div>
              <div className={styles.sectionContent}>
                <div className={styles.presetGrid}>
                  {availablePresets.map((item) => {
                    const isSelected = item.id === preset;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-testid={`settings-preset-${item.id}`}
                        className={`${styles.presetCard} ${isSelected ? styles.presetCardActive : ''}`}
                        onClick={(e) => {
                          triggerClickRipple(e);
                          setPreset(item.id, { x: e.clientX, y: e.clientY });
                        }}
                      >
                        {isSelected && <BorderBeam duration={6} />}
                        <div
                          className={styles.presetSwatchBar}
                          style={{
                            background: `linear-gradient(135deg, ${item.previewColors[0]} 0%, ${item.previewColors[1]} 100%)`,
                            borderColor: item.previewColors[2],
                          }}
                        >
                          <span className={styles.swatchDot} style={{ background: item.previewColors[2] }} />
                          <span className={styles.swatchDot} style={{ background: item.previewColors[3] }} />
                          <span className={styles.polarityPill}>
                            {item.polarity === 'dark' ? '深色' : '浅色'}
                          </span>
                          {isSelected && (
                            <span className={styles.presetCheck}>
                              <Check size={12} />
                            </span>
                          )}
                        </div>
                        <div className={styles.presetCardTitle}>{item.name}</div>
                        <div className={styles.presetCardScene}>{item.scene}</div>
                      </button>
                    );
                  })}
                </div>

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>动效与涟漪强度</span>
                    <span className={styles.settingDesc}>控制主题圆形扩散、数字插值与聚光微动效</span>
                  </div>
                  <div className={styles.colorModeOptions}>
                    {(
                      [
                        { value: 'full', label: '完整动效' },
                        { value: 'subtle', label: '轻柔微动' },
                        { value: 'off', label: '关闭动效' },
                      ] as { value: MotionLevel; label: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`settings-motion-${opt.value}`}
                        className={`${styles.colorModeBtn} ${motionLevel === opt.value ? styles.active : ''}`}
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

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>视觉密度</span>
                    <span className={styles.settingDesc}>调节盯盘行高、表格留白与卡片内边距</span>
                  </div>
                  <div className={styles.colorModeOptions}>
                    {(
                      [
                        { value: 'compact', label: '紧凑盯盘' },
                        { value: 'comfortable', label: '默认均衡' },
                        { value: 'spacious', label: '宽松阅读' },
                      ] as { value: DensityLevel; label: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`settings-density-${opt.value}`}
                        className={`${styles.colorModeBtn} ${density === opt.value ? styles.active : ''}`}
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

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>圆角风格</span>
                    <span className={styles.settingDesc}>在工业微直角与现代柔和圆角间即时切换</span>
                  </div>
                  <div className={styles.colorModeOptions}>
                    {(
                      [
                        { value: 'preset', label: '跟随预设' },
                        { value: 'sharp', label: '硬朗直角' },
                        { value: 'rounded', label: '柔和现代' },
                      ] as { value: RadiusMode; label: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`settings-radius-${opt.value}`}
                        className={`${styles.colorModeBtn} ${radiusMode === opt.value ? styles.active : ''}`}
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

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>空间背景纹理</span>
                    <span className={styles.settingDesc}>叠加网格、HUD 刻度或宣纸纤维底层纹理</span>
                  </div>
                  <div className={styles.colorModeOptions}>
                    <button
                      type="button"
                      data-testid="settings-texture-on"
                      className={`${styles.colorModeBtn} ${textureEnabled ? styles.active : ''}`}
                      onClick={(e) => {
                        triggerClickRipple(e);
                        setTextureEnabled(true);
                      }}
                    >
                      开启纹理
                    </button>
                    <button
                      type="button"
                      data-testid="settings-texture-off"
                      className={`${styles.colorModeBtn} ${!textureEnabled ? styles.active : ''}`}
                      onClick={(e) => {
                        triggerClickRipple(e);
                        setTextureEnabled(false);
                      }}
                    >
                      纯净背景
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <RefreshCw size={18} className={styles.sectionIcon} />
                <h3>刷新频率</h3>
              </div>
              <div className={styles.sectionContent}>
                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>列表 / 自选</span>
                    <span className={styles.settingDesc}>总览、自选、扫描等列表数据刷新间隔</span>
                  </div>
                  <select
                    className={styles.select}
                    value={settings.refreshInterval.list}
                    onChange={(e) =>
                      updateSettings({
                        refreshInterval: {
                          ...settings.refreshInterval,
                          list: Number(e.target.value),
                        },
                      })
                    }
                  >
                    <option value={0}>默认</option>
                    <option value={3000}>3秒（盯盘）</option>
                    <option value={5000}>5秒</option>
                    <option value={10000}>10秒</option>
                    <option value={15000}>15秒</option>
                    <option value={30000}>30秒</option>
                  </select>
                </div>

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>个股详情</span>
                    <span className={styles.settingDesc}>详情页行情、分时、K 线相关刷新间隔</span>
                  </div>
                  <select
                    className={styles.select}
                    value={settings.refreshInterval.detail}
                    onChange={(e) =>
                      updateSettings({
                        refreshInterval: {
                          ...settings.refreshInterval,
                          detail: Number(e.target.value),
                        },
                      })
                    }
                  >
                    <option value={3000}>3秒（盯盘）</option>
                    <option value={5000}>5秒</option>
                    <option value={10000}>10秒</option>
                    <option value={15000}>15秒</option>
                    <option value={30000}>30秒</option>
                  </select>
                </div>

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>热力图</span>
                    <span className={styles.settingDesc}>热力图个股数据刷新间隔</span>
                  </div>
                  <select
                    className={styles.select}
                    value={settings.refreshInterval.heatmap}
                    onChange={(e) =>
                      updateSettings({
                        refreshInterval: {
                          ...settings.refreshInterval,
                          heatmap: Number(e.target.value),
                        },
                      })
                    }
                  >
                    <option value={5000}>5秒</option>
                    <option value={10000}>10秒</option>
                    <option value={15000}>15秒</option>
                    <option value={30000}>30秒</option>
                  </select>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <Palette size={18} className={styles.sectionIcon} />
                <h3>色彩模式</h3>
              </div>
              <div className={styles.sectionContent}>
                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>涨跌颜色</span>
                    <span className={styles.settingDesc}>全局页面和热力图默认使用同一颜色模式</span>
                  </div>
                  <div className={styles.colorModeOptions}>
                    <button
                      className={`${styles.colorModeBtn} ${settings.colorMode === 'red-rise' ? styles.active : ''}`}
                      onClick={() => updateSettings({ colorMode: 'red-rise' })}
                    >
                      <span className={styles.riseRed}>涨</span>
                      <span className={styles.fallGreen}>跌</span>
                      红涨绿跌
                    </button>
                    <button
                      className={`${styles.colorModeBtn} ${settings.colorMode === 'green-rise' ? styles.active : ''}`}
                      onClick={() => updateSettings({ colorMode: 'green-rise' })}
                    >
                      <span className={styles.riseGreen}>涨</span>
                      <span className={styles.fallRed}>跌</span>
                      绿涨红跌
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <BarChart2 size={18} className={styles.sectionIcon} />
                <h3>指标参数</h3>
              </div>
              <div className={styles.sectionContent}>
                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>MA 周期</span>
                    <span className={styles.settingDesc}>逗号分隔，默认用于详情页均线</span>
                  </div>
                  <input
                    className={styles.textInput}
                    value={maDraft}
                    onChange={(e) => setMaDraft(e.target.value)}
                    onBlur={() => {
                      const next = parsePeriods(maDraft, settings.indicatorConfig.ma);
                      setMaDraft(next.join(', '));
                      updateIndicatorConfig({ ma: next });
                    }}
                  />
                </div>

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>MACD</span>
                    <span className={styles.settingDesc}>短 / 长 / 信号</span>
                  </div>
                  <div className={styles.inlineInputs}>
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.macd.short}
                      onChange={(v) =>
                        updateIndicatorConfig({
                          macd: { ...settings.indicatorConfig.macd, short: v },
                        })
                      }
                    />
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.macd.long}
                      onChange={(v) =>
                        updateIndicatorConfig({
                          macd: { ...settings.indicatorConfig.macd, long: v },
                        })
                      }
                    />
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.macd.signal}
                      onChange={(v) =>
                        updateIndicatorConfig({
                          macd: { ...settings.indicatorConfig.macd, signal: v },
                        })
                      }
                    />
                  </div>
                </div>

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>BOLL</span>
                    <span className={styles.settingDesc}>周期 / 标准差</span>
                  </div>
                  <div className={styles.inlineInputs}>
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.boll.period}
                      onChange={(v) =>
                        updateIndicatorConfig({
                          boll: { ...settings.indicatorConfig.boll, period: v },
                        })
                      }
                    />
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.boll.stdDev}
                      min={0.1}
                      step="0.1"
                      onChange={(v) =>
                        updateIndicatorConfig({
                          boll: { ...settings.indicatorConfig.boll, stdDev: v },
                        })
                      }
                    />
                  </div>
                </div>

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>KDJ</span>
                    <span className={styles.settingDesc}>周期 / K / D</span>
                  </div>
                  <div className={styles.inlineInputs}>
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.kdj.period}
                      onChange={(v) =>
                        updateIndicatorConfig({
                          kdj: { ...settings.indicatorConfig.kdj, period: v },
                        })
                      }
                    />
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.kdj.kPeriod}
                      onChange={(v) =>
                        updateIndicatorConfig({
                          kdj: { ...settings.indicatorConfig.kdj, kPeriod: v },
                        })
                      }
                    />
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.kdj.dPeriod}
                      onChange={(v) =>
                        updateIndicatorConfig({
                          kdj: { ...settings.indicatorConfig.kdj, dPeriod: v },
                        })
                      }
                    />
                  </div>
                </div>

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>RSI 周期</span>
                    <span className={styles.settingDesc}>逗号分隔，默认用于详情页 RSI</span>
                  </div>
                  <input
                    className={styles.textInput}
                    value={rsiDraft}
                    onChange={(e) => setRsiDraft(e.target.value)}
                    onBlur={() => {
                      const next = parsePeriods(rsiDraft, settings.indicatorConfig.rsi);
                      setRsiDraft(next.join(', '));
                      updateIndicatorConfig({ rsi: next });
                    }}
                  />
                </div>

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>DMI / ADX</span>
                    <span className={styles.settingDesc}>默认趋势强度参数</span>
                  </div>
                  <div className={styles.inlineInputs}>
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.dmi.period}
                      onChange={(v) =>
                        updateIndicatorConfig({
                          dmi: { ...settings.indicatorConfig.dmi, period: v },
                        })
                      }
                    />
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.dmi.adxPeriod}
                      onChange={(v) =>
                        updateIndicatorConfig({
                          dmi: { ...settings.indicatorConfig.dmi, adxPeriod: v },
                        })
                      }
                    />
                  </div>
                </div>

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>SAR</span>
                    <span className={styles.settingDesc}>起始 / 增量 / 最大加速</span>
                  </div>
                  <div className={styles.inlineInputs}>
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.sar.afStart}
                      min={0.01}
                      step="0.01"
                      onChange={(v) =>
                        updateIndicatorConfig({
                          sar: { ...settings.indicatorConfig.sar, afStart: v },
                        })
                      }
                    />
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.sar.afIncrement}
                      min={0.01}
                      step="0.01"
                      onChange={(v) =>
                        updateIndicatorConfig({
                          sar: { ...settings.indicatorConfig.sar, afIncrement: v },
                        })
                      }
                    />
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.sar.afMax}
                      min={0.01}
                      step="0.01"
                      onChange={(v) =>
                        updateIndicatorConfig({
                          sar: { ...settings.indicatorConfig.sar, afMax: v },
                        })
                      }
                    />
                  </div>
                </div>

                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>KC</span>
                    <span className={styles.settingDesc}>EMA / ATR / 倍数</span>
                  </div>
                  <div className={styles.inlineInputs}>
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.kc.emaPeriod}
                      onChange={(v) =>
                        updateIndicatorConfig({
                          kc: { ...settings.indicatorConfig.kc, emaPeriod: v },
                        })
                      }
                    />
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.kc.atrPeriod}
                      onChange={(v) =>
                        updateIndicatorConfig({
                          kc: { ...settings.indicatorConfig.kc, atrPeriod: v },
                        })
                      }
                    />
                    <IndicatorNumberInput
                      value={settings.indicatorConfig.kc.multiplier}
                      min={0.1}
                      step="0.1"
                      onChange={(v) =>
                        updateIndicatorConfig({
                          kc: { ...settings.indicatorConfig.kc, multiplier: v },
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card className={styles.prefFullSpan}>
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <Info size={18} className={styles.sectionIcon} />
                <h3>关于</h3>
              </div>
              <div className={styles.sectionContent}>
                <div className={styles.aboutInfo}>
                  <p><strong>投资专家 QUANT TERMINAL</strong> v5.0 (web v{__APP_VERSION__})</p>
                  <p className={styles.aboutDesc}>
                    问题驱动型个人多资产研究终端（只研不下单）：支持 A 股个股（STOCK）、市场指数（INDEX）、被动/主动 ETF（INDEX_ETF / ACTIVE_ETF）与公募基金（PUBLIC_FUND），并挂载双实证组合（STK-ALIPAY-001 / FND-TIANTIAN-002）与本地 PIT 证据账本。
                  </p>
                  <p className={styles.aboutNote}>
                    <strong>数据与口径说明：</strong>
                  </p>
                  <ul className={styles.noteList}>
                    <li>行情与资金流优先通过本地 FastAPI 零 Key 代理（腾讯/新浪/同花顺/东财直连），断流自动 fail-closed 绝不伪造合成 K 线</li>
                    <li>成交量单位：手（1手=100股）；成交额与个股资金流单位：万元；市值单位：亿元</li>
                    <li>北向资金因交易所已停披露盘中实时净买额，无披露时显示“盘中已停披露”而非误导性 0 元</li>
                    <li>持仓/公募基金采用净值、回撤与费率独立语义，与企业财务 F/Z/M-Score 严格隔离</li>
                  </ul>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
