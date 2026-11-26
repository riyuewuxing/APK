import './instrumentation';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { confirmNativeBundleReady } from './platform/bundleActivation';

// Acknowledge the native updater on every JS launch; never acknowledge in E2E itself.
void confirmNativeBundleReady();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
