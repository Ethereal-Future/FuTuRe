import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initWebVitals } from './utils/webVitals';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppStateProvider } from './store/index.js';
import './index.css';

// Lazy-load App for code splitting
const App = lazy(() => import('./App'));

// Tree-shaken in production — dynamic import ensures the module is never bundled
const StateDebugger = import.meta.env.DEV
  ? lazy(() => import('./store/StateDebugger.jsx').then(m => ({ default: m.StateDebugger })))
  : null;

initWebVitals();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppStateProvider>
      <ThemeProvider>
        <ErrorBoundary context="root">
          <Suspense fallback={<div style={{ padding: 24, textAlign: 'center' }}>Loading…</div>}>
            <App />
          </Suspense>
          {StateDebugger && <Suspense fallback={null}><StateDebugger /></Suspense>}
        </ErrorBoundary>
      </ThemeProvider>
    </AppStateProvider>
  </React.StrictMode>
);
