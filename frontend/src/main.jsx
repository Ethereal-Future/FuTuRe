import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initWebVitals } from './utils/webVitals';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppStateProvider } from './store/index.js';
import { StateDebugger } from './store/index.js';
import './index.css';

// Lazy-load App for code splitting
const App = lazy(() => import('./App'));

initWebVitals();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppStateProvider>
      <ThemeProvider>
        <ErrorBoundary context="root">
          <Suspense fallback={<div style={{ padding: 24, textAlign: 'center' }}>Loading…</div>}>
            <App />
          </Suspense>
          <StateDebugger />
        </ErrorBoundary>
      </ThemeProvider>
    </AppStateProvider>
  </React.StrictMode>
);
