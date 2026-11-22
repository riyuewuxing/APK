/**
 * 路由配置
 */

import { Suspense, lazy, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, useParams } from 'react-router-dom';
import { withFaroRouterInstrumentation } from '@grafana/faro-react';
import { Layout } from '@/components/layout';
import { Dashboard } from '@/pages/Dashboard';
import { Loading } from '@/components/common';
import { NotFound, RouteErrorFallback } from '@/pages/NotFound';

const ExpertWorkbench = lazy(() =>
  import('@/pages/ExpertWorkbench').then((mod) => ({ default: mod.ExpertWorkbench }))
);
const ExpertRadar = lazy(() =>
  import('@/pages/ExpertRadar').then((mod) => ({ default: mod.ExpertRadar }))
);
const MarketsHub = lazy(() =>
  import('@/pages/MarketsHub').then((mod) => ({ default: mod.MarketsHub }))
);
const BoardDetail = lazy(() =>
  import('@/pages/Boards').then((mod) => ({ default: mod.BoardDetail }))
);
const Watchlist = lazy(() => import('@/pages/Watchlist').then((mod) => ({ default: mod.Watchlist })));
const Scanner = lazy(() => import('@/pages/Scanner').then((mod) => ({ default: mod.Scanner })));
const Settings = lazy(() => import('@/pages/Settings').then((mod) => ({ default: mod.Settings })));
const StockDetail = lazy(() =>
  import('@/pages/StockDetail').then((mod) => ({ default: mod.StockDetail }))
);
const EndOfDayPicker = lazy(() =>
  import('@/pages/EndOfDayPicker').then((mod) => ({ default: mod.EndOfDayPicker }))
);

function withSuspense(element: ReactNode) {
  return (
    <Suspense fallback={<Loading fullScreen text="加载页面..." />}>
      {element}
    </Suspense>
  );
}

// key 按参数重挂载：切换股票/板块即重置组件，旧实例在途请求的 setState 作废，杜绝串数据
function StockDetailRoute() {
  const { code } = useParams<{ code: string }>();
  return <StockDetail key={code} />;
}

function BoardDetailRoute() {
  const { type, code } = useParams<{ type: string; code: string }>();
  return <BoardDetail key={`${type}/${code}`} />;
}

const browserRouter = createBrowserRouter(
  [
    {
      path: '/',
      element: <Layout />,
      errorElement: <RouteErrorFallback />,
      children: [
        {
          index: true,
          element: <Dashboard />,
        },
        {
          path: 'expert',
          element: withSuspense(<ExpertWorkbench />),
        },
        {
          path: 'expert-radar',
          element: withSuspense(<ExpertRadar />),
        },
        {
          path: 'markets',
          element: withSuspense(<MarketsHub key="markets" defaultView="heatmap" />),
        },
        {
          path: 'heatmap',
          element: withSuspense(<MarketsHub key="heatmap" defaultView="heatmap" />),
        },
        {
          path: 'rankings',
          element: withSuspense(<MarketsHub key="rankings" defaultView="rankings" />),
        },
        {
          path: 'boards',
          element: withSuspense(<MarketsHub key="boards" defaultView="boards" />),
        },
        {
          path: 'boards/:type/:code',
          element: withSuspense(<BoardDetailRoute />),
        },
        {
          path: 'watchlist',
          element: withSuspense(<Watchlist />),
        },
        {
          path: 'scanner',
          element: withSuspense(<Scanner />),
        },
        {
          path: 'eod-picker',
          element: withSuspense(<EndOfDayPicker />),
        },
        {
          path: 'settings',
          element: withSuspense(<Settings />),
        },
        {
          path: 's/:code',
          element: withSuspense(<StockDetailRoute />),
        },
        {
          path: '*',
          element: <NotFound />,
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL }
);

// 仅在显式配置 VITE_ENABLE_FARO=true 时激活外部路由遥测，默认本地研究禁用外传
const faroEnabled = import.meta.env.PROD && import.meta.env.VITE_ENABLE_FARO === 'true';
const router = faroEnabled ? withFaroRouterInstrumentation(browserRouter) : browserRouter;

export function AppRouter() {
  return <RouterProvider router={router} />;
}
