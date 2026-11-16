import { matchRoutes } from 'react-router-dom';
import {
  createReactRouterV6DataOptions,
  getWebInstrumentations,
  initializeFaro,
  LogLevel,
  ReactIntegration,
  TransportItemType,
  type TransportItem,
} from '@grafana/faro-react';

const EXCEPTION_DEDUPE_WINDOW_MS = 60_000;
const lastExceptionAt = new Map<string, number>();

function dedupeExceptions(item: TransportItem): TransportItem | null {
  if (item.type !== TransportItemType.EXCEPTION) return item;
  const payload = item.payload as { type?: string; value?: string };
  const key = `${payload.type ?? ''}:${payload.value ?? ''}`;
  const now = Date.now();
  for (const [entryKey, at] of lastExceptionAt) {
    if (now - at >= EXCEPTION_DEDUPE_WINDOW_MS) lastExceptionAt.delete(entryKey);
  }
  if (lastExceptionAt.has(key)) return null;
  lastExceptionAt.set(key, now);
  return item;
}

// 默认关闭第三方 Grafana Faro 外发遥测，防止向外部上传本地投研与持仓信息；
// 仅当显式设置 VITE_ENABLE_FARO=true 时激活。
if (import.meta.env.PROD && import.meta.env.VITE_ENABLE_FARO === 'true') {
  initializeFaro({
    url: 'https://faro-collector-prod-ap-southeast-1.grafana.net/collect/d730ce3555958ea089459acd1cd6886b',
    app: {
      name: 'stock-dashboard',
      version: __APP_VERSION__,
      release: __APP_COMMIT__,
      environment: 'production',
    },
    trackResources: false,
    consoleInstrumentation: {
      disabledLevels: [LogLevel.TRACE, LogLevel.DEBUG, LogLevel.LOG, LogLevel.INFO, LogLevel.WARN],
    },
    beforeSend: dedupeExceptions,
    instrumentations: [
      ...getWebInstrumentations(),
      new ReactIntegration({
        router: createReactRouterV6DataOptions({
          matchRoutes,
        }),
      }),
    ],
  });
}
