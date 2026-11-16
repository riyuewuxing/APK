import { lazy, Suspense } from 'react';
import type { EChartsReactProps } from 'echarts-for-react';
import { Loading } from '@/components/common';
import { isMobileViewport, isNativeApp } from '@/platform/runtime';

type LazyEChartProps = Omit<EChartsReactProps, 'echarts'>;

const ReactECharts = lazy(async () => {
  const [{ echarts }, coreModule] = await Promise.all([
    import('./echartsSetup'),
    import('echarts-for-react/lib/core'),
  ]);

  const EChartsReactCore = coreModule.default;
  const Component = (props: LazyEChartProps) => {
    const mobileOrNative = isNativeApp() || isMobileViewport();
    const clampedDpr =
      typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 2, 2.5) : 2;
    const opts = mobileOrNative
      ? { renderer: 'canvas' as const, devicePixelRatio: clampedDpr, ...props.opts }
      : props.opts;
    return <EChartsReactCore echarts={echarts} {...props} opts={opts} />;
  };
  return { default: Component };
});

export function LazyEChart(props: LazyEChartProps) {
  return (
    <Suspense fallback={<Loading size="md" />}>
      <ReactECharts {...props} />
    </Suspense>
  );
}
