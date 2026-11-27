/**
 * 应用根组件
 */

import { useSyncExternalStore } from 'react';
import { getMobileCacheScope, subscribeMobilePairingScope } from './platform/runtime';
import { MotionConfig } from 'framer-motion';
import { AppRouter } from './router';
import { ToastProvider } from './components/common';
import { ThemeProvider, AppSettingsProvider, BoardDataProvider } from './contexts';
import { useTheme } from './hooks';

function MotionRoot({ children }: { children: React.ReactNode }) {
  const { motionLevel } = useTheme();
  return (
    <MotionConfig reducedMotion={motionLevel === 'off' ? 'always' : 'user'}>
      {children}
    </MotionConfig>
  );
}

export function App() {
  const scope = useSyncExternalStore(subscribeMobilePairingScope, getMobileCacheScope, getMobileCacheScope);
  return (
    <ThemeProvider>
      <MotionRoot>
        <AppSettingsProvider key={scope}>
          <BoardDataProvider>
            <ToastProvider>
              <AppRouter />
            </ToastProvider>
          </BoardDataProvider>
        </AppSettingsProvider>
      </MotionRoot>
    </ThemeProvider>
  );
}
