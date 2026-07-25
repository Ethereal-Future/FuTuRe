import { Component } from 'react';
import * as Sentry from '@sentry/react';
import { logError } from '../utils/errorLogger';

const SENSITIVE_RE = /S[0-9A-Z]{54}|(?:secret|privateKey|password|token)(?=\s*[:=])/gi;
function scrub(text) {
  return text ? text.replace(SENSITIVE_RE, '[REDACTED]') : text;
}

async function reportToBackend(error, errorInfo, context) {
  try {
    await fetch('/api/analytics/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: scrub(error?.message),
        stack: scrub(error?.stack),
        componentStack: scrub(errorInfo?.componentStack),
        context: context ?? 'unknown',
        url: window.location.href,
      }),
    });
  } catch {
    // silently ignore reporting failures
  }
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    logError(error, {
      source: 'react-error-boundary',
      componentStack: errorInfo?.componentStack,
      context: this.props.context ?? 'unknown',
    });

    // Report to backend telemetry
    reportToBackend(error, errorInfo, this.props.context);

    // Report to Sentry with React context
    if (Sentry.captureException) {
      Sentry.captureException(error, {
        contexts: {
          react: {
            componentStack: errorInfo?.componentStack,
            context: this.props.context,
          },
        },
      });
    }
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;

    // Allow custom fallback UI
    if (this.props.fallback) {
      return this.props.fallback({ error: this.state.error, reset: this.handleReset });
    }

    // Section-specific fallback for non-full-page errors
    if (this.props.context && this.props.context !== 'root') {
      return (
        <div role="alert" style={styles.sectionContainer}>
          <span style={styles.icon}>⚠️</span>
          <p style={styles.sectionTitle}>{this.props.context} Error</p>
          <p style={styles.message}>{this.state.error.message}</p>
          <button style={styles.button} onClick={this.handleReset}>
            Try again
          </button>
        </div>
      );
    }

    // Full-page error fallback
    return (
      <div role="alert" style={styles.container}>
        <span style={styles.icon}>⚠️</span>
        <p style={styles.title}>Something went wrong</p>
        <p style={styles.message}>{this.state.error.message}</p>
        <button style={styles.button} onClick={this.handleReset}>
          Try again
        </button>
      </div>
    );
  }
}

const styles = {
  container: {
    padding: '20px 16px',
    margin: '16px 0',
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: 6,
    textAlign: 'center',
  },
  sectionContainer: {
    padding: '16px 12px',
    margin: '12px 0',
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: 4,
    textAlign: 'center',
  },
  icon: { fontSize: '2rem' },
  title: { fontWeight: 600, margin: '8px 0 4px', color: '#b91c1c' },
  sectionTitle: { fontWeight: 600, margin: '4px 0 2px', color: '#b91c1c', fontSize: 14 },
  message: { fontSize: 13, color: '#7f1d1d', marginBottom: 12, wordBreak: 'break-word' },
  button: {
    background: '#0066cc',
    color: '#fff',
    border: 'none',
    padding: '8px 20px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 14,
  },
};
